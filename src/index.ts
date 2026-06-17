import { buildBot } from "./bot.js";
import { getPool } from "./db/pool.js";
import { startReminderWorker } from "./reminders.js";

const token = process.env.BOT_TOKEN;
if (!token) {
  console.error("BOT_TOKEN environment variable is required");
  process.exit(1);
}

const bot = buildBot(token);
startReminderWorker(bot, getPool());

bot.start({
  onStart: (info) => {
    console.log(`Bot @${info.username} started`);
  },
});
