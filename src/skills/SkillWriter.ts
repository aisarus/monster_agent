import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { dump as dumpYaml, load as loadYaml } from "js-yaml";
import { writeTextFile } from "../storage/fs.js";
import { SkillLoader, type SkillSecurity } from "./SkillLoader.js";

export interface SkillRequirements {
  env?: string[];
  bins?: string[];
}

export interface CreateSkillParams {
  name: string;
  description: string;
  trigger: string;
  steps: string[];
  security: SkillSecurity;
  requires?: SkillRequirements;
}

export interface SkillContent {
  description: string;
  trigger: string;
  steps: string[];
  security: SkillSecurity;
  requires: SkillRequirements;
}

export interface SkillWriteResult {
  path: string;
  validated: boolean;
  errors: string[];
}

interface SkillDocument {
  frontmatter: {
    name: string;
    description: string;
    version: string;
    metadata: {
      requires: { env: string[]; bins: string[] };
      security: SkillSecurity;
    };
  };
  title: string;
  triggers: string[];
  steps: string[];
  outputFormat: string[];
  stopConditions: string[];
}

export class SkillWriter {
  constructor(
    private readonly skillsRoot = "data/workspace/skills",
    private readonly loader = new SkillLoader(skillsRoot),
  ) {}

  async createSkill(params: CreateSkillParams): Promise<SkillWriteResult> {
    const document = buildNewDocument(params);
    const path = this.skillPath(document.frontmatter.name);
    if (await pathExists(path)) {
      throw new Error(`Skill already exists: ${document.frontmatter.name}`);
    }

    validateDocument(document);
    await mkdir(dirname(path), { recursive: true });
    await writeTextFile(path, renderSkill(document));
    return this.validationResult(path);
  }

  async updateSkill(name: string, patch: Partial<SkillContent>): Promise<SkillWriteResult> {
    assertSafeSkillName(name);
    const path = this.skillPath(name);
    if (!(await pathExists(path))) {
      throw new Error(`Skill does not exist: ${name}`);
    }

    const document = parseExistingSkill(await readFile(path, "utf8"));
    const next: SkillDocument = {
      ...document,
      frontmatter: {
        ...document.frontmatter,
        description: normalizeDescription(patch.description ?? document.frontmatter.description),
        metadata: {
          requires: normalizeRequires(patch.requires ?? document.frontmatter.metadata.requires),
          security: patch.security ?? document.frontmatter.metadata.security,
        },
      },
      triggers: patch.trigger
        ? [normalizeNonEmptyString(patch.trigger, "trigger"), ...document.triggers.slice(1)]
        : document.triggers,
      steps: patch.steps ? normalizeSteps(patch.steps) : document.steps,
    };

    validateDocument(next);
    await writeTextFile(path, renderSkill(next));
    return this.validationResult(path);
  }

  async deleteSkill(name: string): Promise<void> {
    assertSafeSkillName(name);
    const path = this.skillPath(name);
    if (!(await pathExists(path))) {
      throw new Error(`Skill does not exist: ${name}`);
    }

    await rm(dirname(path), { recursive: true, force: false });
  }

  private skillPath(name: string): string {
    assertSafeSkillName(name);
    return join(this.skillsRoot, name, "SKILL.md");
  }

  private async validationResult(path: string): Promise<SkillWriteResult> {
    const errors = await this.loader.validateSkill(path);
    return { path, validated: errors.length === 0, errors };
  }
}

function buildNewDocument(params: CreateSkillParams): SkillDocument {
  const name = normalizeSkillName(params.name);
  return {
    frontmatter: {
      name,
      description: normalizeDescription(params.description),
      version: "1.0.0",
      metadata: {
        requires: normalizeRequires(params.requires),
        security: params.security,
      },
    },
    title: titleFromSlug(name),
    triggers: [normalizeNonEmptyString(params.trigger, "trigger")],
    steps: normalizeSteps(params.steps),
    outputFormat: [
      "В Telegram или final-ответе напиши:",
      "- skill: имя скилла",
      "- result: что сделано",
      "- next: одно конкретное следующее действие",
    ],
    stopConditions: [
      "Если workflow больше не подходит задаче: остановись и напиши почему.",
      "Если не хватает доступа, env vars или binaries: остановись и перечисли missing requirements.",
    ],
  };
}

function parseExistingSkill(raw: string): SkillDocument {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!match) {
    throw new Error("Existing skill is missing YAML frontmatter");
  }

  const frontmatter = normalizeFrontmatter(loadYaml(match[1]));
  const content = match[2];
  return {
    frontmatter,
    title: firstHeading(content) ?? titleFromSlug(frontmatter.name),
    triggers: parseBulletSection(content, "Когда использовать", [
      "Используй, когда задача совпадает с описанием skill.",
    ]),
    steps: parseNumberedSection(content, "Workflow", ["Выполни workflow из описания задачи."]),
    outputFormat: parseRawSection(content, "Выходной формат", [
      "В Telegram или final-ответе напиши результат и следующий шаг.",
    ]),
    stopConditions: parseRawSection(content, "Стоп-условия", [
      "Если выполнить workflow нельзя, остановись и напиши причину.",
    ]),
  };
}

