import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { RuntimeState } from "../src/runtime-state.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "monster-agent-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("defaults to running and can pause and resume", async () => {
  const state = new RuntimeState(join(dir, "runtime", "state.json"));

  expect(await state.isPaused()).toBe(false);
  expect(await state.status()).toContain("Runtime: running");

  await state.pause("maintenance");
  expect(await state.isPaused()).toBe(true);
  expect(await state.status()).toContain("Reason: maintenance");

  await state.resume();
  expect(await state.isPaused()).toBe(false);
});
