import { Bot, type MiddlewareFn, type Context, type NextFunction } from "grammy";

export interface CreateBotOptions {
  token: string;
}

export interface BotContext extends Context {
  session: Record<string, unknown>;
}

export function createBot(options: CreateBotOptions): Bot<BotContext> {
  return new Bot<BotContext>(options.token);
}

export function session<S extends Record<string, unknown>>(): MiddlewareFn<Context & { session: S }> {
  const store = new Map<string, S>();

  return async (ctx, next) => {
    const key = ctx.from?.id?.toString() ?? ctx.chat?.id?.toString() ?? "unknown";
    let session = store.get(key);
    if (!session) {
      session = {} as S;
      store.set(key, session);
    }
    (ctx as unknown as { session: S }).session = session;
    await next();
    store.set(key, session);
  };
}

export { Bot, Context, MiddlewareFn, NextFunction };
