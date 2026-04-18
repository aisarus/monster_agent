import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { BudgetTracker } from "../src/budget.js";
import { ActivityReporter } from "../src/reporter.js";
import { RuntimeState } from "../src/runtime-state.js";
import { TaskQueue } from "../src/tasks.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "monster-agent-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("sends a plain activity report", async () => {
  const messages: string[] = [];
  const tasks = new TaskQueue(join(dir, "tasks.json"));
  const runtimeState = new RuntimeState(join(dir, "runtime", "state.json"));
  const budget = new BudgetTracker(join(dir, "budget", "usage.json"), 1, 10);
  const reporter = new ActivityReporter(30, runtimeState, tasks, budget, async (message) => {
    messages.push(message);
  });

  const task = await tasks.enqueue("improve self");
  await tasks.mark(task.id, "completed", { result: "added report loop" });

  await reporter.sendReport();

  expect(messages).toHaveLength(1);
  expect(messages[0]).toContain("Отчёт за последние 30 минут.");
  expect(messages[0]).toContain("завершил: 1");
  expect(messages[0]).toContain("added report loop");
});
