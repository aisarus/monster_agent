import { readJsonFile, writeJsonFile } from "../storage/fs.js";

export type FailureKind =
  | "rate_limit"
  | "overloaded"
  | "billing"
  | "auth"
  | "model_not_found"
  | "context_overflow"
  | "not_configured"
  | "unknown";

type CooldownEntry = {
  provider: string;
  model: string;
  failureKind: FailureKind;
  errorCount: number;
  cooldownUntil: string;
  lastError: string;
  updatedAt: string;
};

type CooldownFile = {
  entries: Record<string, CooldownEntry>;
};

const emptyCooldownFile: CooldownFile = {
  entries: {},
};

const cooldownMs: Record<FailureKind, number> = {
  overloaded: 15_000,
  rate_limit: 60_000,
  billing: 24 * 60 * 60 * 1000,
  auth: 60 * 60 * 1000,
  model_not_found: 24 * 60 * 60 * 1000,
  context_overflow: 0,
  not_configured: 24 * 60 * 60 * 1000,
  unknown: 30_000,
};

export class ModelCooldowns {
  constructor(private readonly filePath: string) {}

  async isCoolingDown(provider: string, model: string): Promise<string | undefined> {
    const file = await this.read();
    const entry = file.entries[key(provider, model)];
    if (!entry) {
      return undefined;
    }

    const until = Date.parse(entry.cooldownUntil);
    if (Number.isNaN(until) || until <= Date.now()) {
      delete file.entries[key(provider, model)];
      await this.write(file);
      return undefined;
    }

    return entry.cooldownUntil;
  }

  async recordFailure(
    provider: string,
    model: string,
    failureKind: FailureKind,
    error: unknown,
  ): Promise<void> {
    const delay = cooldownMs[failureKind];
    if (delay <= 0) {
      return;
    }

    const file = await this.read();
    const id = key(provider, model);
    const previous = file.entries[id];
    const errorCount = (previous?.errorCount ?? 0) + 1;
    const multiplier = failureKind === "overloaded" ? 1 : Math.min(errorCount, 5);
    const cooldownUntil = new Date(Date.now() + delay * multiplier).toISOString();

    file.entries[id] = {
      provider,
      model,
      failureKind,
      errorCount,
      cooldownUntil,
      lastError: compactError(error),
      updatedAt: new Date().toISOString(),
    };

    await this.write(file);
  }

  async summary(): Promise<string> {
    const file = await this.read();
    const active = Object.values(file.entries).filter(
      (entry) => Date.parse(entry.cooldownUntil) > Date.now(),
    );
    if (active.length === 0) {
      return "Model cooldowns: none";
    }
    return [
      "Model cooldowns:",
      ...active.map(
        (entry) =>
          `- ${entry.provider}/${entry.model}: ${entry.failureKind} until ${entry.cooldownUntil}`,
      ),
    ].join("\n");
  }

  private read(): Promise<CooldownFile> {
    return readJsonFile(this.filePath, emptyCooldownFile);
  }

  private write(file: CooldownFile): Promise<void> {
    return writeJsonFile(this.filePath, file);
  }
}

export function classifyModelFailure(error: unknown, provider?: string): FailureKind {
  const message = compactError(error).toLowerCase();

  if (message.includes("api key") || message.includes("unauthorized") || message.includes("401")) {
    return "auth";
  }
  if (message.includes("not configured")) {
    return "not_configured";
  }
  if (
    message.includes("quota exceeded") ||
    message.includes("rate limit") ||
    message.includes("too many requests") ||
    message.includes("429")
  ) {
    if (message.includes("spending cap") || message.includes("spend cap")) {
      return "billing";
    }
    if (provider === "gemini") {
      return "rate_limit";
    }
    if (message.includes("free_tier")) {
      return "rate_limit";
    }
    if (message.includes("billing details") || message.includes("check your plan")) {
      return "billing";
    }
    return "rate_limit";
  }
  if (
    message.includes("503") ||
    message.includes("high demand") ||
    message.includes("overloaded") ||
    message.includes("temporarily unavailable")
  ) {
    return "overloaded";
  }
  if (message.includes("404") || message.includes("not found") || message.includes("not supported")) {
    return "model_not_found";
  }
  if (
    message.includes("context") ||
    message.includes("too long") ||
    message.includes("maximum number of tokens")
  ) {
    return "context_overflow";
  }

  return "unknown";
}

export function compactError(error: unknown): string {
  const message = (error as Error).message ?? String(error);
  return message.replace(/\s+/g, " ").slice(0, 500);
}

function key(provider: string, model: string): string {
  return `${provider}/${model}`;
}
