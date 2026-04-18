import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve, relative, dirname } from "node:path";
import { mkdir } from "node:fs/promises";
import { promisify } from "node:util";
import { checkCommandSafety, findPotentialSecrets } from "./safety.js";

const execFileAsync = promisify(execFile);

export type ToolResult = {
  ok: boolean;
  output: string;
};

export class WorkspaceTools {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  async listFiles(path = "."): Promise<ToolResult> {
    const dir = this.resolveInside(path);
    const entries = await readdir(dir, { withFileTypes: true });
    const lines = entries
      .filter((entry) => entry.name !== "node_modules" && entry.name !== ".git")
      .map((entry) => `${entry.isDirectory() ? "dir " : "file"} ${entry.name}`)
      .sort();
    return { ok: true, output: lines.join("\n") || "(empty)" };
  }

  async readFile(path: string): Promise<ToolResult> {
    const file = this.resolveInside(path);
    const info = await stat(file);
    if (info.size > 80_000) {
      return { ok: false, output: "File is too large to read through this tool." };
    }
    return { ok: true, output: await readFile(file, "utf8") };
  }

  async writeFile(path: string, content: string): Promise<ToolResult> {
    const secrets = findPotentialSecrets(content);
    if (secrets.length > 0) {
      return { ok: false, output: "Write blocked: content looks like it contains secrets." };
    }

    const file = this.resolveInside(path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, content, "utf8");
    return { ok: true, output: `Wrote ${path}` };
  }

  async runCommand(command: string): Promise<ToolResult> {
    const safety = checkCommandSafety(command);
    if (!safety.allowed) {
      return { ok: false, output: safety.reason ?? "Command blocked." };
    }

    try {
      const { stdout, stderr } = await execFileAsync("bash", ["-lc", command], {
        cwd: this.root,
        timeout: 120_000,
        maxBuffer: 120_000,
      });
      return {
        ok: true,
        output: [stdout, stderr].filter(Boolean).join("\n").trim() || "(no output)",
      };
    } catch (error) {
      const err = error as { stdout?: string; stderr?: string; message?: string };
      return {
        ok: false,
        output: [err.stdout, err.stderr, err.message].filter(Boolean).join("\n").slice(0, 4000),
      };
    }
  }

  async gitStatus(): Promise<ToolResult> {
    return this.runCommand("git status --short");
  }

  async gitBranch(name: string): Promise<ToolResult> {
    const status = await this.execGit(["status", "--porcelain"]);
    if (!status.ok) {
      return status;
    }

    if (status.output.trim()) {
      return {
        ok: false,
        output: "Cannot create a task branch while the workspace has uncommitted changes.",
      };
    }

    const branch = normalizeBranchName(name);
    if (!branch) {
      return { ok: false, output: "Branch name is empty after normalization." };
    }

    const checkout = await this.execGit(["checkout", "-B", branch]);
    if (!checkout.ok) {
      return checkout;
    }

    return { ok: true, output: `Switched to branch ${branch}` };
  }

  async gitCommit(message: string): Promise<ToolResult> {
    const status = await this.execGit(["status", "--porcelain"]);
    if (!status.ok) {
      return status;
    }

    if (!status.output.trim()) {
      return { ok: false, output: "No changes to commit." };
    }

    const secretCheck = await this.checkChangedFilesForSecrets(status.output);
    if (!secretCheck.ok) {
      return secretCheck;
    }

    const add = await this.execGit(["add", "-A"]);
    if (!add.ok) {
      return add;
    }

    const commit = await this.execGit(["commit", "-m", message.trim().slice(0, 160)]);
    if (!commit.ok) {
      return commit;
    }

    return { ok: true, output: commit.output };
  }

  async gitPush(): Promise<ToolResult> {
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      return { ok: false, output: "GITHUB_TOKEN is missing in environment." };
    }

    const remote = await this.execGit(["remote", "get-url", "origin"]);
    if (!remote.ok) {
      return remote;
    }

    const remoteUrl = remote.output.trim();
    const match = /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?$/.exec(remoteUrl);
    if (!match) {
      return {
        ok: false,
        output: "git_push supports only HTTPS GitHub origin URLs like https://github.com/owner/repo.git.",
      };
    }

    const branch = await this.currentBranch();
    if (!branch.ok) {
      return branch;
    }

    const [, owner, repo] = match;
    const pushUrl = `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
    const push = await this.execGit(["push", pushUrl, `HEAD:${branch.output.trim()}`], {
      GIT_TERMINAL_PROMPT: "0",
    });
    if (!push.ok) {
      return push;
    }

    await this.execGit(["fetch", "origin", branch.output.trim()]);
    return {
      ok: true,
      output: push.output.replaceAll(token, "[redacted]"),
    };
  }

  private resolveInside(path: string): string {
    const target = resolve(this.root, path);
    const rel = relative(this.root, target);
    if (rel.startsWith("..") || rel === ".." || target !== this.root && rel.startsWith(`..`)) {
      throw new Error(`Path escapes workspace: ${path}`);
    }
    return target;
  }

  private async execGit(args: string[], env?: NodeJS.ProcessEnv): Promise<ToolResult> {
    try {
      const { stdout, stderr } = await execFileAsync("git", args, {
        cwd: this.root,
        timeout: 120_000,
        maxBuffer: 120_000,
        env: { ...process.env, ...env },
      });
      return {
        ok: true,
        output: [stdout, stderr].filter(Boolean).join("\n").trim() || "(no output)",
      };
    } catch (error) {
      const err = error as { stdout?: string; stderr?: string; message?: string };
      return {
        ok: false,
        output: [err.stdout, err.stderr, err.message].filter(Boolean).join("\n").slice(0, 4000),
      };
    }
  }

  private async currentBranch(): Promise<ToolResult> {
    const branch = await this.execGit(["branch", "--show-current"]);
    if (!branch.ok) {
      return branch;
    }

    const name = branch.output.trim();
    if (!name) {
      return { ok: false, output: "Cannot push from detached HEAD." };
    }

    return { ok: true, output: name };
  }

  private async checkChangedFilesForSecrets(statusOutput: string): Promise<ToolResult> {
    for (const line of statusOutput.split("\n")) {
      const path = changedPathFromStatusLine(line);
      if (!path) {
        continue;
      }

      const file = this.resolveInside(path);
      if (!existsSync(file)) {
        continue;
      }

      const info = await stat(file);
      if (!info.isFile() || info.size > 500_000) {
        continue;
      }

      const content = await readFile(file, "utf8");
      const secrets = findPotentialSecrets(content);
      if (secrets.length > 0) {
        return {
          ok: false,
          output: `Commit blocked: ${path} looks like it contains secrets.`,
        };
      }
    }

    return { ok: true, output: "No obvious secrets found in changed files." };
  }
}

function normalizeBranchName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._/-]+/g, "-")
    .replace(/\/+/g, "/")
    .replace(/-+/g, "-")
    .replace(/^[/.:-]+|[/.:-]+$/g, "")
    .slice(0, 80);
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

  const renameSeparator = " -> ";
  return path.includes(renameSeparator) ? path.split(renameSeparator).at(-1) : path;
}
