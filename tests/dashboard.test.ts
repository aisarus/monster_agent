import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { startDashboardServer } from "../src/dashboard.js";
import { SkillEvaluator } from "../src/skills/SkillEvaluator.js";
import { SkillLoader } from "../src/skills/SkillLoader.js";
import type { AppConfig } from "../src/config.js";
import type { AgentRuntime } from "../src/agent.js";
import type { SelfImprovementScheduler } from "../src/scheduler.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "monster-agent-dashboard-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("serves dashboard html and snapshot api", async () => {
  const config = configFixture(await freePort());
  await writeFile(
    config.TASKS_FILE,
    JSON.stringify({
      tasks: [
        {
          id: "task-1",
          text: "Check runtime",
          status: "completed",
          createdAt: "2026-04-19T00:00:00.000Z",
          updatedAt: "2026-04-19T00:01:00.000Z",
          result: "ok",
        },
      ],
    }),
    "utf8",
  );

  const server = startDashboardServer({
    config,
    agent: agentFixture(),
    scheduler: schedulerFixture(),
    skillLoader: new SkillLoader(join(dir, "skills")),
    skillEvaluator: new SkillEvaluator(join(dir, "metrics.json")),
  });

  try {
    const html = await fetch(server.url).then((response) => response.text());
    const snapshot = await fetch(`${server.url}/api/snapshot`).then((response) => response.json());

    expect(html).toContain("Monster Agent");
    expect(snapshot.tasks.completed).toBe(1);
    expect(snapshot.runtime.defaultProvider).toBe("gemini");
  } finally {
    await server.close();
  }
});

test("queues tasks through dashboard api", async () => {
  const queued: string[] = [];
  const server = startDashboardServer({
    config: configFixture(await freePort()),
    agent: agentFixture(queued),
    scheduler: schedulerFixture(),
    skillLoader: new SkillLoader(join(dir, "skills")),
    skillEvaluator: new SkillEvaluator(join(dir, "metrics.json")),
  });

  try {
    const response = await fetch(`${server.url}/api/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Build a dashboard" }),
    });

    expect(response.ok).toBe(true);
    expect(queued).toEqual(["Build a dashboard"]);
  } finally {
    await server.close();
  }
});

function configFixture(port: number): AppConfig {
  return {
    TELEGRAM_BOT_TOKEN: "token",
    TELEGRAM_OWNER_ID: "1",
    OPENAI_API_KEY: undefined,
    OPENAI_DEFAULT_MODEL: "gpt-4o-mini",
    GROQ_API_KEY: undefined,
    GROQ_DEFAULT_MODEL: "llama-3.1-8b-instant",
    GITHUB_TOKEN: undefined,
    BRAVE_API_KEY: undefined,
    OLLAMA_ENABLED: false,
    OLLAMA_BASE_URL: "http://127.0.0.1:11434",
    OLLAMA_MODEL: "qwen2.5-coder:1.5b",
    GEMINI_API_KEY: undefined,
    GEMINI_DEFAULT_MODEL: "gemini-1.5-flash",
    GEMINI_FALLBACK_MODELS: "",
    DEFAULT_PROVIDER: "gemini",
    MONTHLY_BUDGET_USD: 10,
    DAILY_BUDGET_USD: 1,
    HEARTBEAT_MINUTES: 15,
    MAX_PARALLEL_SUBAGENTS: 2,
    WORKSPACE_ROOT: ".",
    BOOTSTRAP_DIR: "data/workspace",
    MAX_AGENT_STEPS: 12,
    AGENT_MEMORY_CONTEXT_CHARS: 2000,
    AGENT_TOOL_OUTPUT_CHARS: 2000,
    BOOTSTRAP_MAX_TOTAL_CHARS: 6000,
    BOOTSTRAP_MAX_FILE_CHARS: 1600,
    MEMORY_FILE: join(dir, "memory.md"),
    TASKS_FILE: join(dir, "tasks.json"),
    BUDGET_FILE: join(dir, "budget.json"),
    SKILL_METRICS_FILE: join(dir, "metrics.json"),
    LEARNINGS_DIR: join(dir, "learnings"),
    MODEL_COOLDOWNS_FILE: join(dir, "cooldowns.json"),
    RUNTIME_STATE_FILE: join(dir, "runtime.json"),
    DASHBOARD_ENABLED: true,
    DASHBOARD_HOST: "127.0.0.1",
    DASHBOARD_PORT: port,
    DASHBOARD_TOKEN: undefined,
    REPORT_INTERVAL_MINUTES: 30,
    SELF_IMPROVEMENT_ENABLED: false,
    SELF_IMPROVEMENT_INTERVAL_MINUTES: 60,
    SELF_IMPROVEMENT_TASK: "fallback task",
  };
}

function agentFixture(queued: string[] = []): AgentRuntime {
  return {
    async enqueue(text: string) {
      queued.push(text);
      return {
        id: "task-id",
        text,
        status: "queued",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    },
    kick() {},
    async pause() {
      return "paused";
    },
    async resume() {
      return "resumed";
    },
  } as AgentRuntime;
}

function schedulerFixture(): SelfImprovementScheduler {
  return {
    status() {
      return "Autopilot: disabled";
    },
    enable() {
      return "Autopilot enabled.";
    },
    disable() {
      return "Autopilot disabled.";
    },
    async runNow() {
      return "Autopilot queued task.";
    },
  } as SelfImprovementScheduler;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}
