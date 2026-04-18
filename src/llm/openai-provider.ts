import OpenAI from "openai";
import type { ChatRequest, ChatResponse, LlmProvider } from "./types.js";

export class OpenAiProvider implements LlmProvider {
  readonly name = "openai";
  private readonly client?: OpenAI;

  constructor(
    apiKey: string | undefined,
    public readonly model: string,
  ) {
    this.client = apiKey ? new OpenAI({ apiKey }) : undefined;
  }

  async complete(request: ChatRequest): Promise<ChatResponse> {
    if (!this.client) {
      throw new Error("OpenAI API key is not configured.");
    }

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: request.messages,
      temperature: 0.2,
      response_format: { type: "json_object" },
    });

    return {
      content: response.choices[0]?.message.content?.trim() || "No response.",
      provider: this.name,
      model: this.model,
      estimatedUsd: 0,
    };
  }
}