function renderSkill(document: SkillDocument): string {
  const frontmatter = dumpYaml(document.frontmatter, {
    lineWidth: -1,
    noRefs: true,
    sortKeys: false,
  }).trim();

  return [
    "---",
    frontmatter,
    "---",
    "",
    `# ${document.title}`,
    "",
    "## Когда использовать",
    ...document.triggers.map((trigger) => `- ${trigger}`),
    "",
    "## Workflow",
    ...document.steps.map((step, index) => `${index + 1}. ${step}`),
    "",
    "## Выходной формат",
    ...document.outputFormat,
    "",
    "## Стоп-условия",
    ...document.stopConditions,
    "",
  ].join("\n");
}

function validateDocument(document: SkillDocument): void {
  assertSafeSkillName(document.frontmatter.name);
  normalizeDescription(document.frontmatter.description);
  normalizeRequires(document.frontmatter.metadata.requires);
  if (!isSecurity(document.frontmatter.metadata.security)) {
    throw new Error("security must be L1, L2, or L3");
  }
  if (document.triggers.length < 1) {
    throw new Error("trigger is required");
  }
  normalizeSteps(document.steps);
}

function normalizeSkillName(name: string): string {
  const normalized = normalizeNonEmptyString(name, "name");
  assertSafeSkillName(normalized);
  return normalized;
}

function assertSafeSkillName(name: string): void {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
    throw new Error("Skill name must be a safe slug: lowercase a-z, 0-9, and hyphen only");
  }
}

function normalizeDescription(description: string): string {
  const normalized = normalizeNonEmptyString(description, "description");
  if (/\r|\n/.test(normalized)) {
    throw new Error("description must be one line");
  }
  return normalized;
}

function normalizeSteps(steps: string[]): string[] {
  if (!Array.isArray(steps) || steps.length < 1) {
    throw new Error("steps must contain at least one item");
  }
  if (steps.length > 7) {
    throw new Error("workflow can contain at most 7 steps");
  }
  return steps.map((step) => normalizeNonEmptyString(step, "step"));
}

function normalizeRequires(requires: SkillRequirements | undefined): { env: string[]; bins: string[] } {
  const env = requires?.env ?? [];
  const bins = requires?.bins ?? [];
  if (!isStringArray(env) || !isStringArray(bins)) {
    throw new Error("requires.env and requires.bins must be string arrays");
  }
  return { env, bins };
}

function normalizeNonEmptyString(value: string, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} is required`);
  }
  return value.trim();
}

function normalizeFrontmatter(value: unknown): SkillDocument["frontmatter"] {
  if (!isRecord(value) || !isRecord(value.metadata) || !isRecord(value.metadata.requires)) {
    throw new Error("Existing skill has invalid frontmatter");
  }
  const security = value.metadata.security;
  if (!isSecurity(security)) {
    throw new Error("Existing skill has invalid security");
  }
  return {
    name: normalizeSkillName(String(value.name)),
    description: normalizeDescription(String(value.description)),
    version: normalizeNonEmptyString(String(value.version), "version"),
    metadata: {
      requires: normalizeRequires({
        env: value.metadata.requires.env as string[],
        bins: value.metadata.requires.bins as string[],
      }),
      security,
    },
  };
}

function firstHeading(content: string): string | null {
  return /^#\s+(.+)$/m.exec(content)?.[1].trim() ?? null;
}

function parseBulletSection(content: string, heading: string, fallback: string[]): string[] {
  const raw = parseRawSection(content, heading, fallback);
  const items = raw.map((line) => line.replace(/^-\s*/, "").trim()).filter(Boolean);
  return items.length > 0 ? items : fallback;
}

function parseNumberedSection(content: string, heading: string, fallback: string[]): string[] {
  const raw = parseRawSection(content, heading, fallback);
  const items = raw.map((line) => line.replace(/^\d+\.\s*/, "").trim()).filter(Boolean);
  return items.length > 0 ? items : fallback;
}

function parseRawSection(content: string, heading: string, fallback: string[]): string[] {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^## ${escaped}\\r?\\n([\\s\\S]*?)(?=\\r?\\n## |$)`, "m").exec(content);
  if (!match) {
    return fallback;
  }
  const lines = match[1]
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.length > 0 ? lines : fallback;
}

function titleFromSlug(slug: string): string {
  return slug
    .split("-")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isSecurity(value: unknown): value is SkillSecurity {
  return value === "L1" || value === "L2" || value === "L3";
}
