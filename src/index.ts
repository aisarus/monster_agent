import { AgentRuntime } from "./agent.js";
import { BootstrapLoader } from "./bootstrap.js";
import { BudgetTracker } from "./budget.js";
import { DirectChat } from "./chat.js";
import { loadConfig, requireTelegramConfig } from "./config.js";
import { startDashboardServer } from "./dashboard.js";
import { Doctor } from "./doctor.js";
import { ModelCooldowns } from "./llm/failover.js";
import { LlmRouter } from "./llm/router.js";
import { MemoryStore } from "./memory.js";
import { ActivityReporter } from "./reporter.js";
import { RuntimeState } from "./runtime-state.js";
import { SelfImprovementScheduler } from "./scheduler.js";
import { LearningLogger } from "./skills/LearningLogger.js";
import { SkillEvaluator } from "./skills/SkillEvaluator.js";
import { SkillLoader } from "./skills/SkillLoader.js";
import { SkillWriter } from "./skills/SkillWriter.js";
import { formatTaskCompleted, formatTaskFailed, formatTaskStarted } from "./task-notifications.js";
import { createTelegramBot } from "./telegram.js";
import { TaskQueue } from "./tasks.js";
import { BraveResearchTool } from "./tools/research.js";
import { ToolRegistry } from "./tools/registry.js";
import { WorkspaceTools } from "./tools/workspace.js";

const config = loadConfig();
const memory = new MemoryStore(config.MEMORY_FILE);
const budget = new BudgetTracker(
  config.BUDGET_FILE,
  config.DAILY_BUDGET_USD,
  config.MONTHLY_BUDGET_USD,
);
const tasks = new TaskQueue(config.TASKS_FILE);
const runtimeState = new RuntimeState(config.RUNTIME_STATE_FILE);
const cooldowns = new ModelCooldowns(config.MODEL_COOLDOWNS_FILE);
const llm = new LlmRouter(config, budget, cooldowns);
const directChatLlm = new LlmRouter(
  { ...config, DEFAULT_PROVIDER: config.DIRECT_CHAT_PROVIDER },
  budget,
  cooldowns,
);
const skillLoader = new SkillLoader();
const skillWriter = new SkillWriter("data/workspace/skills", skillLoader);
const skillEvaluator = new SkillEvaluator(config.SKILL_METRICS_FILE);
const learningLogger = new LearningLogger(config.LEARNINGS_DIR);
const tools = new ToolRegistry(
  new WorkspaceTools(config.WORKSPACE_ROOT),
  skillLoader,
  skillWriter,
  skillEvaluator,
  new BraveResearchTool(config.BRAVE_API_KEY),
);
const bootstrap = new BootstrapLoader(
  config.BOOTSTRAP_DIR,
  config.BOOTSTRAP_MAX_FILE_CHARS,
  config.BOOTSTRAP_MAX_TOTAL_CHARS,
);
const doctor = new Doctor(config, cooldowns);
const directChat = new DirectChat(directChatLlm);

await memory.ensure();
await learningLogger.ensureInitialized();
const recoveredTasks = await tasks.recoverRunning();

async function sendOwnerMessage(text: string): Promise<void> {
  if (!config.TELEGRAM_OWNER_ID) {
    return;
  }

  const maxLength = 3500;
  const chunks = text.match(new RegExp(`[\\s\\S]{1,${maxLength}}`, "g")) ?? [text];
  for (const chunk of chunks.slice(0, 3)) {
    await bot.telegram.sendMessage(config.TELEGRAM_OWNER_ID, chunk);
  }
  if (chunks.length > 3) {
    await bot.telegram.sendMessage(config.TELEGRAM_OWNER_ID, "Message truncated.");
  }
}

const agentRuntime = new AgentRuntime(
  tasks,
  memory,
  llm,
  budget,
  tools,
  bootstrap,
  skillLoader,
  skillEvaluator,
  learningLogger,
  runtimeState,
  config.MAX_AGENT_STEPS,
  config.AGENT_MEMORY_CONTEXT_CHARS,
  config.AGENT_TOOL_OUTPUT_CHARS,
  {
    async onTaskStarted(task) {
      await sendOwnerMessage(formatTaskStarted(task));
    },
    async onTaskCompleted(task) {
      await sendOwnerMessage(formatTaskCompleted(task));
    },
    async onTaskFailed(task) {
      await sendOwnerMessage(formatTaskFailed(task));
    },
  },
);

const scheduler = new SelfImprovementScheduler(
  config,
  agentRuntime,
  tasks,
  skillEvaluator,
  learningLogger,
  sendOwnerMessage,
);
const reporter = new ActivityReporter(
  config.REPORT_INTERVAL_MINUTES,
  runtimeState,
  tasks,
  budget,
  sendOwnerMessage,
);

const bot = createTelegramBot(
  config,
  agentRuntime,
  directChat,
  memory,
  doctor,
  reporter,
  skillLoader,
  () => scheduler,
);

requireTelegramConfig(config);

if (config.DASHBOARD_ENABLED) {
  startDashboardServer({
    config,
    agent: agentRuntime,
    scheduler,
    skillLoader,
    skillEvaluator,
  });
}

const heartbeatMs = config.HEARTBEAT_MINUTES * 60 * 1000;
setInterval(async () => {
  if (!config.TELEGRAM_OWNER_ID) {
    return;
  }
  if (await runtimeState.isPaused()) {
    return;
  }
  try {
    await bot.telegram.sendMessage(config.TELEGRAM_OWNER_ID, `Heartbeat\n${await tasks.status()}`);
  } catch (error) {
    console.error("Heartbeat failed:", error);
  }
}, heartbeatMs);

scheduler.start();
reporter.start();
if (recoveredTasks > 0) {
  await sendOwnerMessage(`Recovered ${recoveredTasks} running task(s) after restart.`);
}
agentRuntime.kick();

await bot.launch({ dropPendingUpdates: true });
console.log("Monster Agent started.");

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
