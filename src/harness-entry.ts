import { buildBot } from "./bot.js";

const token = process.env.BOT_TOKEN ?? "test-token";
const bot = buildBot(token);

export { bot };
