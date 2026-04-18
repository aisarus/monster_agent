import { AgentRuntime } from "./agent.js";
import type { AppConfig } from "./config.js";
import { TaskQueue } from "./tasks.js";

export class SelfImprovementScheduler {
  private enabled: boolean;
  private timer: NodeJS.Timeout | undefined;
  private lastRunAt: string | undefined;

  constructor(
    private readonly config: AppConfig,
    private readonly agent: AgentRuntime,
    private readonly tasks: TaskQueue,
    private readonly notify: (message: string) => Promise<void>,
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
      `Interval: ${this.config.SELF_IMPROVEMENT_INTERVAL_MINUTES} min`,
      `Last run: ${this.lastRunAt ?? "never"}`,
    ].join("\n");
  }

  async runNow(): Promise<string> {
    if (await this.tasks.hasPendingWork()) {
      return "Autopilot run skipped: queue is busy.";
    }

    const task = await this.agent.enqueue(`[autopilot:self-improvement]\n${this.config.SELF_IMPROVEMENT_TASK}`);
    this.agent.kick();
    this.lastRunAt = new Date().toISOString();
    return `Autopilot queued task ${task.id.slice(0, 8)}.`;
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
