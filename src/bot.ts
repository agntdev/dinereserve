import { createBot, session, type BotContext } from "@agntdev/bot-toolkit";
import type { Context } from "grammy";

interface SessionData extends Record<string, unknown> {
  startedAt?: number;
}

const WELCOME_TEXT =
  "Welcome to DineReserve! 🍽️\n\n" +
  "I help you book tables at our restaurant. Choose an option below:";

const HELP_TEXT =
  "DineReserve commands:\n\n" +
  "/start — Open the main menu\n" +
  "/reserve — Book a table\n" +
  "/help — Show this command list\n\n" +
  "Admin commands (owners only):\n" +
  "/bookings_today — Today's bookings\n" +
  "/bookings — Bookings for a date\n" +
  "/capacity_today — Today's capacity\n" +
  "/config — Restaurant settings\n" +
  "/export — Export bookings to CSV";

const GENERIC_REPLY =
  "Welcome to DineReserve! I help you book tables at our restaurant.\n\n" +
  "Use /reserve to make a reservation.";

const UNKNOWN_COMMAND_REPLY =
  "I don't recognize that command. Send /help to see available commands.";

const ERROR_REPLY =
  "Something went wrong. Please try again or use /help.";

function mainMenuKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "📅 Make a Reservation", callback_data: "menu:reserve" }],
      [{ text: "ℹ️ Help", callback_data: "menu:help" }],
    ],
  };
}

function isBotCommand(ctx: Context): boolean {
  return (
    ctx.message?.entities?.some((entity) => entity.type === "bot_command") ??
    false
  );
}

export function buildBot(token: string): ReturnType<typeof createBot> {
  const bot = createBot({ token });

  bot.use(session<SessionData>());

  bot.command("start", async (ctx: BotContext) => {
    ctx.session.startedAt = Date.now();
    await ctx.reply(WELCOME_TEXT, { reply_markup: mainMenuKeyboard() });
  });

  bot.command("help", async (ctx: BotContext) => {
    await ctx.reply(HELP_TEXT);
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
    if (!text) {
      return;
    }

    if (isBotCommand(ctx)) {
      await ctx.reply(UNKNOWN_COMMAND_REPLY);
      return;
    }

    await ctx.reply(GENERIC_REPLY);
  });

  bot.catch(async (err) => {
    console.error("Bot error:", err.error);

    const ctx = err.ctx;
    try {
      await ctx.reply(ERROR_REPLY);
    } catch (replyError) {
      console.error("Failed to send error reply:", replyError);
    }
  });

  return bot;
}