import { BudgetTracker } from "./budget.js";
import { MemoryStore } from "./memory.js";
import { selectRoles, roleDescriptions } from "./subagents.js";
import { TaskQueue, type AgentTask } from "./tasks.js";
import { LlmRouter } from "./llm/router.js";
import type { ChatMessage } from "./llm/types.js";
import { parseAgentAction, type AgentAction } from "./agent-action.js";
import { ToolRegistry } from "./tools/registry.js";
import { BootstrapLoader } from "./bootstrap.js";
import { RuntimeState } from "./runtime-state.js";
import { SkillLoader } from "./skills/SkillLoader.js";

export type AgentEvents = {
  onTaskStarted?: (task: AgentTask) => Promise<void>;
  onTaskCompleted?: (task: AgentTask) => Promise<void>;
  onTaskFailed?: (task: AgentTask) => Promise<void>;
};

export class AgentRuntime {
  private running = false;

  constructor(
    private readonly tasks: TaskQueue,
    private readonly memory: MemoryStore,
    private readonly llm: LlmRouter,
    private readonly budget: BudgetTracker,
    private readonly tools: ToolRegistry,
    private readonly bootstrap: BootstrapLoader,
    private readonly skillLoader: SkillLoader,
    private readonly runtimeState: RuntimeState,
    private readonly maxSteps: number,
    private readonly memoryContextChars: number,
    private readonly toolOutputChars: number,
    private readonly events: AgentEvents = {},
  ) {}

  async enqueue(text: string): Promise<AgentTask> {
    return this.tasks.enqueue(text);
  }

  kick(): void {
    void this.drain();
  }

  async drain(): Promise<void> {
    await this.processQueue();
  }

  async status(): Promise<string> {
    return [await this.runtimeState.status(), await this.tasks.status(), await this.budget.status()].join(
      "\n\n",
    );
  }

  async stop(): Promise<string> {
    const stopped = await this.tasks.stopActive();
    return stopped ? `Stopped task ${stopped.id}` : "No active task.";
  }

  async pause(reason?: string): Promise<string> {
    return this.runtimeState.pause(reason);
  }

  async resume(): Promise<string> {
    const message = await this.runtimeState.resume();
    this.kick();
    return message;
  }

  async runtimeStatus(): Promise<string> {
    return this.runtimeState.status();
  }

  isPaused(): Promise<boolean> {
    return this.runtimeState.isPaused();
  }

  private async processQueue(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;
    try {
      if (await this.runtimeState.isPaused()) {
        return;
      }

      let task = await this.tasks.next();
      while (task) {
        await this.runTask(task);
        if (await this.runtimeState.isPaused()) {
          return;
        }
        task = await this.tasks.next();
      }
    } finally {
      this.running = false;
    }
  }

  private async runTask(task: AgentTask): Promise<void> {
    const runningTask = await this.tasks.mark(task.id, "running");
    await this.events.onTaskStarted?.(runningTask);

    try {
      const memory = await this.memory.read();
      const bootstrap = await this.bootstrap.load(task.text);
      const skills = await this.skillLoader.loadEligible();
      const roles = selectRoles(task.text);
      const roleBrief = roles.map((role) => `- ${role}: ${roleDescriptions[role]}`).join("\n");
      const messages: ChatMessage[] = [
        {
          role: "system",
          content: buildSystemPrompt(),
        },
        {
          role: "user",
          content: buildTaskUserPrompt({
            bootstrapText: bootstrap.text,
            roleBrief,
            memory,
            memoryContextChars: this.memoryContextChars,
            skillsPrompt: buildAvailableSkillsPrompt(this.skillLoader.formatForPrompt(skills)),
            taskText: task.text,
          }),
        },
      ];

      const result = await this.runAgentLoop(task.id, messages);

      const completedTask = await this.tasks.mark(task.id, "completed", {
        result: compactAssistantReply(result),
      });
      await this.events.onTaskCompleted?.(completedTask);
    } catch (error) {
      const failedTask = await this.tasks.mark(task.id, "failed", {
        error: compactTaskError(error),
      });
      await this.events.onTaskFailed?.(failedTask);
    }
  }

