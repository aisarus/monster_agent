import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { SelfImprovementScheduler } from "../src/scheduler.js";
import { LearningLogger } from "../src/skills/LearningLogger.js";
import { SkillEvaluator } from "../src/skills/SkillEvaluator.js";
import type { AppConfig } from "../src/config.js";
import type { AgentRuntime } from "../src/agent.js";
import type { TaskQueue } from "../src/tasks.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "monster-agent-scheduler-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("scheduler chooses underperforming skill improvement task before fallback", async () => {
  const evaluator = new SkillEvaluator(join(dir, "metrics.json"));
  await evaluator.recordTaskResult({
    taskId: "task-1",
    skillNames: ["git-workflow"],
    success: true,
  });
  await evaluator.recordTaskResult({
    taskId: "task-2",
    skillNames: ["git-workflow"],
    success: false,
    failureReason: "branch conflict",
  });

  const scheduler = new SelfImprovementScheduler(
    configFixture(),
    agentFixture(),
    taskQueueFixture(),
    evaluator,
    new LearningLogger(join(dir, "learnings")),
    async () => {},
  );

  await expect(scheduler.buildNextTaskText()).resolves.toContain("Улучши скилл git-workflow");
});

test("scheduler chooses recurring errors before feature requests and fallback", async () => {
  const learningLogger = new LearningLogger(join(dir, "learnings"));
  await learningLogger.logError({
    taskId: "task-1",
    summary: "telegram media parsing missing",
    failureReason: "Media parsing is not implemented.",
  });
  await learningLogger.logError({
    taskId: "task-2",
    summary: "telegram media parsing missing",
    failureReason: "Media parsing is not implemented.",
  });
  await learningLogger.logFeatureRequest({
    summary: "add voice transcription",
    details: "Owner asked for voice input support.",
  });

  const scheduler = new SelfImprovementScheduler(
    configFixture(),
    agentFixture(),
    taskQueueFixture(),
    new SkillEvaluator(join(dir, "metrics.json")),
    learningLogger,
    async () => {},
  );

  await expect(scheduler.buildNextTaskText()).resolves.toContain("повторяющийся failure pattern");
});

test("scheduler chooses recent feature request when no stronger signal exists", async () => {
  const learningLogger = new LearningLogger(join(dir, "learnings"));
  await learningLogger.logFeatureRequest({
    summary: "add voice transcription",
    details: "Owner asked for voice input support.",
  });

  const scheduler = new SelfImprovementScheduler(
    configFixture(),
    agentFixture(),
    taskQueueFixture(),
    new SkillEvaluator(join(dir, "metrics.json")),
    learningLogger,
    async () => {},
  );

  await expect(scheduler.buildNextTaskText()).resolves.toContain("add voice transcription");
});

function configFixture(): AppConfig {
  return {
    TELEGRAM_BOT_TOKEN: "token",
    TELEGRAM_OWNER_ID: "1",
    OPENAI_API_KEY: undefined,
    OPENAI_DEFAULT_MODEL: "gpt-4o-mini",
    GROQ_API_KEY: undefined,
    GROQ_DEFAULT_MODEL: "llama-3.1-8b-instant",
    GITHUB_TOKEN: undefined,
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
    MEMORY_FILE: "data/memory/AGENT_MEMORY.md",
    TASKS_FILE: "data/tasks/tasks.json",
    BUDGET_FILE: "data/budget/usage.json",
    SKILL_METRICS_FILE: "data/skills/metrics.json",
    LEARNINGS_DIR: "data/learnings",
    MODEL_COOLDOWNS_FILE: "data/models/cooldowns.json",
    RUNTIME_STATE_FILE: "data/runtime/state.json",
    REPORT_INTERVAL_MINUTES: 30,
    SELF_IMPROVEMENT_ENABLED: false,
    SELF_IMPROVEMENT_INTERVAL_MINUTES: 60,
    SELF_IMPROVEMENT_TASK: "fallback task",
  };
}

function agentFixture(): AgentRuntime {
  return {
    async isPaused() {
      return false;
    },
    async enqueue(text: string) {
      return {
        id: "task-id",
        text,
        status: "queued",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    },
    kick() {},
  } as AgentRuntime;
}

function taskQueueFixture(): TaskQueue {
  return {
    async hasPendingWork() {
      return false;
    },
  } as TaskQueue;
}
