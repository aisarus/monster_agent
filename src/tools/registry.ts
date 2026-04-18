import { WorkspaceTools, type ToolResult } from "./workspace.js";
import { SkillLoader } from "../skills/SkillLoader.js";

export type AgentToolName =
  | "list_files"
  | "read_file"
  | "read_skill"
  | "write_file"
  | "run_command"
  | "git_status"
  | "git_branch"
  | "git_commit"
  | "git_push"
  | "github_pr";

export type AgentToolCall = {
  tool: AgentToolName;
  args?: Record<string, unknown>;
};

export class ToolRegistry {
  constructor(
    private readonly workspace: WorkspaceTools,
    private readonly skillLoader: SkillLoader,
  ) {}

  async run(call: AgentToolCall): Promise<ToolResult> {
    switch (call.tool) {
      case "list_files":
        return this.workspace.listFiles(stringArg(call.args, "path", "."));
      case "read_file":
        return this.workspace.readFile(requiredStringArg(call.args, "path"));
      case "read_skill":
        return this.readSkill(requiredStringArg(call.args, "name"));
      case "write_file":
        return this.workspace.writeFile(
          requiredStringArg(call.args, "path"),
          requiredStringArg(call.args, "content"),
        );
      case "run_command":
        return this.workspace.runCommand(requiredStringArg(call.args, "command"));
      case "git_status":
        return this.workspace.gitStatus();
      case "git_branch":
        return this.workspace.gitBranch(requiredStringArg(call.args, "name"));
      case "git_commit":
        return this.workspace.gitCommit(requiredStringArg(call.args, "message"));
      case "git_push":
        return this.workspace.gitPush();
      case "github_pr":
        return this.workspace.githubPr(
          requiredStringArg(call.args, "title"),
          stringArg(call.args, "body", ""),
          stringArg(call.args, "base", "main"),
        );
      default:
        return { ok: false, output: `Unknown tool: ${(call as { tool: string }).tool}` };
    }
  }

  private async readSkill(name: string): Promise<ToolResult> {
    const skill = await this.skillLoader.getSkill(name);
    if (!skill) {
      return { ok: false, output: `Skill not found: ${name}` };
    }

    if (!skill.eligible) {
      return {
        ok: false,
        output: `Skill is not eligible: ${name}. Missing: ${skill.missingRequirements.join(", ")}`,
      };
    }

    return { ok: true, output: skill.content };
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
