import { BudgetTracker } from "./budget.js";
import { RuntimeState } from "./runtime-state.js";
import { TaskQueue, type AgentTask } from "./tasks.js";

export class ActivityReporter {
  private timer: NodeJS.Timeout | undefined;
  private lastReportAt = new Date().toISOString();

  constructor(
    private readonly intervalMinutes: number,
    private readonly runtimeState: RuntimeState,
    private readonly tasks: TaskQueue,
    private readonly budget: BudgetTracker,
    private readonly notify: (message: string) => Promise<void>,
  ) {}

  start(): void {
    this.timer = setInterval(() => {
      void this.sendReport();
    }, this.intervalMinutes * 60 * 1000);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  async sendReport(): Promise<void> {
    const now = new Date().toISOString();
    const changedTasks = await this.tasks.changedSince(this.lastReportAt);
    this.lastReportAt = now;

    if (await this.runtimeState.isPaused()) {
      return;
    }

    await this.notify(await this.formatReport(changedTasks));
  }

  private async formatReport(changedTasks: AgentTask[]): Promise<string> {
    const completed = changedTasks.filter((task) => task.status === "completed");
    const failed = changedTasks.filter((task) => task.status === "failed");
    const stopped = changedTasks.filter((task) => task.status === "stopped");
    const queued = changedTasks.filter((task) => task.status === "queued");
    const running = changedTasks.filter((task) => task.status === "running");

    const lines = [
      `Отчёт за последние ${this.intervalMinutes} минут.`,
      await this.runtimeState.status(),
      await this.tasks.status(),
      await this.budget.status(),
      "",
    ];

    if (changedTasks.length === 0) {
      lines.push("За этот период новых завершённых действий не было.");
      return lines.join("\n");
    }

    lines.push(
      [
        "Что изменилось:",
        `- завершил: ${completed.length}`,
        `- выполняется сейчас: ${running.length}`,
        `- поставлено в очередь: ${queued.length}`,
        `- остановлено: ${stopped.length}`,
        `- с ошибкой: ${failed.length}`,
      ].join("\n"),
    );

    const finished = [...completed, ...failed, ...stopped].slice(-5);
    if (finished.length > 0) {
      lines.push("");
      lines.push("Последние результаты:");
      for (const task of finished) {
        lines.push(`- ${taskLabel(task)}: ${taskSummary(task)}`);
      }
    }

    return lines.join("\n");
  }
}

function taskLabel(task: AgentTask): string {
  return `${task.id.slice(0, 8)} ${task.status}`;
}

function taskSummary(task: AgentTask): string {
  const source = task.result ?? task.error ?? task.text;
  return source.replace(/\s+/g, " ").trim().slice(0, 220) || "без подробностей";
}
