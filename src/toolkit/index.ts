import { Bot, session, type SessionFlavor } from "grammy";
import type { Context } from "grammy";
import { Pool } from "pg";

export interface CreateBotOptions<S> {
  initial: () => S;
}

export type BotWithSession<S> = Bot<Context & SessionFlavor<S>>;

export function createBot<S extends object>(
  token: string,
  options: CreateBotOptions<S>
): BotWithSession<S> {
  const bot = new Bot<Context & SessionFlavor<S>>(token);
  bot.use(session({ initial: options.initial }));
  return bot;
}

let pool: Pool | null = null;
let poolInitFailed = false;

export function getPool(): Pool | null {
  if (pool) return pool;
  if (poolInitFailed) return null;
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  try {
    pool = new Pool({ connectionString: url, max: 10 });
  } catch {
    poolInitFailed = true;
    return null;
  }
  return pool;
}

export function getBookingPool(): Pool | null {
  return getPool();
}
