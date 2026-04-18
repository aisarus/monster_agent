import { readTextFile, writeTextFile } from "./storage/fs.js";

const defaultMemory = `# Agent Memory

## Owner Preferences
- Main interface: Telegram.
- Communication style: short, direct, token-efficient.
- Autonomy: aggressive by default.
- Ask before spending money.
- Ask before sending messages to other people.
- Ask before system-level server changes.
- Heartbeat: every 15 minutes.
- Keep long-term memory in this Markdown file.

## Architecture Notes
- MVP uses TypeScript/Node.js.
- One owner, one task queue, max two parallel subagents.
- Use external LLM APIs first. Local LLMs are deferred.
- Use Markdown files compatible with Obsidian.

## Project Notes
- Main initial task: self-improvement of this agent.
- Extra validation tasks: improve a test project, build a simple site/bot, research the web, prepare marketing plans.

## Lessons Learned
- Empty for now.
`;

export class MemoryStore {
  constructor(private readonly filePath: string) {}

  async ensure(): Promise<void> {
    const current = await readTextFile(this.filePath);
    if (!current.trim()) {
      await writeTextFile(this.filePath, defaultMemory);
    }
  }

  async read(): Promise<string> {
    await this.ensure();
    return readTextFile(this.filePath);
  }

  async summary(): Promise<string> {
    const memory = await this.read();
    const lines = memory.split("\n").filter((line) => line.trim()).slice(0, 18);
    return lines.join("\n");
  }
}
