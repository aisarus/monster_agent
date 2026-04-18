import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { LearningLogger } from "../src/skills/LearningLogger.js";

let dir: string;
let logger: LearningLogger;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "monster-agent-learnings-"));
  logger = new LearningLogger(dir);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("ensureInitialized seeds learning logs without overwriting existing files", async () => {
  const existing = "# Errors\n\nExisting entry.\n";
  await writeFile(join(dir, "ERRORS.md"), existing, "utf8");

  await logger.ensureInitialized();

  await expect(readFile(join(dir, "LEARNINGS.md"), "utf8")).resolves.toContain("# Learnings");
  await expect(readFile(join(dir, "FEATURE_REQUESTS.md"), "utf8")).resolves.toContain(
    "# Feature Requests",
  );
  await expect(readFile(join(dir, "ERRORS.md"), "utf8")).resolves.toBe(existing);
});

test("logs compact errors and reads recent entries", async () => {
  await logger.logError({
    taskId: "1234567890abcdef",
    summary: "Failed to parse src/agent.ts",
    failureReason: "secret=abcdef1234567890abcdef1234567890 should be redacted",
    relatedFiles: ["src/agent.ts"],
  });

  const raw = await readFile(join(dir, "ERRORS.md"), "utf8");
  expect(raw).toContain("Failed to parse src/agent.ts");
  expect(raw).toContain("secret=[redacted]");
  expect(raw).toContain("src/agent.ts");

  const entries = await logger.readRecentEntries("errors");
  expect(entries).toHaveLength(1);
  expect(entries[0].summary).toContain("Failed to parse");
});

test("logs learnings and feature requests", async () => {
  await logger.logLearning({
    taskId: "task-1",
    summary: "Use SkillEvaluator before generic self-improvement.",
  });
  await logger.logFeatureRequest({
    summary: "Add voice transcription.",
    details: "Owner sends voice notes.",
  });

  await expect(readFile(join(dir, "LEARNINGS.md"), "utf8")).resolves.toContain(
    "Use SkillEvaluator",
  );
  await expect(readFile(join(dir, "FEATURE_REQUESTS.md"), "utf8")).resolves.toContain(
    "Add voice transcription",
  );
});
