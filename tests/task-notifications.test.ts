import { expect, test } from "vitest";
import {
  formatTaskCompleted,
  formatTaskFailed,
  formatTaskStarted,
} from "../src/task-notifications.js";
import type { AgentTask } from "../src/tasks.js";

test("formats task start with task text", () => {
  const message = formatTaskStarted(taskFixture({ text: "Проверь PM2 logs" }));

  expect(message).toContain("Начал задачу 12345678.");
  expect(message).toContain("Задача:");
  expect(message).toContain("Проверь PM2 logs");
});

test("formats task completion with what was done", () => {
  const message = formatTaskCompleted(
    taskFixture({
      text: "[autopilot:self-improvement]\nДобавь тесты",
      result: "Добавил tests/reporter.test.ts и прогнал npm test.",
    }),
  );

  expect(message).toContain("Завершил задачу 12345678.");
  expect(message).toContain("Добавь тесты");
  expect(message).toContain("Что сделал:");
  expect(message).toContain("Добавил tests/reporter.test.ts");
  expect(message).not.toContain("[autopilot:self-improvement]");
});

test("formats task failure with compact reason", () => {
  const message = formatTaskFailed(
    taskFixture({
      text: "Сделай build",
      error: "TypeScript failed\nsrc/index.ts: bad import",
    }),
  );

  expect(message).toContain("завершилась с ошибкой");
  expect(message).toContain("Сделай build");
  expect(message).toContain("src/index.ts: bad import");
});

function taskFixture(patch: Partial<AgentTask> = {}): AgentTask {
  return {
    id: "1234567890abcdef",
    text: "test task",
    status: "running",
    createdAt: "2026-04-19T00:00:00.000Z",
    updatedAt: "2026-04-19T00:00:00.000Z",
    ...patch,
  };
}
