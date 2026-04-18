import { readTextFile, writeTextFile } from "../storage/fs.js";

export type LearningLogKind = "learnings" | "errors" | "feature_requests";

export interface LearningEntry {
  timestamp: string;
  kind: LearningLogKind;
  summary: string;
  details?: string;
  taskId?: string;
  failureReason?: string;
  relatedFiles?: string[];
}

export interface RecentLearningEntry extends LearningEntry {
  file: string;
}

const logFiles: Record<LearningLogKind, string> = {
  learnings: "LEARNINGS.md",
  errors: "ERRORS.md",
  feature_requests: "FEATURE_REQUESTS.md",
};

const seeds: Record<LearningLogKind, string> = {
  learnings: [
    "# Learnings",
    "",
    "Append-only notes about reusable findings from successful self-improvement work.",
    "",
  ].join("\n"),
  errors: [
    "# Errors",
    "",
    "Append-only compact task failures that should inform future self-improvement.",
    "",
  ].join("\n"),
  feature_requests: [
    "# Feature Requests",
    "",
    "Append-only missing capabilities requested by the owner or discovered during task execution.",
    "",
  ].join("\n"),
};

export class LearningLogger {
  private lock: Promise<void> = Promise.resolve();

  constructor(private readonly root = "data/learnings") {}

  async ensureInitialized(): Promise<void> {
    for (const kind of Object.keys(logFiles) as LearningLogKind[]) {
      const path = this.pathFor(kind);
      const existing = await readTextFile(path, "");
      if (!existing.trim()) {
        await writeTextFile(path, seeds[kind]);
      }
    }
  }

  async logLearning(entry: Omit<LearningEntry, "kind" | "timestamp">): Promise<void> {
    await this.appendEntry({ ...entry, kind: "learnings", timestamp: new Date().toISOString() });
  }

  async logError(entry: Omit<LearningEntry, "kind" | "timestamp">): Promise<void> {
    await this.appendEntry({ ...entry, kind: "errors", timestamp: new Date().toISOString() });
  }

  async logFeatureRequest(entry: Omit<LearningEntry, "kind" | "timestamp">): Promise<void> {
    await this.appendEntry({
      ...entry,
      kind: "feature_requests",
      timestamp: new Date().toISOString(),
    });
  }

  async readRecentEntries(kind: LearningLogKind, limit = 20): Promise<RecentLearningEntry[]> {
    await this.ensureInitialized();
    const path = this.pathFor(kind);
    const raw = await readTextFile(path, "");
    return parseEntries(raw, kind, path).slice(-limit).reverse();
  }

  private async appendEntry(entry: LearningEntry): Promise<void> {
    await this.withLock(async () => {
      await this.ensureInitialized();
      const path = this.pathFor(entry.kind);
      const existing = await readTextFile(path, "");
      await writeTextFile(path, `${existing.trimEnd()}\n\n${formatEntry(entry)}\n`);
    });
  }

  private pathFor(kind: LearningLogKind): string {
    return `${this.root}/${logFiles[kind]}`;
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

function formatEntry(entry: LearningEntry): string {
  const lines = [
    `## ${entry.timestamp} — ${entry.kind}`,
    `- summary: ${sanitize(entry.summary)}`,
  ];
  if (entry.taskId) lines.push(`- task: ${sanitize(entry.taskId.slice(0, 12))}`);
  if (entry.failureReason) lines.push(`- failure: ${sanitize(entry.failureReason)}`);
  if (entry.relatedFiles && entry.relatedFiles.length > 0) {
    lines.push(`- related_files: ${entry.relatedFiles.map(sanitize).join(", ")}`);
  }
  if (entry.details) lines.push(`- details: ${sanitize(entry.details)}`);
  return lines.join("\n");
}

function parseEntries(raw: string, kind: LearningLogKind, file: string): RecentLearningEntry[] {
  const blocks = raw.split(/\n(?=## )/g);
  const entries: RecentLearningEntry[] = [];
  for (const block of blocks) {
    const timestamp = /^##\s+(.+?)\s+—/.exec(block)?.[1];
    const summary = /^-\s+summary:\s+(.+)$/m.exec(block)?.[1];
    if (!timestamp || !summary) {
      continue;
    }
    entries.push({
      timestamp,
      kind,
      summary,
      file,
      taskId: /^-\s+task:\s+(.+)$/m.exec(block)?.[1],
      failureReason: /^-\s+failure:\s+(.+)$/m.exec(block)?.[1],
      details: /^-\s+details:\s+(.+)$/m.exec(block)?.[1],
      relatedFiles: /^-\s+related_files:\s+(.+)$/m
        .exec(block)?.[1]
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    });
  }
  return entries;
}

function sanitize(value: string): string {
  return value
    .replace(/(token|api[_-]?key|secret|password)\s*[:=]\s*\S+/gi, "$1=[redacted]")
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}
