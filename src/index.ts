import { buildBot } from "./bot.js";
import { startReminderPolling } from "./reminders.js";

// Runtime entry (dist/index.js). BOT_TOKEN is injected at runtime as a secret.
const token = process.env.BOT_TOKEN;
if (!token) {
  console.error("BOT_TOKEN is required");
  process.exit(1);
}

const bot = buildBot(token);
bot.start();
startReminderPolling(bot);
