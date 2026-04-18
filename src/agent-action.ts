import type { AgentToolCall } from "./tools/registry.js";

export type AgentAction =
  | {
      type: "tool";
      call: AgentToolCall;
    }
  | {
      type: "final";
      message: string;
    };

export function parseAgentAction(content: string): AgentAction {
  const json = normalizeJson(extractJson(content));
  const value = JSON.parse(json) as unknown;

  if (!value || typeof value !== "object") {
    throw new Error("Agent action must be a JSON object.");
  }

  const record = value as Record<string, unknown>;

  if (record.type === "final") {
    if (typeof record.message !== "string") {
      throw new Error("Final action requires message string.");
    }
    return { type: "final", message: record.message };
  }

  if (record.type === "tool") {
    const call = record.call;
    if (!call || typeof call !== "object") {
      throw new Error("Tool action requires call object.");
    }
    const toolCall = call as Record<string, unknown>;
    if (typeof toolCall.tool !== "string") {
      throw new Error("Tool call requires tool name.");
    }
    return {
      type: "tool",
      call: {
        tool: toolCall.tool as AgentToolCall["tool"],
        args:
          toolCall.args && typeof toolCall.args === "object"
            ? (toolCall.args as Record<string, unknown>)
            : {},
      },
    };
  }

  throw new Error("Unknown agent action type.");
}

function extractJson(content: string): string {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const first = content.indexOf("{");
  if (first >= 0) {
    const balanced = extractBalancedJsonObject(content, first);
    if (balanced) {
      return balanced;
    }
  }

  throw new Error("No JSON object found in model response.");
}

function extractBalancedJsonObject(content: string, start: number): string | undefined {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < content.length; index += 1) {
    const char = content[index];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (char === "{") {
      depth += 1;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return content.slice(start, index + 1);
      }
    }
  }

  return undefined;
}

function normalizeJson(json: string): string {
  return json
    .trim()
    .replace(/,\s*}/g, "}")
    .replace(/,\s*]/g, "]");
}
