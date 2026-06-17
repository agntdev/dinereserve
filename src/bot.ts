import { createBot, session, type BotContext } from "@agntdev/bot-toolkit";
import type { Context } from "grammy";

interface SessionData extends Record<string, unknown> {
  startedAt?: number;
}

export function buildBot(token: string): ReturnType<typeof createBot> {
  const bot = createBot({ token });

  bot.use(session<SessionData>());

  bot.on("message", async (ctx: Context) => {
    const text = ctx.message?.text;
    if (text) {
      await ctx.reply(
        "Welcome to DineReserve! I help you book tables at our restaurant.\n\n" +
          "Use /reserve to make a reservation."
      );
    }
  });

  return bot;
}