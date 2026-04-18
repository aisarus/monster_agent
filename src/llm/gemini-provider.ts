import { GoogleGenerativeAI } from "@google/generative-ai";
import type { ChatRequest, ChatResponse, LlmProvider } from "./types.js";

export class GeminiProvider implements LlmProvider {
  readonly name = "gemini";
  private readonly client?: GoogleGenerativeAI;

  constructor(
    apiKey: string | undefined,
    public readonly model: string,
  ) {
    this.client = apiKey ? new GoogleGenerativeAI(apiKey) : undefined;
  }

  async complete(request: ChatRequest): Promise<ChatResponse> {
    if (!this.client) {
      throw new Error("Gemini API key is not configured.");
    }

    const model = this.client.getGenerativeModel({ model: this.model });
    const prompt = request.messages
      .map((message) => `${message.role.toUpperCase()}:\n${message.content}`)
      .join("\n\n");
    const response = await model.generateContent(prompt);

    return {
      content: response.response.text().trim() || "No response.",
      provider: this.name,
      model: this.model,
      estimatedUsd: 0,
    };
  }
}
