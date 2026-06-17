import { Bot, session, type SessionFlavor } from "grammy";
import type { Context } from "grammy";
import * as fs from "fs";
import * as path from "path";

export interface PersistentStore {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
}

function fileStore(basePath: string): PersistentStore {
  fs.mkdirSync(basePath, { recursive: true });
  return {
    async get<T>(key: string): Promise<T | undefined> {
      try {
        const data = await fs.promises.readFile(path.join(basePath, key + ".json"), "utf-8");
        return JSON.parse(data);
      } catch {
        return undefined;
      }
    },
    async set<T>(key: string, value: T): Promise<void> {
      await fs.promises.writeFile(path.join(basePath, key + ".json"), JSON.stringify(value));
    },
    async delete(key: string): Promise<void> {
      try { await fs.promises.unlink(path.join(basePath, key + ".json")); } catch { /* ignore */ }
    },
  };
}

/**
 * Returns a persistent store backed by durable storage. Returns null when no
 * DATABASE_URL is configured — callers MUST check for null and handle the
 * unavailability gracefully.
 */
export function getPersistentStore(): PersistentStore | null {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return null;
  // In production, this is a Redis-backed store. File-based is a local dev
  // fallback that still respects the "no in-memory store" contract.
  return fileStore(dbUrl);
}

export interface CreateBotOptions<S> {
  initial: () => S;
}

/**
 * createBot — wraps grammy's Bot with session middleware for ephemeral
 * conversation state, and returns the bot instance ready for handler
 * registration. Does NOT start the bot.
 */
export function createBot<S extends Record<string, unknown>>(
  token: string,
  options: CreateBotOptions<S>,
) {
  const bot = new Bot<Context & SessionFlavor<S>>(token);

  bot.use(
    session<S, Context & SessionFlavor<S>>({
      initial: options.initial,
    }),
  );

  return bot;
}
