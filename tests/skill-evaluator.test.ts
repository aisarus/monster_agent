import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { SkillEvaluator } from "../src/skills/SkillEvaluator.js";
import type { Skill } from "../src/skills/SkillLoader.js";
import { SkillLoader } from "../src/skills/SkillLoader.js";
import { SkillWriter } from "../src/skills/SkillWriter.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { WorkspaceTools } from "../src/tools/workspace.js";

let dir: string;
let evaluator: SkillEvaluator;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "monster-agent-skill-metrics-"));
  evaluator = new SkillEvaluator(join(dir, "skills", "metrics.json"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("records skill invocation metadata", async () => {
  await evaluator.recordInvocation(skillFixture("git-workflow", "1.0.0"));

  const metrics = await evaluator.readMetrics();
  expect(metrics.skills["git-workflow"].invocations).toBe(1);
  expect(metrics.skills["git-workflow"].last_used).toBeDefined();
  expect(metrics.skills["git-workflow"].current_version).toBe("1.0.0");
});

test("records task results and recalculates success rate", async () => {
  await evaluator.recordTaskResult({
    taskId: "task-1",
    skillNames: ["git-workflow"],
    success: true,
  });
  await evaluator.recordTaskResult({
    taskId: "task-2",
    skillNames: ["git-workflow"],
    success: false,
    failureReason: "typecheck failed\nwith long output",
  });

  const metrics = await evaluator.readMetrics();
  expect(metrics.skills["git-workflow"].successes).toBe(1);
  expect(metrics.skills["git-workflow"].failures).toBe(1);
  expect(metrics.skills["git-workflow"].task_success_rate).toBe(0.5);
  expect(metrics.skills["git-workflow"].failure_reasons[0]).toContain("typecheck failed");
});

test("records version history when skill version changes", async () => {
  await evaluator.recordInvocation(skillFixture("git-workflow", "1.0.0"));
  await evaluator.recordTaskResult({
    taskId: "task-1",
    skillNames: ["git-workflow"],
    success: true,
  });

  await evaluator.recordInvocation(skillFixture("git-workflow", "1.1.0"));

  const metrics = await evaluator.readMetrics();
  expect(metrics.skills["git-workflow"].current_version).toBe("1.1.0");
  expect(metrics.skills["git-workflow"].version_history).toHaveLength(1);
  expect(metrics.skills["git-workflow"].version_history[0].version).toBe("1.0.0");
  expect(metrics.skills["git-workflow"].version_history[0].success_rate).toBe(1);
});

test("returns underperforming skills after enough samples", async () => {
  await evaluator.recordTaskResult({
    taskId: "task-1",
    skillNames: ["git-workflow"],
    success: true,
  });
  await evaluator.recordTaskResult({
    taskId: "task-2",
    skillNames: ["git-workflow"],
    success: false,
  });

  const underperforming = await evaluator.getUnderperformingSkills(0.7);

  expect(underperforming.map((item) => item.name)).toEqual(["git-workflow"]);
});

test("read_skill records invocation through registry", async () => {
  const skillsRoot = join(dir, "workspace", "skills");
  const loader = new SkillLoader(skillsRoot);
  const writer = new SkillWriter(skillsRoot, loader);
  await writer.createSkill({
    name: "registry-read",
    description: "Делает read_skill test когда registry читает skill.",
    trigger: "Registry читает skill.",
    steps: ["Прочитай skill."],
    security: "L1",
  });
  const registry = new ToolRegistry(new WorkspaceTools("."), loader, writer, evaluator);

  const result = await registry.run({ tool: "read_skill", args: { name: "registry-read" } });

  expect(result.ok).toBe(true);
  const metrics = await evaluator.readMetrics();
  expect(metrics.skills["registry-read"].invocations).toBe(1);
});

function skillFixture(name: string, version: string): Skill {
  return {
    name,
    description: "Делает тест когда нужна метрика.",
    version,
    content: "# Test Skill",
    metadata: { requires: { env: [], bins: [] }, security: "L1" },
    path: `data/workspace/skills/${name}/SKILL.md`,
    eligible: true,
    missingRequirements: [],
  };
}
