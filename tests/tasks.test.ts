import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { TaskQueue } from "../src/tasks.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "monster-agent-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("queues and marks a task", async () => {
  const queue = new TaskQueue(join(dir, "tasks.json"));
  const task = await queue.enqueue("do work");

  expect((await queue.next())?.id).toBe(task.id);

  await queue.mark(task.id, "running");
  await queue.mark(task.id, "completed", { result: "done" });

  expect(await queue.status()).toContain("1 done");
});

test("lists tasks changed after a timestamp", async () => {
  const queue = new TaskQueue(join(dir, "tasks.json"));
  const before = new Date(Date.now() - 1000).toISOString();
  const task = await queue.enqueue("do work");
  await queue.mark(task.id, "completed", { result: "done" });

  const changed = await queue.changedSince(before);

  expect(changed.some((item) => item.id === task.id)).toBe(true);
});
