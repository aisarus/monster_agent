import { readJsonFile, writeJsonFile } from "../storage/fs.js";
import { type Skill } from "./SkillLoader.js";

export interface SkillVersionHistoryEntry {
  version: string;
  success_rate: number;
  period: string;
}

export interface SkillMetrics {
  invocations: number;
  successes: number;
  failures: number;
  task_success_rate: number;
  avg_steps_saved: number;
  last_used?: string;
  failure_reasons: string[];
  current_version?: string;
  version_started_at?: string;
  version_history: SkillVersionHistoryEntry[];
}

export interface SkillMetricsFile {
  skills: Record<string, SkillMetrics>;
}

export interface SkillTaskResult {
  taskId: string;
  skillNames: string[];
  success: boolean;
  failureReason?: string;
  stepsSaved?: number;
}

const emptyMetricsFile: SkillMetricsFile = {
  skills: {},
};

export class SkillEvaluator {
  private lock: Promise<void> = Promise.resolve();

  constructor(private readonly filePath = "data/skills/metrics.json") {}

  readMetrics(): Promise<SkillMetricsFile> {
    return readJsonFile(this.filePath, emptyMetricsFile);
  }

  async recordInvocation(skill: Skill): Promise<void> {
    await this.withLock(async () => {
      const file = await this.readMetrics();
      const now = new Date().toISOString();
      const metrics = ensureSkillMetrics(file, skill.name, now);
      updateVersionHistory(metrics, skill.version, now);
      metrics.invocations += 1;
      metrics.last_used = now;
      await writeJsonFile(this.filePath, file);
    });
  }

  async recordTaskResult(result: SkillTaskResult): Promise<void> {
    const skillNames = [...new Set(result.skillNames)].filter(Boolean);
    if (skillNames.length === 0) {
      return;
    }

    await this.withLock(async () => {
      const file = await this.readMetrics();
      const now = new Date().toISOString();
      for (const name of skillNames) {
        const metrics = ensureSkillMetrics(file, name, now);
        if (result.success) {
          metrics.successes += 1;
        } else {
          metrics.failures += 1;
          if (result.failureReason) {
            metrics.failure_reasons = compactFailureReasons([
              ...metrics.failure_reasons,
              compactFailureReason(result.failureReason),
            ]);
          }
        }

        if (typeof result.stepsSaved === "number" && Number.isFinite(result.stepsSaved)) {
          metrics.avg_steps_saved =
            metrics.avg_steps_saved === 0
              ? result.stepsSaved
              : (metrics.avg_steps_saved + result.stepsSaved) / 2;
        }

        metrics.task_success_rate = calculateSuccessRate(metrics);
      }
      await writeJsonFile(this.filePath, file);
    });
  }

  async recordVersionSnapshot(skill: Skill): Promise<void> {
    await this.withLock(async () => {
      const file = await this.readMetrics();
      const now = new Date().toISOString();
      const metrics = ensureSkillMetrics(file, skill.name, now);
      updateVersionHistory(metrics, skill.version, now);
      await writeJsonFile(this.filePath, file);
    });
  }

  async getUnderperformingSkills(
    threshold = 0.7,
  ): Promise<Array<{ name: string; metrics: SkillMetrics }>> {
    const file = await this.readMetrics();
    return Object.entries(file.skills)
      .filter(([, metrics]) => sampleSize(metrics) >= 2)
      .filter(([, metrics]) => metrics.task_success_rate < threshold)
      .sort((a, b) => a[1].task_success_rate - b[1].task_success_rate)
      .map(([name, metrics]) => ({ name, metrics }));
  }

  async getStaleSkills(days = 14): Promise<Array<{ name: string; metrics: SkillMetrics }>> {
    const file = await this.readMetrics();
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    return Object.entries(file.skills)
      .filter(([, metrics]) => Boolean(metrics.last_used))
      .filter(([, metrics]) => Date.parse(metrics.last_used as string) < cutoff)
      .sort((a, b) => (a[1].last_used ?? "").localeCompare(b[1].last_used ?? ""))
      .map(([name, metrics]) => ({ name, metrics }));
  }

  async buildImprovementTask(): Promise<string | null> {
    const underperforming = await this.getUnderperformingSkills(0.7);
    if (underperforming.length > 0) {
      const [{ name, metrics }] = underperforming;
      return [
        `[autopilot:skill-improvement]`,
        `Улучши скилл ${name}: task_success_rate=${metrics.task_success_rate.toFixed(2)}.`,
        "Изучи failure_reasons, обнови SKILL.md через update_skill и добавь/обнови тесты если нужно.",
      ].join("\n");
    }

    const stale = await this.getStaleSkills(14);
    if (stale.length > 0) {
      const [{ name, metrics }] = stale;
      return [
        `[autopilot:skill-review]`,
        `Проверь актуальность скилла ${name}: last_used=${metrics.last_used}.`,
        "Если workflow устарел, обнови его через update_skill; если актуален, зафиксируй вывод в memory.",
      ].join("\n");
    }

    return null;
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.lock;
    let release!: () => void;
    this.lock = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

function ensureSkillMetrics(file: SkillMetricsFile, name: string, now: string): SkillMetrics {
  file.skills[name] ??= {
    invocations: 0,
    successes: 0,
    failures: 0,
    task_success_rate: 0,
    avg_steps_saved: 0,
    failure_reasons: [],
    version_started_at: now,
    version_history: [],
  };
  return file.skills[name];
}

function updateVersionHistory(metrics: SkillMetrics, version: string, now: string): void {
  if (!metrics.current_version) {
    metrics.current_version = version;
    metrics.version_started_at ??= now;
    return;
  }

  if (metrics.current_version === version) {
    return;
  }

  metrics.version_history.push({
    version: metrics.current_version,
    success_rate: metrics.task_success_rate,
    period: `${metrics.version_started_at ?? now}/${now}`,
  });
  metrics.current_version = version;
  metrics.version_started_at = now;
}

function calculateSuccessRate(metrics: SkillMetrics): number {
  const total = sampleSize(metrics);
  if (total === 0) {
    return 0;
  }
  return Number((metrics.successes / total).toFixed(4));
}

function sampleSize(metrics: SkillMetrics): number {
  return metrics.successes + metrics.failures;
}

function compactFailureReason(reason: string): string {
  return reason.replace(/\s+/g, " ").trim().slice(0, 160);
}

function compactFailureReasons(reasons: string[]): string[] {
  return reasons.filter(Boolean).slice(-20);
}
