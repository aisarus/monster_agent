import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { readTextFile } from "./storage/fs.js";

const bootstrapFiles = ["AGENTS.md", "SOUL.md", "USER.md", "TOOLS.md", "HEARTBEAT.md", "MEMORY.md"];

export type BootstrapContext = {
  text: string;
  skills: Array<{
    name: string;
    description: string;
    path: string;
    content?: string;
  }>;
};

export class BootstrapLoader {
  constructor(
    private readonly bootstrapDir: string,
    private readonly maxFileChars = 4000,
    private readonly maxTotalChars = 16000,
  ) {}

  async load(taskText = ""): Promise<BootstrapContext> {
    const sections: string[] = [];

    for (const file of bootstrapFiles) {
      const path = join(this.bootstrapDir, file);
      const content = await readTextFile(path, `(missing ${file})`);
      sections.push(formatSection(file, content.slice(0, this.maxFileChars)));
    }

    const skills = await this.loadSkills(taskText);
    if (skills.length > 0) {
      sections.push(
        formatSection(
          "AVAILABLE_SKILLS",
          skills.map((skill) => `- ${skill.name}: ${skill.description} (${skill.path})`).join("\n"),
        ),
      );
      sections.push(
        formatSection(
          "SELECTED_SKILL_INSTRUCTIONS",
          skills
            .filter((skill) => skill.content)
            .map((skill) => `# ${skill.name}\n${skill.content}`)
            .join("\n\n")
            .slice(0, 6000),
        ),
      );
    }

    return {
      text: sections.join("\n\n").slice(0, this.maxTotalChars),
      skills,
    };
  }

  private async loadSkills(taskText: string): Promise<BootstrapContext["skills"]> {
    const skillsDir = join(this.bootstrapDir, "skills");
    let entries;
    try {
      entries = await readdir(skillsDir, { withFileTypes: true });
    } catch {
      return [];
    }

    const skills: BootstrapContext["skills"] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const path = join(skillsDir, entry.name, "SKILL.md");
      const content = await readTextFile(path);
      if (!content.trim()) {
        continue;
      }
      skills.push({
        name: frontmatterValue(content, "name") ?? entry.name,
        description: frontmatterValue(content, "description") ?? "No description.",
        path,
        content: shouldSelectSkill(entry.name, content, taskText)
          ? stripFrontmatter(content).slice(0, 2200)
          : undefined,
      });
    }

    return skills.sort(
      (a, b) =>
        Number(Boolean(b.content)) - Number(Boolean(a.content)) || a.name.localeCompare(b.name),
    );
  }
}

function formatSection(name: string, content: string): string {
  return `<${name}>\n${content.trim()}\n</${name}>`;
}

function frontmatterValue(content: string, key: string): string | undefined {
  const match = content.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
  return match?.[1]?.trim();
}

function stripFrontmatter(content: string): string {
  return content.replace(/^---[\s\S]*?---\s*/, "").trim();
}

function shouldSelectSkill(name: string, content: string, taskText: string): boolean {
  const text = `${name}\n${content}\n${taskText}`.toLowerCase();
  if (/само|self|agent|агент|улучш|совершен|monster/.test(text) && name.includes("self")) {
    return true;
  }
  if (/код|code|файл|edit|npm|test|lint|typescript|проект/.test(text) && name.includes("coding")) {
    return true;
  }
  if (/telegram|телеграм|бот|reply|сообщ/.test(text) && name.includes("telegram")) {
    return true;
  }
  return false;
}
