import "dotenv/config";
import { AgentRuntime } from "../agent.js";
import { BootstrapLoader } from "../bootstrap.js";
import { BudgetTracker } from "../budget.js";
import { loadConfig } from "../config.js";
import { ModelCooldowns } from "../llm/failover.js";
import { LlmRouter } from "../llm/router.js";
import { MemoryStore } from "../memory.js";
import { TaskQueue } from "../tasks.js";
import { ToolRegistry } from "../tools/registry.js";
import { WorkspaceTools } from "../tools/workspace.js";

const taskText = process.argv.slice(2).join(" ").trim();

if (!taskText) {
  throw new Error('Usage: npm run agent:smoke -- "your task"');
}

const config = loadConfig();
const memory = new MemoryStore(config.MEMORY_FILE);
const budget = new BudgetTracker(
  config.BUDGET_FILE,
  config.DAILY_BUDGET_USD,
  config.MONTHLY_BUDGET_USD,
);
const tasks = new TaskQueue(config.TASKS_FILE);
const cooldowns = new ModelCooldowns(config.MODEL_COOLDOWNS_FILE);
const llm = new LlmRouter(config, budget, cooldowns);
const tools = new ToolRegistry(new WorkspaceTools(config.WORKSPACE_ROOT));
const bootstrap = new BootstrapLoader(
  config.BOOTSTRAP_DIR,
  config.BOOTSTRAP_MAX_FILE_CHARS,
  config.BOOTSTRAP_MAX_TOTAL_CHARS,
);

await memory.ensure();

const runtime = new AgentRuntime(
  tasks,
  memory,
  llm,
  budget,
  tools,
  bootstrap,
  config.MAX_AGENT_STEPS,
  config.AGENT_MEMORY_CONTEXT_CHARS,
  config.AGENT_TOOL_OUTPUT_CHARS,
  {
    async onTaskStarted(task) {
      console.log(`started ${task.id.slice(0, 8)}`);
    },
    async onTaskCompleted(task) {
      console.log(`completed ${task.id.slice(0, 8)}`);
      console.log(task.result ?? "No result.");
    },
    async onTaskFailed(task) {
      console.log(`failed ${task.id.slice(0, 8)}`);
      console.log(task.error ?? "Unknown error.");
    },
  },
);

const task = await runtime.enqueue(`[terminal:smoke]\n${taskText}`);
console.log(`queued ${task.id.slice(0, 8)}`);
await runtime.drain();

const completed = await tasks.get(task.id);
if (!completed) {
  process.exitCode = 1;
} else if (completed.status === "failed") {
  process.exitCode = 2;
}
