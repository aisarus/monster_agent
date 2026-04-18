import "dotenv/config";
import OpenAI from "openai";

const key = process.env.GROQ_API_KEY;
const model = process.env.GROQ_DEFAULT_MODEL ?? "openai/gpt-oss-120b";

if (!key) {
  throw new Error("GROQ_API_KEY is missing.");
}

const client = new OpenAI({
  apiKey: key,
  baseURL: "https://api.groq.com/openai/v1",
});

const started = Date.now();
const response = await client.chat.completions.create({
  model,
  messages: [{ role: "user", content: "Reply with exactly: ok" }],
  temperature: 0.2,
});

console.log(
  JSON.stringify({
    model,
    ok: true,
    ms: Date.now() - started,
    text: response.choices[0]?.message.content?.trim().slice(0, 80),
  }),
);
