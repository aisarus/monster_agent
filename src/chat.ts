import { LlmRouter } from "./llm/router.js";

export class DirectChat {
  constructor(private readonly llm: LlmRouter) {}

  async reply(message: string): Promise<string> {
    const response = await this.llm.complete({
      taskId: "direct-chat",
      messages: [
        {
          role: "system",
          content: [
            "You are a helpful personal assistant chatting directly with the owner.",
            "Reply in Russian unless the owner asks otherwise.",
            "Do not use tools or claim that you changed files.",
            "Keep the answer practical and conversational.",
          ].join("\n"),
        },
        {
          role: "user",
          content: message,
        },
      ],
    });

    return response.content.trim() || "Пустой ответ от модели.";
  }
}
