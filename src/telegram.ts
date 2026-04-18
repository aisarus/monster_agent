import { Telegraf } from "telegraf";
import type { AppConfig } from "./config.js";
import { requireTelegramConfig } from "./config.js";
import { AgentRuntime } from "./agent.js";
import { DirectChat } from "./chat.js";
import { MemoryStore } from "./memory.js";
import { Doctor } from "./doctor.js";
import { ActivityReporter } from "./reporter.js";
import { SelfImprovementScheduler } from "./scheduler.js";

function isOwner(config: AppConfig, userId: number | undefined): boolean {
  return Boolean(userId && String(userId) === config.TELEGRAM_OWNER_ID);
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

export function createTelegramBot(
  config: AppConfig,
  agent: AgentRuntime,
  chat: DirectChat,
  memory: MemoryStore,
  doctor: Doctor,
  reporter: ActivityReporter,
  scheduler: () => SelfImprovementScheduler,
): Telegraf {
  requireTelegramConfig(config);
  const bot = new Telegraf(config.TELEGRAM_BOT_TOKEN as string);

  bot.catch((error) => {
    console.error("Telegram handler failed:", error);
  });

  bot.use(async (ctx, next) => {
    if (!isOwner(config, ctx.from?.id)) {
      await ctx.reply("Access denied.");
      return;
    }
    await next();
  });

  bot.start(async (ctx) => {
    await ctx.reply(
      [
        "Monster Agent online.",
        "Send plain text to queue an agent task.",
        "Use /chat <message> for a direct LLM reply.",
        "Use /status, /runtime, or /report for current state.",
      ].join("\n"),
    );
  });

  bot.command("status", async (ctx) => {
    await ctx.reply(await agent.status());
  });

  bot.command("memory", async (ctx) => {
    await ctx.reply(await memory.summary());
  });

  bot.command("stop", async (ctx) => {
    await ctx.reply(await agent.stop());
  });

  bot.command("pause", async (ctx) => {
    await ctx.reply(await agent.pause("Paused from Telegram."));
  });

  bot.command("resume", async (ctx) => {
    await ctx.reply(await agent.resume());
  });

  bot.command("runtime", async (ctx) => {
    await ctx.reply(await agent.runtimeStatus());
  });

  bot.command("report", async (ctx) => {
    await ctx.reply("Preparing report.");
    await reporter.sendReport();
  });

  bot.command(["chat", "ask"], async (ctx) => {
    const text = commandText(ctx.message.text);
    if (!text) {
      await ctx.reply("Напиши вопрос после команды, например: /chat что сейчас важнее сделать?");
      return;
    }

    await ctx.reply(await chat.reply(text));
  });

  bot.command("doctor", async (ctx) => {
    await ctx.reply(await doctor.run());
  });

  bot.command("autopilot_status", async (ctx) => {
    await ctx.reply(scheduler().status());
  });

  bot.command("autopilot_on", async (ctx) => {
    await ctx.reply(scheduler().enable());
  });

  bot.command("autopilot_off", async (ctx) => {
    await ctx.reply(scheduler().disable());
  });

  bot.command("autopilot_run", async (ctx) => {
    await ctx.reply(await scheduler().runNow());
  });

  bot.on("text", async (ctx) => {
    const text = ctx.message.text.trim();
    if (!text || text.startsWith("/")) {
      return;
    }

    const task = await agent.enqueue(text);
    await ctx.reply(`Queued task ${shortId(task.id)}.`);
    agent.kick();
  });

  bot.on(["voice", "photo", "document"], async (ctx) => {
    const task = await agent.enqueue(
      "Received a Telegram media input. Media parsing is not implemented yet; add media ingestion support.",
    );
    await ctx.reply(`Media accepted as task ${shortId(task.id)}. Full media parsing is next.`);
    agent.kick();
  });

  return bot;
}

function commandText(text: string): string {
  return text.replace(/^\/\S+\s*/, "").trim();
}
