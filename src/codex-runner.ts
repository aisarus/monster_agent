import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import type { AppConfig } from "./config.js";
import { readJsonFile, writeJsonFile } from "./storage/fs.js";
import { findPotentialSecrets } from "./tools/safety.js";

const execFileAsync = promisify(execFile);

type ExecResult = {
  stdout: string;
  stderr: string;
};

type ExecFn = (
  file: string,
  args: string[],
  options: { cwd: string; timeout: number; maxBuffer: number; env?: NodeJS.ProcessEnv },
) => Promise<ExecResult>;

type NoopFile = {
  entries: Record<string, { taskKey: string; taskText: string; at: string; summary: string }>;
};

const emptyNoopFile: NoopFile = { entries: {} };

export class CodexRunner {
  private running = false;
  private lastStartedAt: string | undefined;
  private activeTask = "";

  constructor(
    private readonly config: AppConfig,
    private readonly notify: (message: string) => Promise<void>,
    private readonly execFn: ExecFn = execFileAsync,
  ) {}

  status(): string {
    return [
      `Codex runner: ${this.running ? "running" : "idle"}`,
      `Last started: ${this.lastStartedAt ?? "never"}`,
      this.running && this.activeTask ? `Task: ${compactTask(this.activeTask)}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  async run(taskText: string): Promise<string> {
    if (this.running) {
      return "Codex already running.";
    }

    this.running = true;
    this.lastStartedAt = new Date().toISOString();
    this.activeTask = taskText;
    void this.execute(taskText).finally(() => {
      this.running = false;
      this.activeTask = "";
    });

    return "Codex run started.";
  }

  async recentlyNooped(taskText: string): Promise<boolean> {
    const entry = (await this.readNoops()).entries[taskKey(taskText)];
    if (!entry) {
      return false;
    }

    const ageMs = Date.now() - Date.parse(entry.at);
    return Number.isFinite(ageMs) && ageMs < this.config.CODEX_NOOP_COOLDOWN_MINUTES * 60 * 1000;
  }

  private async execute(taskText: string): Promise<void> {
    try {
      await this.notify(["Codex started.", compactTask(taskText)].join("\n"));

      const dirty = await this.git(["status", "--porcelain"]);
      if (dirty.trim()) {
        await this.notify(["Codex skipped: workspace dirty.", compact(dirty, 1200)].join("\n"));
        return;
      }

      const outputPath = resolve(this.config.WORKSPACE_ROOT, "data/runtime/codex-last-message.md");
      await mkdir(dirname(outputPath), { recursive: true });

      const codexArgs = [
        "exec",
        "--full-auto",
        "-C",
        this.config.WORKSPACE_ROOT,
        "--output-last-message",
        outputPath,
      ];
      if (this.config.CODEX_MODEL) {
        codexArgs.push("-m", this.config.CODEX_MODEL);
      }
      codexArgs.push(buildCodexPrompt(taskText));

      await this.runCodexWithProgress(codexArgs, taskText);
      const summary = await readOptional(outputPath);

      const checks = await this.runChecks();
      if (!checks.ok) {
        await this.notify(["Codex finished, checks failed.", compact(checks.output, 1800)].join("\n"));
        return;
      }

      const status = await this.git(["status", "--porcelain"]);
      if (!status.trim()) {
        await this.recordNoop(taskText, summary);
        await this.notify(["Codex finished: no changes.", compact(summary, 1200)].join("\n"));
        return;
      }

      const secretCheck = await this.checkChangedFilesForSecrets(status);
      if (!secretCheck.ok) {
        await this.notify(`Codex finished, commit blocked: ${secretCheck.reason}`);
        return;
      }

      await this.git(["add", "-A"]);
      const message = `chore: codex self-improvement ${new Date().toISOString().slice(0, 10)}`;
      await this.git(["commit", "-m", message]);
      const head = (await this.git(["rev-parse", "--short", "HEAD"])).trim();
      const push = await this.push();

      await this.notify(
        [
          "Codex done.",
          `Commit: ${head}`,
          push ? "Pushed: yes" : "Pushed: no",
          compact(summary, 1000),
        ].join("\n"),
      );
    } catch (error) {
      await this.notify(`Codex failed: ${compact((error as Error).message, 1800)}`);
    }
  }

  private async runChecks(): Promise<{ ok: boolean; output: string }> {
    try {
      const result = await this.execFn(
        "bash",
        ["-lc", "npm run typecheck && npm run lint && npm test && npm run build"],
        this.execOptions(10),
      );
      return { ok: true, output: [result.stdout, result.stderr].filter(Boolean).join("\n") };
    } catch (error) {
      const err = error as { stdout?: string; stderr?: string; message?: string };
      return {
        ok: false,
        output: [err.stdout, err.stderr, err.message].filter(Boolean).join("\n"),
      };
    }
  }

  private async runCodexWithProgress(args: string[], taskText: string): Promise<void> {
    const started = Date.now();
    const intervalMs = this.config.CODEX_PROGRESS_INTERVAL_MINUTES * 60 * 1000;
    const timer =
      intervalMs > 0
        ? setInterval(() => {
            void this.notifyProgress(started, taskText);
          }, intervalMs)
        : undefined;

    try {
      await this.execFn("codex", args, this.execOptions(this.config.CODEX_TIMEOUT_MINUTES));
    } catch (error) {
      if (isTimeoutError(error)) {
        await this.notify(
          [
            "Codex timeout.",
            `Elapsed: ${formatElapsed(Date.now() - started)}`,
            `Limit: ${this.config.CODEX_TIMEOUT_MINUTES} min`,
            compactTask(taskText),
          ].join("\n"),
        );
      }
      throw error;
    } finally {
      if (timer) {
        clearInterval(timer);
      }
    }
  }

  private async notifyProgress(started: number, taskText: string): Promise<void> {
    const status = await this.git(["status", "--porcelain"]).catch((error: unknown) =>
      `git status failed: ${(error as Error).message}`,
    );
    await this.notify(
      [
        "Codex still running.",
        `Elapsed: ${formatElapsed(Date.now() - started)}`,
        compactTask(taskText),
        status.trim() ? `Changed:\n${compact(status, 1000)}` : "Workspace: clean",
      ].join("\n"),
    );
  }

  private async recordNoop(taskText: string, summary: string): Promise<void> {
    const file = await this.readNoops();
    const key = taskKey(taskText);
    file.entries[key] = {
      taskKey: key,
      taskText: compact(taskText, 1000),
      at: new Date().toISOString(),
      summary: compact(summary, 1000),
    };
    await writeJsonFile(this.noopPath(), file);
  }

  private readNoops(): Promise<NoopFile> {
    return readJsonFile(this.noopPath(), emptyNoopFile);
  }

  private noopPath(): string {
    return resolve(this.config.WORKSPACE_ROOT, "data/runtime/codex-noop.json");
  }

  private async checkChangedFilesForSecrets(
    statusOutput: string,
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    for (const line of statusOutput.split("\n")) {
      const path = changedPathFromStatusLine(line);
      if (!path || path === ".env" || path.startsWith(".env.")) {
        continue;
      }

      const file = resolve(this.config.WORKSPACE_ROOT, path);
      if (!existsSync(file)) {
        continue;
      }

      const info = await stat(file);
      if (!info.isFile() || info.size > 500_000) {
        continue;
      }

      const content = await readFile(file, "utf8");
      if (findPotentialSecrets(content).length > 0) {
        return { ok: false, reason: `${path} looks like it contains secrets.` };
      }
    }

    return { ok: true };
  }

  private async push(): Promise<boolean> {
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      return false;
    }

    const remote = (await this.git(["remote", "get-url", "origin"])).trim();
    const match = /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?$/.exec(remote);
    if (!match) {
      return false;
    }

    const branch = (await this.git(["branch", "--show-current"])).trim();
    if (!branch) {
      return false;
    }

    const pushUrl = `https://x-access-token:${token}@github.com/${match[1]}/${match[2]}.git`;
    await this.git(["push", pushUrl, `HEAD:${branch}`], { GIT_TERMINAL_PROMPT: "0" });
    await this.git(["fetch", "origin", branch]);
    return true;
  }

  private git(args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
    return this.execFn("git", args, { ...this.execOptions(2), env: { ...process.env, ...env } }).then(
      (result) => [result.stdout, result.stderr].filter(Boolean).join("\n").trim(),
    );
  }

  private execOptions(minutes: number): { cwd: string; timeout: number; maxBuffer: number } {
    return {
      cwd: this.config.WORKSPACE_ROOT,
      timeout: minutes * 60 * 1000,
      maxBuffer: 2_000_000,
    };
  }
}

function buildCodexPrompt(taskText: string): string {
  return [
    "You are Codex running inside the Monster Agent repository.",
    "Goal: make one small safe improvement for the daemon.",
    "",
    "Task:",
    taskText,
    "",
    "Rules:",
    "- Do not edit .env or print secrets.",
    "- Keep the change narrow.",
    "- Prefer fixing the root cause over adding UI polish.",
    "- Run exactly: npm run typecheck && npm run lint && npm test && npm run build",
    "- Do not commit or push. The daemon will commit and push after checks.",
    "- Final answer must be short Russian: what changed, checks result, remaining risk.",
  ].join("\n");
}

function compactTask(text: string): string {
  return compact(text.replace(/\s+/g, " ").trim(), 700);
}

function taskKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/\d+(?:\.\d+)?/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

function compact(text: string, maxLength: number): string {
  const value = text.trim();
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

function isTimeoutError(error: unknown): boolean {
  const err = error as { code?: string; signal?: string; message?: string };
  return (
    err.code === "ETIMEDOUT" ||
    err.signal === "SIGTERM" ||
    /timed out|timeout/i.test(err.message ?? "")
  );
}

async function readOptional(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

function changedPathFromStatusLine(line: string): string | undefined {
  if (line.length < 4) {
    return undefined;
  }

  const status = line.slice(0, 2);
  if (status === " D") {
    return undefined;
  }

  const path = line.slice(3).trim();
  if (!path) {
    return undefined;
  }

  return path.includes(" -> ") ? path.split(" -> ").at(-1) : path;
}
