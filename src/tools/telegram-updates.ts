import "dotenv/config";

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  throw new Error("TELEGRAM_BOT_TOKEN is missing.");
}

type TelegramUpdate = {
  update_id: number;
  message?: {
    text?: string;
    from?: {
      id: number;
      is_bot: boolean;
      first_name?: string;
      username?: string;
    };
    chat?: {
      id: number;
      type: string;
    };
    date?: number;
  };
};

const response = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
const payload = (await response.json()) as {
  ok: boolean;
  result?: TelegramUpdate[];
  description?: string;
};

if (!payload.ok) {
  throw new Error(payload.description ?? "Telegram getUpdates failed.");
}

const updates = payload.result ?? [];

if (updates.length === 0) {
  console.log("No updates. Send /start to the bot, then run this again.");
} else {
  for (const update of updates.slice(-10)) {
    const from = update.message?.from;
    const chat = update.message?.chat;
    console.log(
      JSON.stringify(
        {
          updateId: update.update_id,
          userId: from?.id,
          username: from?.username,
          firstName: from?.first_name,
          chatId: chat?.id,
          chatType: chat?.type,
          text: update.message?.text,
        },
        null,
        2,
      ),
    );
  }
}
