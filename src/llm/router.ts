import type { AppConfig } from "../config.js";
import { BudgetTracker } from "../budget.js";
import { GeminiProvider } from "./gemini-provider.js";
import { OpenAiCompatibleProvider } from "./openai-compatible-provider.js";
import { OpenAiProvider } from "./openai-provider.js";
import { OllamaProvider } from "./ollama-provider.js";
import type { ChatRequest, ChatResponse, LlmProvider } from "./types.js";
import { classifyModelFailure, ModelCooldowns } from "./failover.js";

export class LlmRouter {
  private readonly providers: LlmProvider[];

  constructor(
    config: AppConfig,
    private readonly budget: BudgetTracker,
    private readonly cooldowns: ModelCooldowns,
  ) {
    const openai = new OpenAiProvider(config.OPENAI_API_KEY, config.OPENAI_DEFAULT_MODEL);
    const groq = new OpenAiCompatibleProvider(
      "groq",
      config.GROQ_API_KEY,
      config.GROQ_DEFAULT_MODEL,
      "https://api.groq.com/openai/v1",
      false,
    );
    const ollama = new OllamaProvider(
      config.OLLAMA_ENABLED,
      config.OLLAMA_BASE_URL,
      config.OLLAMA_MODEL,
    );
    const geminiModels = uniqueModels([
      config.GEMINI_DEFAULT_MODEL,
      ...config.GEMINI_FALLBACK_MODELS.split(",")
        .map((model) => model.trim())
        .filter(Boolean),
    ]);
    const geminiProviders = geminiModels.map(
      (model) => new GeminiProvider(config.GEMINI_API_KEY, model),
    );
    if (config.DEFAULT_PROVIDER === "openai") {
      this.providers = [openai, groq, ...geminiProviders, ollama];
      return;
    }

    if (config.DEFAULT_PROVIDER === "groq") {
      this.providers = [groq, ...geminiProviders, openai, ollama];
      return;
    }

    if (config.DEFAULT_PROVIDER === "local") {
      this.providers = [ollama, groq, ...geminiProviders, openai];
      return;
    }

    this.providers = config.OLLAMA_ENABLED
      ? [...geminiProviders, groq, ollama, openai]
      : [...geminiProviders, groq, openai];
  }

  async complete(request: ChatRequest): Promise<ChatResponse> {
    const errors: string[] = [];
    const skipped: string[] = [];

    for (const provider of this.providers) {
      const cooldownUntil = await this.cooldowns.isCoolingDown(provider.name, provider.model);
      if (cooldownUntil) {
        skipped.push(`${provider.name}/${provider.model}: cooldown until ${cooldownUntil}`);
        continue;
      }

      try {
        const response = await provider.complete(request);
        await this.budget.record({
          at: new Date().toISOString(),
          provider: response.provider,
          model: response.model,
          estimatedUsd: response.estimatedUsd,
          taskId: request.taskId,
        });
        return response;
      } catch (error) {
        const failureKind = classifyModelFailure(error, provider.name);
        await this.cooldowns.recordFailure(provider.name, provider.model, failureKind, error);
        errors.push(`${provider.name}/${provider.model}: ${failureKind}`);
      }
    }

    throw new Error(
      [`All LLM providers failed.`, ...errors, ...skipped].filter(Boolean).join(" | "),
    );
  }
}

function uniqueModels(models: string[]): string[] {
  return [...new Set(models)];
}
