import type { ToolResult } from "./workspace.js";

type FetchLike = typeof fetch;

type BraveSearchPayload = {
  web?: {
    results?: Array<{
      title?: string;
      url?: string;
      description?: string;
      age?: string;
    }>;
  };
};

export class BraveResearchTool {
  constructor(
    private readonly apiKey: string | undefined,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async webSearch(query: string, count = 5): Promise<ToolResult> {
    const trimmed = query.replace(/\s+/g, " ").trim();
    if (!trimmed) {
      return { ok: false, output: "Missing search query." };
    }

    if (!this.apiKey) {
      return { ok: false, output: "BRAVE_API_KEY is missing in environment." };
    }

    const limit = Math.min(Math.max(Math.trunc(count), 1), 5);
    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", trimmed.slice(0, 400));
    url.searchParams.set("count", String(limit));
    url.searchParams.set("safesearch", "moderate");

    const response = await this.fetchImpl(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "monster-agent",
        "X-Subscription-Token": this.apiKey,
      },
    });

    if (!response.ok) {
      return {
        ok: false,
        output: `Brave search failed: ${response.status} ${response.statusText}`,
      };
    }

    const payload = (await response.json()) as BraveSearchPayload;
    const results = (payload.web?.results ?? []).slice(0, limit);
    if (results.length === 0) {
      return { ok: true, output: "No results." };
    }

    return {
      ok: true,
      output: results.map(formatResult).join("\n\n"),
    };
  }
}

function formatResult(
  result: NonNullable<NonNullable<BraveSearchPayload["web"]>["results"]>[number],
  index: number,
): string {
  return [
    `${index + 1}. ${compact(result.title ?? "Untitled", 160)}`,
    `url: ${compact(result.url ?? "unknown", 240)}`,
    result.age ? `age: ${compact(result.age, 80)}` : "",
    result.description ? `summary: ${compact(result.description, 500)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function compact(value: string, maxLength: number): string {
  const compacted = value.replace(/\s+/g, " ").trim();
  return compacted.length > maxLength ? `${compacted.slice(0, maxLength)}...` : compacted;
}
