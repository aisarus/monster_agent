import { AgentRuntime } from "./agent.js";
import type { AppConfig } from "./config.js";
import { CodexRunner } from "./codex-runner.js";
import { LearningLogger, type RecentLearningEntry } from "./skills/LearningLogger.js";
import { SkillEvaluator } from "./skills/SkillEvaluator.js";
import { TaskQueue } from "./tasks.js";

export class SelfImprovementScheduler {
  private enabled: boolean;
  private timer: NodeJS.Timeout | undefined;
  private lastRunAt: string | undefined;

  constructor(
    private readonly config: AppConfig,
    private readonly agent: AgentRuntime,
    private readonly tasks: TaskQueue,
    private readonly skillEvaluator: SkillEvaluator,
    private readonly learningLogger: LearningLogger,
    private readonly notify: (message: string) => Promise<void>,
    private readonly codexRunner?: CodexRunner,
  ) {
    this.enabled = config.SELF_IMPROVEMENT_ENABLED;
  }

  start(): void {
    this.scheduleNext(15_000);
  }

  enable(): string {
    this.enabled = true;
    this.scheduleNext(1_000);
    return "Autopilot enabled.";
  }

  disable(): string {
    this.enabled = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    return "Autopilot disabled.";
  }

  status(): string {
    return [
      `Autopilot: ${this.enabled ? "enabled" : "disabled"}`,
      `Executor: ${this.codexRunner ? "codex" : "agent-loop"}`,
      `Interval: ${this.config.SELF_IMPROVEMENT_INTERVAL_MINUTES} min`,
      `Last run: ${this.lastRunAt ?? "never"}`,
      this.codexRunner?.status() ?? "",
    ].join("\n");
  }

  async runNow(): Promise<string> {
    if (await this.agent.isPaused()) {
      return "Autopilot run skipped: runtime is paused.";
    }

    if (await this.tasks.hasPendingWork()) {
      return "Autopilot run skipped: queue is busy.";
    }

    const taskText = await this.buildNextTaskText();
    if (this.codexRunner) {
      if (await this.codexRunner.recentlyNooped(taskText)) {
        return "Autopilot skipped: Codex recently made no changes for this task.";
      }
      const message = await this.codexRunner.run(taskText);
      this.lastRunAt = new Date().toISOString();
      return message;
    }

    const task = await this.agent.enqueue(taskText);
    this.agent.kick();
    this.lastRunAt = new Date().toISOString();
    return `Autopilot queued task ${task.id.slice(0, 8)}.`;
  }

  async buildNextTaskText(): Promise<string> {
    return (
      (await this.skillEvaluator.buildImprovementTask()) ??
      (await this.buildRecurringErrorTask()) ??
      (await this.buildFeatureRequestTask()) ??
      `[autopilot:self-improvement]\n${this.config.SELF_IMPROVEMENT_TASK}`
    );
  }

  private async buildRecurringErrorTask(): Promise<string | null> {
    const errors = await this.learningLogger.readRecentEntries("errors", 20);
    const recurring = mostFrequent(errors, 2);
    if (!recurring) {
      return null;
    }

    return [
      "[autopilot:learning-error]",
      `Разбери повторяющийся failure pattern: ${recurring.summary}`,
      "Изучи data/learnings/ERRORS.md, найди минимальную причину и исправь один маленький gap.",
      "Если pattern повторяемый и workflow стал понятен, создай или обнови skill.",
    ].join("\n");
  }

  private async buildFeatureRequestTask(): Promise<string | null> {
    const requests = await this.learningLogger.readRecentEntries("feature_requests", 10);
    const request = requests[0];
    if (!request) {
      return null;
    }

    return [
      "[autopilot:learning-feature-request]",
      `Реализуй или уточни missing capability: ${request.summary}`,
      "Изучи data/learnings/FEATURE_REQUESTS.md и сделай минимальный безопасный шаг.",
      "Если scope слишком большой, добавь backlog/skill вместо широкой реализации.",
    ].join("\n");
  }

  private scheduleNext(delayMs = this.config.SELF_IMPROVEMENT_INTERVAL_MINUTES * 60 * 1000): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      void this.tick();
    }, delayMs);
  }

  private async tick(): Promise<void> {
    try {
      if (!this.enabled) {
        return;
      }

      if (await this.agent.isPaused()) {
        this.scheduleNext();
        return;
      }

      if (await this.tasks.hasPendingWork()) {
        await this.notify("Autopilot skipped: queue is busy.");
        this.scheduleNext();
        return;
      }

      await this.notify(await this.runNow());
    } catch (error) {
      await this.notify(`Autopilot error: ${(error as Error).message.slice(0, 500)}`);
    } finally {
      if (this.enabled) {
        this.scheduleNext();
      }
    }
  }
}

function mostFrequent(
  entries: RecentLearningEntry[],
  minCount: number,
): { summary: string; count: number } | null {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const key = normalizePattern(entry.summary || entry.failureReason || "");
    if (!key) {
      continue;
    }
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const [summary, count] =
    [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] ?? [];
  if (!summary || count < minCount) {
    return null;
  }
  return { summary, count };
}

function normalizePattern(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b[0-9a-f]{8,}\b/g, "<id>")
    .replace(/\d+/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}
