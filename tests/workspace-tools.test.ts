import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, expect, test } from "vitest";
import { WorkspaceTools } from "../src/tools/workspace.js";

const execFileAsync = promisify(execFile);

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "monster-agent-tools-"));
  await execFileAsync("git", ["init"], { cwd: dir });
  await execFileAsync("git", ["config", "user.name", "Test Agent"], { cwd: dir });
  await execFileAsync("git", ["config", "user.email", "test@example.local"], { cwd: dir });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("commits safe workspace changes", async () => {
  const tools = new WorkspaceTools(dir);

  await tools.writeFile("notes.txt", "hello");
  const result = await tools.gitCommit("Add notes");

  expect(result.ok).toBe(true);
  expect(result.output).toContain("Add notes");
});

test("blocks commits when changed files look like secrets", async () => {
  const tools = new WorkspaceTools(dir);
  const fakeSecret = `sk-proj-${"a".repeat(32)}`;

  await writeFile(join(dir, "leak.txt"), `OPENAI_API_KEY=${fakeSecret}`);
  const result = await tools.gitCommit("Add leak");

  expect(result.ok).toBe(false);
  expect(result.output).toContain("Commit blocked");
});
