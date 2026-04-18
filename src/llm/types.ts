export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ChatRequest = {
  messages: ChatMessage[];
  taskId?: string;
};

export type ChatResponse = {
  content: string;
  provider: string;
  model: string;
  estimatedUsd: number;
};

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  complete(request: ChatRequest): Promise<ChatResponse>;
}
