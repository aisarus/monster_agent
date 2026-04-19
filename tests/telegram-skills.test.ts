import { expect, test } from "vitest";
import { formatDashboardLink, formatSkillContent, formatSkillsList } from "../src/telegram.js";
import type { Skill } from "../src/skills/SkillLoader.js";

const skill: Skill = {
  name: "sample-skill",
  description: "Делает sample когда нужен тест.",
  version: "1.0.0",
  content: "# Sample Skill\n\n## Workflow\n1. Test.",
  metadata: { requires: { env: [], bins: [] }, security: "L1" },
  path: "data/workspace/skills/sample-skill/SKILL.md",
  eligible: true,
  missingRequirements: [],
};

test("formats compact skills list for Telegram", () => {
  const text = formatSkillsList([skill]);

  expect(text).toContain("Skills:");
  expect(text).toContain("sample-skill v1.0.0 | L1 | eligible");
});

test("formats and truncates a single skill for Telegram", () => {
  const text = formatSkillContent({ ...skill, content: "x".repeat(100) }, 80);

  expect(text).toContain("sample-skill v1.0.0");
  expect(text).toContain("[truncated]");
});

test("formats missing skill response", () => {
  expect(formatSkillContent(null)).toBe("Skill not found.");
});

test("formats dashboard link with public url button target", () => {
  const dashboard = formatDashboardLink({
    DASHBOARD_HOST: "127.0.0.1",
    DASHBOARD_PORT: 8787,
    DASHBOARD_PUBLIC_URL: "https://agent.example.com",
  } as Parameters<typeof formatDashboardLink>[0]);

  expect(dashboard.text).toContain("https://agent.example.com");
  expect(dashboard.buttonUrl).toBe("https://agent.example.com");
});

test("formats dashboard link with ssh tunnel hint when public url is missing", () => {
  const dashboard = formatDashboardLink({
    DASHBOARD_HOST: "127.0.0.1",
    DASHBOARD_PORT: 8787,
    DASHBOARD_PUBLIC_URL: undefined,
  } as Parameters<typeof formatDashboardLink>[0]);

  expect(dashboard.text).toContain("http://127.0.0.1:8787");
  expect(dashboard.text).toContain("ssh -L 8787:127.0.0.1:8787");
  expect(dashboard.buttonUrl).toBeUndefined();
});
