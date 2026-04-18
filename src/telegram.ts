import { Telegraf } from "telegraf";
import type { AppConfig } from "./config.js";
import { requireTelegramConfig } from "./config.js";
import { AgentRuntime } from "./agent.js";
import { MemoryStore } from "./memory.js";
import { Doctor } from "./doctor.js";
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
  memory: MemoryStore,
  doctor: Doctor,
  scheduler: () => SelfImprovementScheduler,
): Telegraf {
  requireTelegramConfig(config);
  const bot = new Telegraf(config.TELEGRAM_BOT_TOKEN as string);

  bot.use(async (ctx, next) => {
    if (!isOwner(config, ctx.from?.id)) {
      await ctx.reply("Access denied.");
      return;
    }
    await next();
  });

  bot.start(async (ctx) => {
    await ctx.reply("Monster Agent online. Send a task or use /status.");
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
