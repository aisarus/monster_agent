import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_OWNER_ID: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_DEFAULT_MODEL: z.string().default("gpt-4o-mini"),
  GROQ_API_KEY: z.string().optional(),
  GROQ_DEFAULT_MODEL: z.string().default("llama-3.1-8b-instant"),
  GITHUB_TOKEN: z.string().optional(),
  BRAVE_API_KEY: z.string().optional(),
  OLLAMA_ENABLED: z.coerce.boolean().default(false),
  OLLAMA_BASE_URL: z.string().default("http://127.0.0.1:11434"),
  OLLAMA_MODEL: z.string().default("qwen2.5-coder:1.5b"),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_DEFAULT_MODEL: z.string().default("gemini-1.5-flash"),
  GEMINI_FALLBACK_MODELS: z.string().default(""),
  DEFAULT_PROVIDER: z.enum(["openai", "gemini", "local"]).default("gemini"),
  MONTHLY_BUDGET_USD: z.coerce.number().nonnegative().default(10),
  DAILY_BUDGET_USD: z.coerce.number().nonnegative().default(1),
  HEARTBEAT_MINUTES: z.coerce.number().int().positive().default(15),
  MAX_PARALLEL_SUBAGENTS: z.coerce.number().int().positive().max(2).default(2),
  WORKSPACE_ROOT: z.string().default("."),
  BOOTSTRAP_DIR: z.string().default("data/workspace"),
  MAX_AGENT_STEPS: z.coerce.number().int().positive().max(20).default(12),
  AGENT_MEMORY_CONTEXT_CHARS: z.coerce.number().int().positive().default(2000),
  AGENT_TOOL_OUTPUT_CHARS: z.coerce.number().int().positive().default(2000),
  BOOTSTRAP_MAX_TOTAL_CHARS: z.coerce.number().int().positive().default(6000),
  BOOTSTRAP_MAX_FILE_CHARS: z.coerce.number().int().positive().default(1600),
  MEMORY_FILE: z.string().default("data/memory/AGENT_MEMORY.md"),
  TASKS_FILE: z.string().default("data/tasks/tasks.json"),
  BUDGET_FILE: z.string().default("data/budget/usage.json"),
  SKILL_METRICS_FILE: z.string().default("data/skills/metrics.json"),
  LEARNINGS_DIR: z.string().default("data/learnings"),
  MODEL_COOLDOWNS_FILE: z.string().default("data/models/cooldowns.json"),
  RUNTIME_STATE_FILE: z.string().default("data/runtime/state.json"),
  DASHBOARD_ENABLED: z.coerce.boolean().default(true),
  DASHBOARD_HOST: z.string().default("127.0.0.1"),
  DASHBOARD_PORT: z.coerce.number().int().positive().default(8787),
  DASHBOARD_TOKEN: z.string().optional(),
  REPORT_INTERVAL_MINUTES: z.coerce.number().int().positive().default(30),
  SELF_IMPROVEMENT_ENABLED: z.coerce.boolean().default(false),
  SELF_IMPROVEMENT_INTERVAL_MINUTES: z.coerce.number().int().positive().default(60),
  SELF_IMPROVEMENT_TASK: z
    .string()
    .default(
      "Inspect the Monster Agent project and make one small safe self-improvement. Prefer docs, prompts, tests, or reliability fixes. Do not edit .env. Run checks before final.",
    ),
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(): AppConfig {
  return envSchema.parse(process.env);
}

export function requireTelegramConfig(config: AppConfig): void {
  if (!config.TELEGRAM_BOT_TOKEN) {
    throw new Error("TELEGRAM_BOT_TOKEN is required. Add it to .env.");
  }
  if (!config.TELEGRAM_OWNER_ID) {
    throw new Error("TELEGRAM_OWNER_ID is required. Add it to .env.");
  }
}
