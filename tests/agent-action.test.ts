import { expect, test } from "vitest";
import { parseAgentAction } from "../src/agent-action.js";

test("parses fenced JSON tool call", () => {
  expect(
    parseAgentAction(`\`\`\`json
{"type":"tool","call":{"tool":"list_files","args":{"path":"."}}}
\`\`\``),
  ).toEqual({
    type: "tool",
    call: {
      tool: "list_files",
      args: { path: "." },
    },
  });
});

test("parses JSON surrounded by prose", () => {
  expect(parseAgentAction(`run this {"type":"final","message":"done"} thanks`)).toEqual({
    type: "final",
    message: "done",
  });
});

test("normalizes trailing commas", () => {
  expect(parseAgentAction(`{"type":"final","message":"done",}`)).toEqual({
    type: "final",
    message: "done",
  });
});

test("ignores trailing text after first balanced JSON object", () => {
  expect(parseAgentAction(`{"type":"final","message":"done"} extra text`)).toEqual({
    type: "final",
    message: "done",
  });
});

test("rejects raw shell", () => {
  expect(() => parseAgentAction("bash\nnpm install\n")).toThrow(/No JSON object/);
});
