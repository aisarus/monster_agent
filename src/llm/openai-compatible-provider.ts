import OpenAI from "openai";
import type { ChatRequest, ChatResponse, LlmProvider } from "./types.js";

export class OpenAiCompatibleProvider implements LlmProvider {
  private readonly client?: OpenAI;

  constructor(
    public readonly name: string,
    apiKey: string | undefined,
    public readonly model: string,
    baseURL: string,
    private readonly jsonMode = false,
  ) {
    this.client = apiKey ? new OpenAI({ apiKey, baseURL }) : undefined;
  }

  async complete(request: ChatRequest): Promise<ChatResponse> {
    if (!this.client) {
      throw new Error(`${this.name} API key is not configured.`);
    }

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: request.messages,
      temperature: 0.2,
      ...(this.jsonMode ? { response_format: { type: "json_object" as const } } : {}),
    });

    return {
      content: response.choices[0]?.message.content?.trim() || "No response.",
      provider: this.name,
      model: this.model,
      estimatedUsd: 0,
    };
  }
}
