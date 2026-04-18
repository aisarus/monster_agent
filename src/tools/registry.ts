import { WorkspaceTools, type ToolResult } from "./workspace.js";

export type AgentToolName = "list_files" | "read_file" | "write_file" | "run_command" | "git_status";

export type AgentToolCall = {
  tool: AgentToolName;
  args?: Record<string, unknown>;
};

export class ToolRegistry {
  constructor(private readonly workspace: WorkspaceTools) {}

  async run(call: AgentToolCall): Promise<ToolResult> {
    switch (call.tool) {
      case "list_files":
        return this.workspace.listFiles(stringArg(call.args, "path", "."));
      case "read_file":
        return this.workspace.readFile(requiredStringArg(call.args, "path"));
      case "write_file":
        return this.workspace.writeFile(
          requiredStringArg(call.args, "path"),
          requiredStringArg(call.args, "content"),
        );
      case "run_command":
        return this.workspace.runCommand(requiredStringArg(call.args, "command"));
      case "git_status":
        return this.workspace.gitStatus();
      default:
        return { ok: false, output: `Unknown tool: ${(call as { tool: string }).tool}` };
    }
  }
}

function requiredStringArg(args: Record<string, unknown> | undefined, key: string): string {
  const value = args?.[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing string arg: ${key}`);
  }
  return value;
}

function stringArg(args: Record<string, unknown> | undefined, key: string, fallback: string): string {
  const value = args?.[key];
  return typeof value === "string" && value.trim() ? value : fallback;
}