  private async runAgentLoop(taskId: string, messages: ChatMessage[]): Promise<string> {
    let parseFailures = 0;
    const toolTrace: string[] = [];
    const repeatedCalls = new Map<string, number>();

    for (let step = 1; step <= this.maxSteps; step += 1) {
      const response = await this.llm.complete({ taskId, messages });
      const action: AgentAction | undefined = (() => {
        try {
          return parseAgentAction(response.content);
        } catch (error) {
          parseFailures += 1;
          if (parseFailures > 2) {
            return {
              type: "final",
              message: [
                "Остановлено: модель 3 раза нарушила JSON-протокол tool loop.",
                `Последняя ошибка: ${(error as Error).message}`,
                "Следующий шаг: упростить задачу или улучшить tool protocol/schema.",
              ].join("\n"),
            };
          }
          messages.push({
            role: "assistant",
            content: response.content.slice(0, 1000),
          });
          messages.push({
            role: "user",
            content: [
              "Protocol error: your previous response was not valid JSON.",
              "Reply with exactly one JSON object and no Markdown.",
              "Valid examples:",
              '{"type":"tool","call":{"tool":"run_command","args":{"command":"npm install"}}}',
              '{"type":"final","message":"short answer"}',
            ].join("\n"),
          });
          return undefined;
        }
      })();

      if (!action) {
        continue;
      }

      if (action.type === "final") {
        return action.message;
      }

      const callKey = JSON.stringify(action.call);
      const callCount = (repeatedCalls.get(callKey) ?? 0) + 1;
      repeatedCalls.set(callKey, callCount);
      if (callCount >= 3) {
        return [
          "Остановлено: агент повторил один и тот же tool call 3 раза.",
          `Повтор: ${action.call.tool}`,
          "Следующий шаг: уточнить задачу или улучшить стратегию выбора инструментов.",
        ].join("\n");
      }

      const toolResult = await this.tools.run(action.call);
      toolTrace.push(formatToolTrace(step, action.call.tool, toolResult.ok, toolResult.output));
      messages.push({
        role: "assistant",
        content: JSON.stringify(action),
      });
      messages.push({
        role: "user",
        content: [
          `Tool result for step ${step}:`,
          JSON.stringify(
            {
              ok: toolResult.ok,
              output: toolResult.output.slice(0, this.toolOutputChars),
            },
            null,
            2,
          ),
        ].join("\n"),
      });

      if (step === this.maxSteps) {
        return [
          `Достигнут лимит шагов (${this.maxSteps}), но задача не потеряна.`,
          "Что успел сделать:",
          ...toolTrace.slice(-5),
          "Следующий шаг: продолжить с более узкой задачей или увеличить лимит шагов.",
        ].join("\n");
      }
    }

    return [
      `Достигнут лимит шагов (${this.maxSteps}), финальный ответ не получен.`,
      ...toolTrace.slice(-5),
    ].join("\n");
  }
}

function formatToolTrace(step: number, tool: string, ok: boolean, output: string): string {
  const compactOutput = output.replace(/\s+/g, " ").trim().slice(0, 220);
  return `${step}. ${tool}: ${ok ? "ok" : "fail"}${compactOutput ? ` - ${compactOutput}` : ""}`;
}

