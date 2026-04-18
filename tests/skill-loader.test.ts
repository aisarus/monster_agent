import { expect, test } from "vitest";
import { SkillLoader } from "../src/skills/SkillLoader.js";

test("loads starter skills and marks their requirements as eligible", async () => {
  const previousTelegramToken = process.env.TELEGRAM_BOT_TOKEN;
  const previousTelegramOwner = process.env.TELEGRAM_OWNER_ID;
  process.env.TELEGRAM_BOT_TOKEN = "test-token";
  process.env.TELEGRAM_OWNER_ID = "123";

  try {
    const loader = new SkillLoader("data/workspace/skills");
    const skills = await loader.loadAll();
    const starterSkills = ["code-review", "git-workflow", "self-improvement", "telegram-report"];

    for (const name of starterSkills) {
      const skill = skills.find((item) => item.name === name);
      expect(skill, `missing ${name}`).toBeDefined();
      expect(skill?.eligible).toBe(true);
      expect(skill?.missingRequirements).toEqual([]);
    }
  } finally {
    restoreEnv("TELEGRAM_BOT_TOKEN", previousTelegramToken);
    restoreEnv("TELEGRAM_OWNER_ID", previousTelegramOwner);
  }
});

test("formats skills as compact prompt XML", async () => {
  const loader = new SkillLoader("data/workspace/skills");
  const xml = loader.formatForPrompt([
    {
      name: "git-workflow",
      description: "Делает git когда нужно сохранить работу.",
      version: "1.0.0",
      content: "# Git Workflow",
      metadata: { requires: { env: [], bins: [] }, security: "L2" },
      path: "data/workspace/skills/git-workflow/SKILL.md",
      eligible: true,
      missingRequirements: [],
    },
  ]);

  expect(xml).toContain("<skills>");
  expect(xml).toContain("<n>git-workflow</n>");
  expect(xml).toContain("<location>data/workspace/skills/git-workflow/SKILL.md</location>");
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}
