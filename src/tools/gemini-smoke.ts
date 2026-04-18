import "dotenv/config";
import { GoogleGenerativeAI } from "@google/generative-ai";

const key = process.env.GEMINI_API_KEY;

if (!key) {
  throw new Error("GEMINI_API_KEY is missing.");
}

const models = [
  process.env.GEMINI_DEFAULT_MODEL,
  ...(process.env.GEMINI_FALLBACK_MODELS ?? "").split(","),
]
  .map((model) => model?.trim())
  .filter((model): model is string => Boolean(model));

const client = new GoogleGenerativeAI(key);

for (const modelName of [...new Set(models)]) {
  try {
    const model = client.getGenerativeModel({ model: modelName });
    const started = Date.now();
    const result = await model.generateContent("Reply with exactly: ok");
    console.log(
      JSON.stringify({
        model: modelName,
        ok: true,
        ms: Date.now() - started,
        text: result.response.text().trim().slice(0, 80),
      }),
    );
  } catch (error) {
    const message = (error as Error).message;
    console.log(
      JSON.stringify({
        model: modelName,
        ok: false,
        error: compact(message),
      }),
    );
  }
}

function compact(message: string): string {
  if (message.includes("429")) return "429 quota/rate limit";
  if (message.includes("503")) return "503 overloaded";
  if (message.includes("404")) return "404 unavailable";
  return message.slice(0, 180);
}
