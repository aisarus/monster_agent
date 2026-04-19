import "dotenv/config";

const baseUrl = process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434";
const model = process.env.OLLAMA_MODEL ?? "qwen2.5-coder:1.5b";

const started = Date.now();

try {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "Reply with exactly: ok" }],
      stream: false,
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama smoke failed: ${response.status} ${await response.text()}`);
  }

  const payload = (await response.json()) as { message?: { content?: string } };

  console.log(
    JSON.stringify({
      model,
      ok: true,
      ms: Date.now() - started,
      text: payload.message?.content?.trim().slice(0, 80),
    }),
  );
} catch (error) {
  console.log(
    JSON.stringify({
      model,
      ok: false,
      ms: Date.now() - started,
      error: (error as Error).message,
    }),
  );
  process.exitCode = 1;
}
