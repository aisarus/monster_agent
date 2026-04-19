import { expect, test } from "vitest";
import { BraveResearchTool } from "../src/tools/research.js";

test("webSearch requires BRAVE_API_KEY", async () => {
  const tool = new BraveResearchTool(undefined);

  const result = await tool.webSearch("typescript docs");

  expect(result.ok).toBe(false);
  expect(result.output).toContain("BRAVE_API_KEY");
});

test("webSearch returns compact Brave results", async () => {
  const fetchImpl = async () =>
    new Response(
      JSON.stringify({
        web: {
          results: [
            {
              title: "TypeScript Documentation",
              url: "https://www.typescriptlang.org/docs/",
              description: "Official TypeScript documentation.",
            },
          ],
        },
      }),
      { status: 200, statusText: "OK", headers: { "Content-Type": "application/json" } },
    );
  const tool = new BraveResearchTool("test-key", fetchImpl as typeof fetch);

  const result = await tool.webSearch("typescript docs", 3);

  expect(result.ok).toBe(true);
  expect(result.output).toContain("TypeScript Documentation");
  expect(result.output).toContain("https://www.typescriptlang.org/docs/");
  expect(result.output).not.toContain("test-key");
});
