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

    const taskText = await this.buildRunnableTaskText();
    if (this.codexRunner) {
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
    return (await this.buildCandidateTaskTexts())[0];
  }

  private async buildRunnableTaskText(): Promise<string> {
    const candidates = await this.buildCandidateTaskTexts();
    if (!this.codexRunner) {
      return candidates[0];
    }

    for (const candidate of candidates) {
      if (!(await this.codexRunner.recentlyNooped(candidate))) {
        return candidate;
      }
    }

    return [
      "[autopilot:self-discovery]",
      "Все более конкретные self-improvement задачи недавно завершились без изменений.",
      "Самостоятельно изучи README.md, data/memory/decisions.json, data/learnings, data/runtime и tests.",
      "Найди один маленький проверяемый gap, который мешает daemon лучше строить себя через Codex.",
      "Если безопасного изменения нет, добавь компактную запись в data/learnings/LEARNINGS.md с причиной.",
    ].join("\n");
  }

  private async buildCandidateTaskTexts(): Promise<string[]> {
    return [
      ...(await this.buildSkillImprovementTasks()),
      ...(await this.buildRecurringErrorTasks()),
      ...(await this.buildFeatureRequestTasks()),
      this.buildSelfDiscoveryTask(),
    ];
  }

  private async buildSkillImprovementTasks(): Promise<string[]> {
    const underperforming = await this.skillEvaluator.getUnderperformingSkills(0.7);
    if (underperforming.length > 0) {
      return underperforming.map(({ name, metrics }) =>
        [
          "[autopilot:skill-improvement]",
          `Улучши скилл ${name}: task_success_rate=${metrics.task_success_rate.toFixed(2)}.`,
          "Изучи failure_reasons, обнови SKILL.md через update_skill и добавь/обнови тесты если нужно.",
        ].join("\n"),
      );
    }

    const stale = await this.skillEvaluator.getStaleSkills(14);
    if (stale.length > 0) {
      const [{ name, metrics }] = stale;
      return [
        [
          "[autopilot:skill-review]",
          `Проверь актуальность скилла ${name}: last_used=${metrics.last_used}.`,
          "Если workflow устарел, обнови его через update_skill; если актуален, зафиксируй вывод в memory.",
        ].join("\n"),
      ];
    }

    return [];
  }

  private async buildRecurringErrorTasks(): Promise<string[]> {
    const errors = await this.learningLogger.readRecentEntries("errors", 20);
    const recurring = frequentPatterns(errors, 2);

    return recurring.map((pattern) =>
      [
        "[autopilot:learning-error]",
        `Разбери повторяющийся failure pattern: ${pattern.summary}`,
        "Изучи data/learnings/ERRORS.md, найди минимальную причину и исправь один маленький gap.",
        "Если pattern повторяемый и workflow стал понятен, создай или обнови skill.",
      ].join("\n"),
    );
  }

  private async buildFeatureRequestTasks(): Promise<string[]> {
    const requests = await this.learningLogger.readRecentEntries("feature_requests", 10);

    return requests.map((request) =>
      [
        "[autopilot:learning-feature-request]",
        `Реализуй или уточни missing capability: ${request.summary}`,
        "Изучи data/learnings/FEATURE_REQUESTS.md и сделай минимальный безопасный шаг.",
        "Если scope слишком большой, добавь backlog/skill вместо широкой реализации.",
      ].join("\n"),
    );
  }

  private buildSelfDiscoveryTask(): string {
    return [
      "[autopilot:self-discovery]",
      this.config.SELF_IMPROVEMENT_TASK,
      "Самостоятельно выбери следующую маленькую задачу для улучшения Monster Agent.",
      "Сначала изучи текущее состояние: README.md, data/memory/decisions.json, data/learnings, data/runtime, data/tasks и tests.",
      "Выбери один проверяемый gap, реализуй минимальное изменение и добавь/обнови тест.",
      "Не делай косметику, dashboard polish или широкий refactor без явного сигнала из логов.",
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

function frequentPatterns(
  entries: RecentLearningEntry[],
  minCount: number,
): Array<{ summary: string; count: number }> {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const key = normalizePattern(entry.summary || entry.failureReason || "");
    if (!key) {
      continue;
    }
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return [...counts.entries()]
    .filter(([, count]) => count >= minCount)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([summary, count]) => ({ summary, count }));
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