function buildSystemPrompt(): string {
  return [
    "You are a real autonomous coding/server agent controlled from Telegram.",
    "Reply in Russian unless the user asks otherwise.",
    "Be concise and token-efficient.",
    "You MUST respond with a single valid JSON object and nothing else.",
    "Every response must be valid JSON.",
    "Never answer with Markdown, fenced code blocks, prose before JSON, or raw shell commands.",
    "If you want to run a command, use the run_command JSON tool.",
    "Action schema:",
    '{"type":"tool","call":{"tool":"list_files","args":{"path":"."}}}',
    '{"type":"tool","call":{"tool":"read_file","args":{"path":"README.md"}}}',
    '{"type":"tool","call":{"tool":"read_skill","args":{"name":"git-workflow"}}}',
    '{"type":"tool","call":{"tool":"list_skills","args":{}}}',
    '{"type":"tool","call":{"tool":"create_skill","args":{"name":"repeatable-workflow","description":"Делает X когда Y","trigger":"Когда Y","steps":["Шаг 1","Шаг 2"],"security":"L1","requires":{"env":[],"bins":[]}}}}',
    '{"type":"tool","call":{"tool":"update_skill","args":{"name":"repeatable-workflow","steps":["Обновлённый шаг 1","Обновлённый шаг 2"]}}}',
    '{"type":"tool","call":{"tool":"write_file","args":{"path":"notes.txt","content":"text"}}}',
    '{"type":"tool","call":{"tool":"run_command","args":{"command":"npm test"}}}',
    '{"type":"tool","call":{"tool":"git_status","args":{}}}',
    '{"type":"tool","call":{"tool":"git_branch","args":{"name":"agent/task-name"}}}',
    '{"type":"tool","call":{"tool":"git_commit","args":{"message":"Describe the safe change"}}}',
    '{"type":"tool","call":{"tool":"git_push","args":{}}}',
    '{"type":"tool","call":{"tool":"github_pr","args":{"title":"Short PR title","body":"What changed and checks run","base":"main"}}}',
    '{"type":"final","message":"short final answer for owner"}',
    "Available tools: list_files, read_file, read_skill, list_skills, create_skill, update_skill, write_file, run_command, git_status, git_branch, git_commit, git_push, github_pr.",
    "Use tools for real work. Do not pretend to inspect or change files without tools.",
    "When a task matches an available skill description, call read_skill before starting the workflow.",
    "When you complete a task and realize you figured out the same steps from scratch that you have done before, call create_skill to capture that reusable workflow.",
    "When you fail a task because there was no clear reusable workflow, and the workflow becomes clear after solving it, call create_skill or update_skill so the next attempt has a skill.",
    "For casual chat, use final immediately.",
    "For code tasks, inspect files first, edit, run checks, then final.",
    "Before non-trivial code changes, create a task branch with git_branch when the workspace is clean.",
    "When the owner asks to save work, use git_commit after checks and git_push when GitHub publication is needed.",
    "When working on a task branch and publication is ready, use github_pr to open a PR into main.",
    "If the user asks to inspect, read, check, look at, or analyze files/project/bootstrap, call tools first.",
    "Final answer for real work must include concrete next action, not generic strategy.",
    "When recommending the next engineering step, name the exact file/module to change.",
    "System-level commands are blocked by policy and require owner confirmation.",
    "Do not write secrets to files. Do not spend money. Do not message external people.",
  ].join("\n");
}

export function buildTaskUserPrompt(args: {
  bootstrapText: string;
  skillsPrompt: string;
  memory: string;
  memoryContextChars: number;
  roleBrief: string;
  taskText: string;
}): string {
  return [
    "Bootstrap context:",
    args.bootstrapText,
    "",
    args.skillsPrompt,
    "",
    "Long-term memory:",
    args.memory.slice(0, args.memoryContextChars),
    "",
    "Selected internal roles:",
    args.roleBrief,
    "",
    "Task:",
    args.taskText,
    "",
    taskRequiresInspection(args.taskText)
      ? "Instruction: this task explicitly asks to inspect/read/check files. You must call list_files or read_file before final."
      : "",
  ].join("\n");
}

function buildAvailableSkillsPrompt(skillsXml: string): string {
  return [
    "## Available Skills",
    "",
    skillsXml,
    "",
    "When you need to perform a task matching a skill description,",
    "read the full SKILL.md before starting. Skills contain the exact workflow.",
  ].join("\n");
}

function taskRequiresInspection(text: string): boolean {
  return /(посмотри|прочитай|проверь|проанализ|inspect|read|check|look|файл|bootstrap|проект)/i.test(
    text,
  );
}

function compactTaskError(error: unknown): string {
  const message = (error as Error).message ?? String(error);
  return message.length > 900 ? `${message.slice(0, 900)}...` : message;
}

function compactAssistantReply(content: string): string {
  const lines = content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^(\*\*)?(план|необходимые роли|необходимые субагенты|roles?)[:*]/i.test(line))
    .slice(0, 10);

  const compact = lines.join("\n");
  return compact.length > 1400 ? `${compact.slice(0, 1400)}...` : compact;
}
