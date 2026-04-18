import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { SkillEvaluator } from "../src/skills/SkillEvaluator.js";
import { SkillLoader } from "../src/skills/SkillLoader.js";
import { SkillWriter } from "../src/skills/SkillWriter.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { WorkspaceTools } from "../src/tools/workspace.js";

let dir: string;
let skillsRoot: string;
let loader: SkillLoader;
let writer: SkillWriter;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "monster-agent-skills-"));
  skillsRoot = join(dir, "skills");
  loader = new SkillLoader(skillsRoot);
  writer = new SkillWriter(skillsRoot, loader);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("createSkill creates a valid SKILL.md and loader can read it", async () => {
  const result = await writer.createSkill({
    name: "test-skill",
    description: "Делает тестовый skill когда нужен тест.",
    trigger: "Нужен тестовый workflow.",
    steps: ["Проверь входные данные.", "Верни результат."],
    security: "L1",
  });

  expect(result.validated).toBe(true);
  expect(result.errors).toEqual([]);
  expect(await loader.validateSkill(result.path)).toEqual([]);

  const raw = await readFile(result.path, "utf8");
  expect(raw).toContain("name: test-skill");
  expect(raw).toContain("## Когда использовать");
  expect(raw).toContain("## Workflow");

  const skills = await loader.loadAll();
  expect(skills.map((skill) => skill.name)).toContain("test-skill");
});

test("rejects unsafe names and workflow longer than seven steps", async () => {
  await expect(
    writer.createSkill({
      name: "../bad",
      description: "Делает плохой skill когда имя небезопасно.",
      trigger: "Небезопасное имя.",
      steps: ["Не писать файл."],
      security: "L1",
    }),
  ).rejects.toThrow(/safe slug/);

  await expect(
    writer.createSkill({
      name: "too-many-steps",
      description: "Делает длинный workflow когда шагов слишком много.",
      trigger: "Слишком много шагов.",
      steps: ["1", "2", "3", "4", "5", "6", "7", "8"],
      security: "L1",
    }),
  ).rejects.toThrow(/at most 7/);
});

test("updateSkill updates an existing skill and keeps it valid", async () => {
  await writer.createSkill({
    name: "update-me",
    description: "Делает старый workflow когда нужно обновление.",
    trigger: "Старый trigger.",
    steps: ["Старый шаг."],
    security: "L1",
  });

  const result = await writer.updateSkill("update-me", {
    description: "Делает новый workflow когда нужно обновление.",
    trigger: "Новый trigger.",
    steps: ["Новый шаг 1.", "Новый шаг 2."],
    security: "L2",
    requires: { env: [], bins: ["git"] },
  });

  expect(result.validated).toBe(true);
  expect(await loader.validateSkill(result.path)).toEqual([]);

  const skill = await loader.getSkill("update-me");
  expect(skill?.description).toBe("Делает новый workflow когда нужно обновление.");
  expect(skill?.metadata.security).toBe("L2");
  expect(skill?.content).toContain("Новый шаг 2.");
});

test("deleteSkill removes an existing skill", async () => {
  await writer.createSkill({
    name: "delete-me",
    description: "Делает временный skill когда нужен delete test.",
    trigger: "Нужно удалить skill.",
    steps: ["Создай.", "Удали."],
    security: "L1",
  });

  await writer.deleteSkill("delete-me");

  expect(await loader.getSkill("delete-me")).toBeNull();
});

test("registry skill tools list, create, and update skills", async () => {
  const evaluator = new SkillEvaluator(join(dir, "metrics.json"));
  const registry = new ToolRegistry(new WorkspaceTools("."), loader, writer, evaluator);

  const created = await registry.run({
    tool: "create_skill",
    args: {
      name: "registry-skill",
      description: "Делает registry skill когда tool вызывает writer.",
      trigger: "Tool создаёт skill.",
      steps: ["Создай skill."],
      security: "L1",
    },
  });
  expect(created.ok).toBe(true);
  expect(created.output).toContain("validated: yes");

  const listed = await registry.run({ tool: "list_skills", args: {} });
  expect(listed.ok).toBe(true);
  expect(listed.output).toContain("registry-skill v1.0.0");

  const updated = await registry.run({
    tool: "update_skill",
    args: {
      name: "registry-skill",
      steps: ["Обнови skill."],
    },
  });
  expect(updated.ok).toBe(true);

  const skill = await loader.getSkill("registry-skill");
  expect(skill?.content).toContain("Обнови skill.");
});
