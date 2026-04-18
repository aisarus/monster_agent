import { readJsonFile, writeJsonFile } from "./storage/fs.js";

type BudgetUsage = {
  totalUsd: number;
  byDay: Record<string, number>;
  events: Array<{
    at: string;
    provider: string;
    model: string;
    estimatedUsd: number;
    taskId?: string;
  }>;
};

const emptyUsage: BudgetUsage = {
  totalUsd: 0,
  byDay: {},
  events: [],
};

export class BudgetTracker {
  constructor(
    private readonly filePath: string,
    private readonly dailyLimitUsd: number,
    private readonly monthlyLimitUsd: number,
  ) {}

  async status(): Promise<string> {
    const usage = await this.read();
    const today = new Date().toISOString().slice(0, 10);
    const todayUsd = usage.byDay[today] ?? 0;
    return [
      `Budget: $${usage.totalUsd.toFixed(4)} total`,
      `Today: $${todayUsd.toFixed(4)} / $${this.dailyLimitUsd.toFixed(2)}`,
      `Month limit: $${this.monthlyLimitUsd.toFixed(2)}`,
    ].join("\n");
  }

  async record(event: BudgetUsage["events"][number]): Promise<void> {
    const usage = await this.read();
    const day = event.at.slice(0, 10);
    usage.totalUsd += event.estimatedUsd;
    usage.byDay[day] = (usage.byDay[day] ?? 0) + event.estimatedUsd;
    usage.events.push(event);
    await writeJsonFile(this.filePath, usage);
  }

  private async read(): Promise<BudgetUsage> {
    return readJsonFile(this.filePath, emptyUsage);
  }
}
