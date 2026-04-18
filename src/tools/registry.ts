import { WorkspaceTools, type ToolResult } from "./workspace.js";
import { SkillLoader } from "../skills/SkillLoader.js";
import { SkillWriter, type SkillContent } from "../skills/SkillWriter.js";
import type { SkillSecurity } from "../skills/SkillLoader.js";

export type AgentToolName =
  | "list_files"
  | "read_file"
  | "read_skill"
  | "list_skills"
  | "create_skill"
  | "update_skill"
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
    private readonly skillWriter: SkillWriter,
  ) {}

  async run(call: AgentToolCall): Promise<ToolResult> {
    switch (call.tool) {
      case "list_files":
        return this.workspace.listFiles(stringArg(call.args, "path", "."));
      case "read_file":
        return this.workspace.readFile(requiredStringArg(call.args, "path"));
      case "read_skill":
        return this.readSkill(requiredStringArg(call.args, "name"));
      case "list_skills":
        return this.listSkills();
      case "create_skill":
        return this.createSkill(call.args);
      case "update_skill":
        return this.updateSkill(call.args);
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

  private async listSkills(): Promise<ToolResult> {
    const skills = await this.skillLoader.loadAll();
    const output = skills
      .map((skill) =>
        [
          `${skill.name} v${skill.version}`,
          `security=${skill.metadata.security}`,
          `eligible=${skill.eligible ? "yes" : "no"}`,
          skill.missingRequirements.length > 0
            ? `missing=${skill.missingRequirements.join(",")}`
            : "",
        ]
          .filter(Boolean)
          .join(" "),
      )
      .join("\n");

    return { ok: true, output: output || "No skills found." };
  }

  private async createSkill(args: Record<string, unknown> | undefined): Promise<ToolResult> {
    const result = await this.skillWriter.createSkill({
      name: requiredStringArg(args, "name"),
      description: requiredStringArg(args, "description"),
      trigger: requiredStringArg(args, "trigger"),
      steps: requiredStringArrayArg(args, "steps"),
      security: securityArg(args, "security"),
      requires: requiresArg(args),
    });

    return {
      ok: result.validated,
      output: formatSkillWriteResult("created", result),
    };
  }

  private async updateSkill(args: Record<string, unknown> | undefined): Promise<ToolResult> {
    const patch: Partial<SkillContent> = {};
    if (typeof args?.description === "string") patch.description = args.description;
    if (typeof args?.trigger === "string") patch.trigger = args.trigger;
    if (Array.isArray(args?.steps)) patch.steps = requiredStringArrayArg(args, "steps");
    if (args?.security !== undefined) patch.security = securityArg(args, "security");
    if (args?.requires !== undefined) patch.requires = requiresArg(args);

    const result = await this.skillWriter.updateSkill(requiredStringArg(args, "name"), patch);
    return {
      ok: result.validated,
      output: formatSkillWriteResult("updated", result),
    };
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

function requiredStringArrayArg(args: Record<string, unknown> | undefined, key: string): string[] {
  const value = args?.[key];
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !value.every((item) => typeof item === "string" && item.trim())
  ) {
    throw new Error(`Missing string[] arg: ${key}`);
  }
  return value.map((item) => item.trim());
}

function securityArg(args: Record<string, unknown> | undefined, key: string): SkillSecurity {
  const value = args?.[key];
  if (value !== "L1" && value !== "L2" && value !== "L3") {
    throw new Error(`Missing security arg: ${key}`);
  }
  return value;
}

function requiresArg(args: Record<string, unknown> | undefined): {
  env: string[];
  bins: string[];
} {
  const requires = args?.requires;
  if (requires === undefined) {
    return { env: [], bins: [] };
  }
  if (typeof requires !== "object" || requires === null || Array.isArray(requires)) {
    throw new Error("requires must be an object");
  }
  const env = (requires as Record<string, unknown>).env ?? [];
  const bins = (requires as Record<string, unknown>).bins ?? [];
  if (!isStringArray(env) || !isStringArray(bins)) {
    throw new Error("requires.env and requires.bins must be string arrays");
  }
  return { env, bins };
}

function formatSkillWriteResult(action: string, result: {
  path: string;
  validated: boolean;
  errors: string[];
}): string {
  return [
    `Skill ${action}: ${result.path}`,
    `validated: ${result.validated ? "yes" : "no"}`,
    result.errors.length > 0 ? `errors: ${result.errors.join("; ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}
