import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AppConfig } from "./config.js";
import { ModelCooldowns } from "./llm/failover.js";
import { WorkspaceTools } from "./tools/workspace.js";

type DoctorCheck = {
  name: string;
  status: "pass" | "warn" | "fail";
  detail: string;
};

export class Doctor {
  constructor(
    private readonly config: AppConfig,
    private readonly cooldowns: ModelCooldowns,
  ) {}

  async run(): Promise<string> {
    const checks: DoctorCheck[] = [];

    checks.push(checkValue("Telegram token", Boolean(this.config.TELEGRAM_BOT_TOKEN)));
    checks.push(checkValue("Telegram owner", Boolean(this.config.TELEGRAM_OWNER_ID)));
    checks.push(checkValue("Gemini key", Boolean(this.config.GEMINI_API_KEY), "warn"));
    checks.push(checkValue("OpenAI key", Boolean(this.config.OPENAI_API_KEY), "warn"));
    checks.push(checkValue("GitHub token", Boolean(this.config.GITHUB_TOKEN), "warn"));
    checks.push({
      name: "Default provider",
      status: "pass",
      detail: this.config.DEFAULT_PROVIDER,
    });
    checks.push({
      name: "Direct chat provider",
      status: "pass",
      detail: this.config.DIRECT_CHAT_PROVIDER,
    });
    checks.push({
      name: "Ollama",
      status: this.config.OLLAMA_ENABLED ? "pass" : "warn",
      detail: this.config.OLLAMA_ENABLED
        ? `${this.config.OLLAMA_BASE_URL} / ${this.config.OLLAMA_MODEL}`
        : "disabled",
    });
    checks.push({
      name: "Dashboard",
      status: this.config.DASHBOARD_ENABLED ? "pass" : "warn",
      detail: this.config.DASHBOARD_ENABLED
        ? this.config.DASHBOARD_PUBLIC_URL?.trim() ||
          `http://${this.config.DASHBOARD_HOST}:${this.config.DASHBOARD_PORT}`
        : "disabled",
    });

    checks.push(await checkFile("Memory file", this.config.MEMORY_FILE));
    checks.push(await checkJsonFile("Tasks JSON", this.config.TASKS_FILE));
    checks.push(await checkJsonFile("Budget JSON", this.config.BUDGET_FILE, "warn"));
    checks.push(await checkFile("Bootstrap AGENTS.md", join(this.config.BOOTSTRAP_DIR, "AGENTS.md")));
    checks.push(await checkFile("Bootstrap TOOLS.md", join(this.config.BOOTSTRAP_DIR, "TOOLS.md")));

    const workspace = new WorkspaceTools(this.config.WORKSPACE_ROOT);
    const git = await workspace.gitStatus();
    checks.push({
      name: "Git repo",
      status: git.ok ? "pass" : "warn",
      detail: git.ok ? "available" : "not initialized",
    });

    const remote = await workspace.runCommand("git remote get-url origin");
    checks.push({
      name: "GitHub origin",
      status: remote.ok && /^https:\/\/github\.com\/.+\/.+\.git$/.test(remote.output.trim())
        ? "pass"
        : "warn",
      detail: remote.ok ? redactUrl(remote.output.trim()) : "missing",
    });

    const summary = checks
      .map((check) => `${icon(check.status)} ${check.name}: ${check.detail}`)
      .join("\n");
    const counts = {
      pass: checks.filter((check) => check.status === "pass").length,
      warn: checks.filter((check) => check.status === "warn").length,
      fail: checks.filter((check) => check.status === "fail").length,
    };

    return [
      `Doctor: ${counts.pass} pass, ${counts.warn} warn, ${counts.fail} fail`,
      summary,
      await this.cooldowns.summary(),
    ].join("\n");
  }
}

function checkValue(name: string, ok: boolean, missingStatus: "warn" | "fail" = "fail"): DoctorCheck {
  return {
    name,
    status: ok ? "pass" : missingStatus,
    detail: ok ? "configured" : "missing",
  };
}

async function checkFile(name: string, path: string, missingStatus: "warn" | "fail" = "fail") {
  try {
    await access(path);
    return { name, status: "pass" as const, detail: path };
  } catch {
    return { name, status: missingStatus, detail: `missing: ${path}` };
  }
}

async function checkJsonFile(name: string, path: string, missingStatus: "warn" | "fail" = "fail") {
  try {
    JSON.parse(await readFile(path, "utf8"));
    return { name, status: "pass" as const, detail: path };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return {
      name,
      status: code === "ENOENT" ? missingStatus : "fail",
      detail: code === "ENOENT" ? `missing: ${path}` : `invalid JSON: ${path}`,
    };
  }
}

function icon(status: DoctorCheck["status"]): string {
  if (status === "pass") return "OK";
  if (status === "warn") return "WARN";
  return "FAIL";
}

function redactUrl(url: string): string {
  return url.replace(/x-access-token:[^@]+@/, "x-access-token:[redacted]@");
}
