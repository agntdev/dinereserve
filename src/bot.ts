import { createBot, session, type BotContext } from "@agntdev/bot-toolkit";
import type { Context } from "grammy";

interface SessionData extends Record<string, unknown> {
  startedAt?: number;
}

const WELCOME_TEXT =
  "Welcome to DineReserve! 🍽️\n\n" +
  "I help you book tables at our restaurant. Choose an option below:";

const GENERIC_REPLY =
  "Welcome to DineReserve! I help you book tables at our restaurant.\n\n" +
  "Use /reserve to make a reservation.";

function mainMenuKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "📅 Make a Reservation", callback_data: "menu:reserve" }],
      [{ text: "ℹ️ Help", callback_data: "menu:help" }],
    ],
  };
}

export function buildBot(token: string): ReturnType<typeof createBot> {
  const bot = createBot({ token });

  bot.use(session<SessionData>());

  bot.command("start", async (ctx: BotContext) => {
    ctx.session.startedAt = Date.now();
    await ctx.reply(WELCOME_TEXT, { reply_markup: mainMenuKeyboard() });
  });

  bot.callbackQuery(/^menu:/, async (ctx) => {
    const data = ctx.callbackQuery.data;

    if (data === "menu:reserve") {
      await ctx.editMessageText("Send /reserve to start booking a table.", {
        reply_markup: mainMenuKeyboard(),
      });
    } else if (data === "menu:help") {
      await ctx.editMessageText(
        "Available commands:\n" +
          "/start — Main menu\n" +
          "/reserve — Book a table\n" +
          "/help — Show this help",
        { reply_markup: mainMenuKeyboard() }
      );
    }

    await ctx.answerCallbackQuery();
  });

  bot.on("message", async (ctx: Context) => {
    const text = ctx.message?.text;
    if (text && !text.startsWith("/")) {
      await ctx.reply(GENERIC_REPLY);
    }
  });

  return bot;
}