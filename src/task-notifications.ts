import type { AgentTask } from "./tasks.js";

export function formatTaskStarted(task: AgentTask): string {
  return [
    `Начал задачу ${shortId(task)}.`,
    "",
    "Задача:",
    compactTaskText(task.text),
  ].join("\n");
}

export function formatTaskCompleted(task: AgentTask): string {
  return [
    `Завершил задачу ${shortId(task)}.`,
    "",
    "Задача:",
    compactTaskText(task.text),
    "",
    "Что сделал:",
    compactSummary(task.result ?? "Задача завершена без подробного результата."),
  ].join("\n");
}

export function formatTaskFailed(task: AgentTask): string {
  return [
    `Задача ${shortId(task)} завершилась с ошибкой.`,
    "",
    "Задача:",
    compactTaskText(task.text),
    "",
    "Причина:",
    compactSummary(task.error ?? "Unknown error."),
  ].join("\n");
}

function shortId(task: AgentTask): string {
  return task.id.slice(0, 8);
}

function compactTaskText(text: string): string {
  return compactSummary(stripInternalPrefix(text), 500);
}

function stripInternalPrefix(text: string): string {
  return text
    .split("\n")
    .filter((line) => !/^\[(?:autopilot|terminal):[^\]]+\]$/.test(line.trim()))
    .join("\n")
    .trim();
}

function compactSummary(text: string, maxLength = 900): string {
  const compact = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .trim();

  if (!compact) {
    return "без подробностей";
  }

  return compact.length > maxLength ? `${compact.slice(0, maxLength)}...` : compact;
}
