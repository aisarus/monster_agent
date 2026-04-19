import type { ChatRequest, ChatResponse, LlmProvider } from "./types.js";

type OllamaChatResponse = {
  message?: {
    content?: string;
  };
};

export class OllamaProvider implements LlmProvider {
  readonly name = "ollama";

  constructor(
    private readonly enabled: boolean,
    private readonly baseUrl: string,
    public readonly model: string,
  ) {}

  async complete(request: ChatRequest): Promise<ChatResponse> {
    if (!this.enabled) {
      throw new Error("Ollama provider is not enabled.");
    }

    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({
        model: this.model,
        messages: request.messages,
        stream: false,
        options: {
          temperature: 0.1,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama request failed: ${response.status} ${await response.text()}`);
    }

    const payload = (await response.json()) as OllamaChatResponse;

    return {
      content: payload.message?.content?.trim() || "No response.",
      provider: this.name,
      model: this.model,
      estimatedUsd: 0,
    };
  }
}
