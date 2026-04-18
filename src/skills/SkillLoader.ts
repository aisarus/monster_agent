import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { relative } from "node:path";
import { promisify } from "node:util";
import { load as loadYaml } from "js-yaml";

const execFileAsync = promisify(execFile);

export type SkillSecurity = "L1" | "L2" | "L3";

export interface Skill {
  name: string;
  description: string;
  version: string;
  content: string;
  metadata: {
    requires: { env: string[]; bins: string[] };
    security: SkillSecurity;
  };
  path: string;
  eligible: boolean;
  missingRequirements: string[];
}

type SkillFrontmatter = {
  name: string;
  description: string;
  version: string;
  metadata: {
    requires: {
      env: string[];
      bins: string[];
    };
    security: SkillSecurity;
  };
};

export class SkillLoader {
  constructor(private readonly skillsRoot = "data/workspace/skills") {}

  async loadAll(): Promise<Skill[]> {
    const paths = await this.skillPaths(this.skillsRoot);
    const skills: Skill[] = [];

    for (const path of paths) {
      const errors = await this.validateSkill(path);
      if (errors.length > 0) {
        console.warn(`Skipping invalid skill ${path}: ${errors.join("; ")}`);
        continue;
      }

      skills.push(await this.loadSkill(path));
    }

    return skills.sort((a, b) => a.name.localeCompare(b.name));
  }

  async loadEligible(): Promise<Skill[]> {
    return (await this.loadAll()).filter((skill) => skill.eligible);
  }

  formatForPrompt(skills: Skill[]): string {
    const items = skills
      .map((skill) =>
        [
          "<skill>",
          `  <n>${escapeXml(skill.name)}</n>`,
          `  <description>${escapeXml(skill.description)}</description>`,
          `  <location>${escapeXml(skill.path)}</location>`,
          "</skill>",
        ].join("\n"),
      )
      .join("\n");

    return `<skills>\n${items}\n</skills>`;
  }

  async getSkill(name: string): Promise<Skill | null> {
    const skills = await this.loadAll();
    return skills.find((skill) => skill.name === name) ?? null;
  }

  async validateSkill(skillPath: string): Promise<string[]> {
    try {
      const raw = await readFile(skillPath, "utf8");
      const parsed = parseSkillMarkdown(raw);
      const errors = validateFrontmatter(parsed.frontmatter);
      const content = parsed.content.trim();
      if (!content) {
        errors.push("content is empty");
      }
      return errors;
    } catch (error) {
      return [`cannot parse skill: ${(error as Error).message}`];
    }
  }

  private async loadSkill(skillPath: string): Promise<Skill> {
    const raw = await readFile(skillPath, "utf8");
    const { frontmatter, content } = parseSkillMarkdown(raw);
    const data = normalizeFrontmatter(frontmatter);
    const missing = await collectMissingRequirements(data.metadata.requires);

    return {
      ...data,
      content,
      path: normalizeLocation(skillPath),
      eligible: missing.length === 0,
      missingRequirements: missing,
    };
  }

  private async skillPaths(root: string): Promise<string[]> {
    const entries = await readdir(root, { withFileTypes: true });
    const paths: string[] = [];

    for (const entry of entries) {
      const path = `${root}/${entry.name}`;
      if (entry.isDirectory()) {
        paths.push(...(await this.skillPaths(path)));
        continue;
      }

      if (entry.isFile() && entry.name === "SKILL.md") {
        paths.push(path);
      }
    }

    return paths;
  }
}

function parseSkillMarkdown(raw: string): { frontmatter: unknown; content: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!match) {
    throw new Error("missing YAML frontmatter");
  }

  return {
    frontmatter: loadYaml(match[1]),
    content: match[2].trimStart(),
  };
}

function validateFrontmatter(frontmatter: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(frontmatter)) {
    return ["frontmatter must be an object"];
  }

  if (!isNonEmptyString(frontmatter.name)) errors.push("name is required");
  if (!isNonEmptyString(frontmatter.description)) errors.push("description is required");
  if (!isNonEmptyString(frontmatter.version)) errors.push("version is required");

  const metadata = frontmatter.metadata;
  if (!isRecord(metadata)) {
    errors.push("metadata is required");
    return errors;
  }

  const requires = metadata.requires;
  if (!isRecord(requires)) {
    errors.push("metadata.requires is required");
  } else {
    if (!isStringArray(requires.env)) errors.push("metadata.requires.env must be string[]");
    if (!isStringArray(requires.bins)) errors.push("metadata.requires.bins must be string[]");
  }

  if (!isSecurity(metadata.security)) {
    errors.push("metadata.security must be L1, L2, or L3");
  }

  return errors;
}

function normalizeFrontmatter(frontmatter: unknown): SkillFrontmatter {
  const errors = validateFrontmatter(frontmatter);
  if (errors.length > 0 || !isRecord(frontmatter) || !isRecord(frontmatter.metadata)) {
    throw new Error(errors.join("; "));
  }

  const requires = frontmatter.metadata.requires;
  if (!isRecord(requires) || !isSecurity(frontmatter.metadata.security)) {
    throw new Error("invalid metadata");
  }

  return {
    name: String(frontmatter.name),
    description: String(frontmatter.description),
    version: String(frontmatter.version),
    metadata: {
      requires: {
        env: requires.env as string[],
        bins: requires.bins as string[],
      },
      security: frontmatter.metadata.security,
    },
  };
}

async function collectMissingRequirements(
  requires: Skill["metadata"]["requires"],
): Promise<string[]> {
  const missing: string[] = [];
  for (const env of requires.env) {
    if (!process.env[env]) {
      missing.push(`env:${env}`);
    }
  }

  for (const bin of requires.bins) {
    if (!(await hasBin(bin))) {
      missing.push(`bin:${bin}`);
    }
  }

  return missing;
}

async function hasBin(bin: string): Promise<boolean> {
  try {
    await execFileAsync("which", [bin]);
    return true;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isSecurity(value: unknown): value is SkillSecurity {
  return value === "L1" || value === "L2" || value === "L3";
}

function normalizeLocation(path: string): string {
  return relative(process.cwd(), path).replaceAll("\\", "/");
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
