import "dotenv/config";

const key = process.env.GEMINI_API_KEY;

if (!key) {
  throw new Error("GEMINI_API_KEY is missing.");
}

type GeminiModel = {
  name: string;
  displayName?: string;
  supportedGenerationMethods?: string[];
};

const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
const payload = (await response.json()) as {
  models?: GeminiModel[];
  error?: { message?: string };
};

if (!response.ok) {
  throw new Error(payload.error?.message ?? `Gemini listModels failed: ${response.status}`);
}

const models = (payload.models ?? [])
  .filter((model) => model.supportedGenerationMethods?.includes("generateContent"))
  .map((model) => ({
    name: model.name.replace("models/", ""),
    displayName: model.displayName,
  }));

console.log(JSON.stringify(models, null, 2));
