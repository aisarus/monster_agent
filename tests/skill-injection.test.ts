import { expect, test } from "vitest";
import { buildTaskUserPrompt } from "../src/agent.js";
import { SkillLoader } from "../src/skills/SkillLoader.js";
import { SkillWriter } from "../src/skills/SkillWriter.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { WorkspaceTools } from "../src/tools/workspace.js";

test("assembles available skills into the task prompt", async () => {
  const loader = new SkillLoader("data/workspace/skills");
  const gitWorkflow = await loader.getSkill("git-workflow");
  expect(gitWorkflow).toBeTruthy();

  const prompt = buildTaskUserPrompt({
    bootstrapText: "bootstrap",
    skillsPrompt: [
      "## Available Skills",
      "",
      loader.formatForPrompt([gitWorkflow!]),
      "",
      "When you need to perform a task matching a skill description,",
      "read the full SKILL.md before starting. Skills contain the exact workflow.",
    ].join("\n"),
    memory: "memory",
    memoryContextChars: 100,
    roleBrief: "- builder: does work",
    taskText: "сделай git commit",
  });

  expect(prompt).toContain("## Available Skills");
  expect(prompt).toContain("<skills>");
  expect(prompt).toContain("<n>git-workflow</n>");
  expect(prompt).toContain("read the full SKILL.md before starting");
});

test("read_skill returns full skill content", async () => {
  const registry = new ToolRegistry(
    new WorkspaceTools("."),
    new SkillLoader("data/workspace/skills"),
    new SkillWriter("data/workspace/skills"),
  );

  const result = await registry.run({ tool: "read_skill", args: { name: "git-workflow" } });

  expect(result.ok).toBe(true);
  expect(result.output).toContain("# Git Workflow");
  expect(result.output).toContain("## Workflow");
});
