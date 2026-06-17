import { buildBot } from "./bot.js";

const token = process.env.BOT_TOKEN;
if (!token) {
  console.error("BOT_TOKEN environment variable is required");
  process.exit(1);
}

const bot = buildBot(token);

bot.start({
  onStart: (info) => {
    console.log(`Bot @${info.username} started`);
  },
});
