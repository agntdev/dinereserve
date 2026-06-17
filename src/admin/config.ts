import type { Bot } from "grammy";
import type { BotContext } from "@agntdev/bot-toolkit";
import { getRepository } from "../db/index.js";
import { getPool } from "../db/pool.js";
import {
  DEFAULT_RESTAURANT_CONFIG,
  type RestaurantConfig,
  type Table,
} from "../config.js";
import { loadRestaurantConfig } from "../restaurant-config.js";
import { isAdmin } from "./auth.js";

const ACCESS_DENIED = "This command is only available to restaurant staff.";
const CALLBACK_DENIED = "Only staff can manage configuration.";

const OPENING_HOUR_OPTIONS = [8, 9, 10, 11, 12] as const;
const CLOSING_HOUR_OPTIONS = [16, 17, 18, 19, 20, 21, 22, 23] as const;
const MINUTE_OPTIONS = [0, 15, 30, 45] as const;
const SITTING_OPTIONS = [60, 75, 90, 120, 150, 180] as const;
const GRANULARITY_OPTIONS = [15, 30, 60] as const;

interface ConfigSession {
  configStep?:
    | "opening_hour"
    | "opening_minute"
    | "closing_hour"
    | "closing_minute"
    | "sitting"
    | "granularity"
    | "add_table_seats"
    | "add_table_label"
    | "edit_table_seats"
    | "edit_table_label"
    | "custom_hour"
    | "custom_minute";
  configEditingTableId?: string;
  configEditingTableSeats?: number;
}

function configSession(ctx: BotContext): ConfigSession {
  return ctx.session as ConfigSession;
}

function resetConfigSession(ctx: BotContext): void {
  const s = configSession(ctx);
  s.configStep = undefined;
  s.configEditingTableId = undefined;
  s.configEditingTableSeats = undefined;
}

function formatTime(hour: number, minute: number): string {
  return `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
}

async function loadConfig(): Promise<{
  config: RestaurantConfig;
  hasConfig: boolean;
} | null> {
  const pool = getPool();
  if (!pool) {
    return null;
  }

  const config = await loadRestaurantConfig(pool);
  if (!config) {
    return {
      config: { ...DEFAULT_RESTAURANT_CONFIG, tables: [] },
      hasConfig: false,
    };
  }

  const hasConfig = (await getRepository(pool).configs.getLatest("restaurant.defaults")) !== null;
  return { config, hasConfig };
}

async function persistConfigValue(key: string, value: unknown): Promise<void> {
  const pool = getPool();
  if (!pool) {
    return;
  }

  const repo = getRepository(pool);
  const current = await repo.configs.getLatest("restaurant.defaults");
  const currentValue: Record<string, unknown> = current?.value
    ? { ...(current.value as Record<string, unknown>) }
    : {};

  currentValue[key] = value;

  await repo.configs.upsert("restaurant.defaults", currentValue);
}

async function persistOpeningHour(hour: number): Promise<void> {
  await persistConfigValue("openingHour", hour);
}

async function persistOpeningMinute(minute: number): Promise<void> {
  await persistConfigValue("openingMinute", minute);
}

async function persistClosingHour(hour: number): Promise<void> {
  await persistConfigValue("closingHour", hour);
}

async function persistClosingMinute(minute: number): Promise<void> {
  await persistConfigValue("closingMinute", minute);
}

async function persistSittingLength(minutes: number): Promise<void> {
  await persistConfigValue("sittingLengthMinutes", minutes);
}

async function persistGranularity(minutes: number): Promise<void> {
  await persistConfigValue("slotGranularityMinutes", minutes);
}

async function toggleTableSplitting(current: boolean): Promise<void> {
  await persistConfigValue("allowTableSplitting", !current);
}

async function addTable(seats: number, label?: string): Promise<Table | null> {
  const pool = getPool();
  if (!pool) {
    return null;
  }

  const repo = getRepository(pool);
  const existing = await repo.restaurantTables.list();
  const maxId = existing.reduce((max, t) => {
    const num = Number.parseInt(t.id.replace(/^\D+/g, ""), 10);
    return Number.isFinite(num) && num > max ? num : max;
  }, 0);
  const newId = `t${maxId + 1}`;
  const tableLabel = label ?? `Table ${maxId + 1}`;

  try {
    const row = await repo.restaurantTables.create({
      id: newId,
      seats,
      label: tableLabel,
    });
    return { id: row.id, seats: row.seats, label: row.label ?? undefined };
  } catch (error) {
    console.error("Failed to add table:", error);
    return null;
  }
}

async function updateTableSeats(id: string, seats: number): Promise<boolean> {
  const pool = getPool();
  if (!pool) {
    return false;
  }

  try {
    const repo = getRepository(pool);
    const updated = await repo.restaurantTables.update(id, { seats });
    return updated !== null;
  } catch (error) {
    console.error("Failed to update table:", error);
    return false;
  }
}

async function updateTableLabel(id: string, label: string): Promise<boolean> {
  const pool = getPool();
  if (!pool) {
    return false;
  }

  try {
    const repo = getRepository(pool);
    const updated = await repo.restaurantTables.update(id, { label });
    return updated !== null;
  } catch (error) {
    console.error("Failed to update table label:", error);
    return false;
  }
}

async function deleteTable(id: string): Promise<boolean> {
  const pool = getPool();
  if (!pool) {
    return false;
  }

  try {
    const repo = getRepository(pool);
    return repo.restaurantTables.delete(id);
  } catch (error) {
    console.error("Failed to delete table:", error);
    return false;
  }
}

function formatTablesList(tables: Table[]): string {
  if (tables.length === 0) {
    return "No tables configured.";
  }

  return tables
    .map((t) => `  • ${t.label ?? t.id} — ${t.seats} seat${t.seats > 1 ? "s" : ""}`)
    .join("\n");
}

function formatConfigSummary(config: RestaurantConfig, hasConfig: boolean): string {
  const opening = formatTime(config.openingHour, config.openingMinute);
  const closing = formatTime(config.closingHour, config.closingMinute);

  return (
    "Restaurant Configuration\n\n" +
    (hasConfig ? "" : "⚠️ No saved configuration found — showing defaults.\nRun /setup first to save your settings.\n\n") +
    `Opening: ${opening}\n` +
    `Closing: ${closing}\n` +
    `Sitting length: ${config.sittingLengthMinutes} min\n` +
    `Slot granularity: ${config.slotGranularityMinutes} min\n` +
    `Table splitting: ${config.allowTableSplitting ? "Enabled" : "Disabled"}\n\n` +
    "Tables:\n" +
    formatTablesList(config.tables)
  );
}

function configMenuKeyboard(tables: Table[]) {
  const rows: Array<Array<{ text: string; callback_data: string }>> = [
    [
      { text: "🕐 Opening Hour", callback_data: "cfg:edit:opening_hour" },
      { text: "🕛 Opening Minute", callback_data: "cfg:edit:opening_minute" },
    ],
    [
      { text: "🕘 Closing Hour", callback_data: "cfg:edit:closing_hour" },
      { text: "🕛 Closing Minute", callback_data: "cfg:edit:closing_minute" },
    ],
    [
      { text: "⏱ Sitting Length", callback_data: "cfg:edit:sitting" },
      { text: "⏳ Granularity", callback_data: "cfg:edit:granularity" },
    ],
    [
      {
        text: "🔀 Toggle Table Splitting",
        callback_data: "cfg:toggle:splitting",
      },
    ],
  ];

  if (tables.length > 0) {
    rows.push([
      { text: "🍽️ Manage Tables", callback_data: "cfg:tables" },
    ]);
  } else {
    rows.push([
      { text: "➕ Add First Table", callback_data: "cfg:table:add" },
    ]);
  }

  return { inline_keyboard: rows };
}

function hourKeyboard(prefix: string) {
  const hours = prefix === "opening" ? OPENING_HOUR_OPTIONS : CLOSING_HOUR_OPTIONS;
  return {
    inline_keyboard: hours.map((h) => [
      {
        text: `${h.toString().padStart(2, "0")}:00`,
        callback_data: `cfg:set:hour:${prefix}:${h}`,
      },
    ]).concat([
      [
        {
          text: "✏️ Custom...",
          callback_data: `cfg:custom:${prefix}_hour`,
        },
      ],
      [{ text: "« Back to Menu", callback_data: "cfg:menu" }],
    ]),
  };
}

function minuteKeyboard(prefix: string) {
  return {
    inline_keyboard: MINUTE_OPTIONS.map((m) => [
      {
        text: `:${m.toString().padStart(2, "0")}`,
        callback_data: `cfg:set:minute:${prefix}:${m}`,
      },
    ]).concat([
      [
        {
          text: "✏️ Custom...",
          callback_data: `cfg:custom:${prefix}_minute`,
        },
      ],
      [{ text: "« Back to Menu", callback_data: "cfg:menu" }],
    ]),
  };
}

function sittingKeyboard() {
  return {
    inline_keyboard: SITTING_OPTIONS.map((m) => [
      {
        text: `${m} min`,
        callback_data: `cfg:set:sitting:${m}`,
      },
    ]).concat([
      [{ text: "« Back to Menu", callback_data: "cfg:menu" }],
    ]),
  };
}

function granularityKeyboard() {
  return {
    inline_keyboard: GRANULARITY_OPTIONS.map((m) => [
      {
        text: `${m} min`,
        callback_data: `cfg:set:granularity:${m}`,
      },
    ]).concat([
      [{ text: "« Back to Menu", callback_data: "cfg:menu" }],
    ]),
  };
}

function tablesManageKeyboard(tables: Table[]) {
  const rows: Array<Array<{ text: string; callback_data: string }>> = [];

  for (const table of tables) {
    rows.push([
      {
        text: `✏️ ${table.label ?? table.id} (${table.seats} seats)`,
        callback_data: `cfg:table:edit:${table.id}`,
      },
      {
        text: "🗑 Delete",
        callback_data: `cfg:table:delete:${table.id}`,
      },
    ]);
  }

  rows.push([{ text: "➕ Add Table", callback_data: "cfg:table:add" }]);
  rows.push([{ text: "« Back to Menu", callback_data: "cfg:menu" }]);

  return { inline_keyboard: rows };
}

function editTableKeyboard(tableId: string) {
  return {
    inline_keyboard: [
      [
        {
          text: "🪑 Change Seats",
          callback_data: `cfg:table:edit_seats:${tableId}`,
        },
      ],
      [
        {
          text: "🏷️ Change Label",
          callback_data: `cfg:table:edit_label:${tableId}`,
        },
      ],
      [{ text: "« Back to Tables", callback_data: "cfg:tables" }],
    ],
  };
}

function deleteConfirmKeyboard(tableId: string) {
  return {
    inline_keyboard: [
      [
        {
          text: "✅ Yes, delete",
          callback_data: `cfg:table:delete_confirm:${tableId}`,
        },
      ],
      [{ text: "« Cancel", callback_data: "cfg:tables" }],
    ],
  };
}

async function showConfigMenu(ctx: BotContext): Promise<void> {
  const result = await loadConfig();
  if (!result) {
    await ctx.reply("Unable to load configuration. Please ensure DATABASE_URL is configured.");
    return;
  }

  const { config, hasConfig } = result;
  const text = formatConfigSummary(config, hasConfig);
  const keyboard = configMenuKeyboard(config.tables);

  if (ctx.callbackQuery?.message) {
    await ctx.editMessageText(text, { reply_markup: keyboard });
  } else {
    await ctx.reply(text, { reply_markup: keyboard });
  }
}

async function showTablesMenu(ctx: BotContext): Promise<void> {
  const result = await loadConfig();
  if (!result) {
    await ctx.reply("Unable to load configuration.");
    return;
  }

  const tables = result.config.tables;
  if (tables.length === 0) {
    await ctx.editMessageText(
      "No tables configured yet. Would you like to add one?",
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "➕ Add Table", callback_data: "cfg:table:add" }],
            [{ text: "« Back to Menu", callback_data: "cfg:menu" }],
          ],
        },
      }
    );
    return;
  }

  await ctx.editMessageText("Manage restaurant tables:", {
    reply_markup: tablesManageKeyboard(tables),
  });
}

async function handleSetHour(ctx: BotContext, prefix: string, value: string): Promise<void> {
  const hour = Number.parseInt(value, 10);
  if (!Number.isFinite(hour) || hour < 0 || hour > 23) {
    await ctx.answerCallbackQuery({ text: "Invalid hour." });
    return;
  }

  if (prefix === "opening") {
    await persistOpeningHour(hour);
  } else {
    await persistClosingHour(hour);
  }

  await ctx.answerCallbackQuery({ text: "Updated" });
  await showConfigMenu(ctx);
}

async function handleSetMinute(ctx: BotContext, prefix: string, value: string): Promise<void> {
  const minute = Number.parseInt(value, 10);
  if (!Number.isFinite(minute) || minute < 0 || minute > 59) {
    await ctx.answerCallbackQuery({ text: "Invalid minute." });
    return;
  }

  if (prefix === "opening") {
    await persistOpeningMinute(minute);
  } else {
    await persistClosingMinute(minute);
  }

  await ctx.answerCallbackQuery({ text: "Updated" });
  await showConfigMenu(ctx);
}

async function handleSetSitting(ctx: BotContext, value: string): Promise<void> {
  const minutes = Number.parseInt(value, 10);
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 480) {
    await ctx.answerCallbackQuery({ text: "Invalid sitting length." });
    return;
  }

  await persistSittingLength(minutes);
  await ctx.answerCallbackQuery({ text: "Updated" });
  await showConfigMenu(ctx);
}

async function handleSetGranularity(ctx: BotContext, value: string): Promise<void> {
  const minutes = Number.parseInt(value, 10);
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 120) {
    await ctx.answerCallbackQuery({ text: "Invalid granularity." });
    return;
  }

  await persistGranularity(minutes);
  await ctx.answerCallbackQuery({ text: "Updated" });
  await showConfigMenu(ctx);
}

async function handleToggleSplitting(ctx: BotContext): Promise<void> {
  const result = await loadConfig();
  if (!result) {
    await ctx.answerCallbackQuery({ text: "Failed to load config." });
    return;
  }

  await toggleTableSplitting(result.config.allowTableSplitting);
  await ctx.answerCallbackQuery({ text: "Toggled" });
  await showConfigMenu(ctx);
}

async function handleAddTable(ctx: BotContext): Promise<void> {
  const s = configSession(ctx);
  s.configStep = "add_table_seats";
  s.configEditingTableId = undefined;
  s.configEditingTableSeats = undefined;

  await ctx.editMessageText(
    "How many seats should the new table have?\n\nType a number (e.g., 4):"
  );
}

async function handleEditTable(ctx: BotContext, tableId: string): Promise<void> {
  const pool = getPool();
  if (!pool) {
    await ctx.answerCallbackQuery({ text: "Database unavailable." });
    return;
  }

  const table = await getRepository(pool).restaurantTables.get(tableId);
  if (!table) {
    await ctx.answerCallbackQuery({ text: "Table not found." });
    return;
  }

  await ctx.editMessageText(
    `Editing table ${table.label ?? table.id} (${table.seats} seats):\n` +
      "What would you like to change?",
    { reply_markup: editTableKeyboard(tableId) }
  );
}

async function handleEditTableSeats(ctx: BotContext, tableId: string): Promise<void> {
  const s = configSession(ctx);
  s.configStep = "edit_table_seats";
  s.configEditingTableId = tableId;

  await ctx.editMessageText(
    "How many seats should this table have?\n\nType a number (e.g., 4):"
  );
}

async function handleEditTableLabel(ctx: BotContext, tableId: string): Promise<void> {
  const s = configSession(ctx);
  s.configStep = "edit_table_label";
  s.configEditingTableId = tableId;

  await ctx.editMessageText(
    "What label should this table have?\n\nType a label (e.g., \"Window Table\"):"
  );
}

async function handleDeleteTable(ctx: BotContext, tableId: string): Promise<void> {
  const pool = getPool();
  if (!pool) {
    await ctx.answerCallbackQuery({ text: "Database unavailable." });
    return;
  }

  const table = await getRepository(pool).restaurantTables.get(tableId);
  if (!table) {
    await ctx.answerCallbackQuery({ text: "Table not found." });
    return;
  }

  await ctx.editMessageText(
    `Are you sure you want to delete table ${table.label ?? table.id} (${table.seats} seats)?\n\nThis cannot be undone.`,
    { reply_markup: deleteConfirmKeyboard(tableId) }
  );
}

async function handleDeleteTableConfirm(ctx: BotContext, tableId: string): Promise<void> {
  const deleted = await deleteTable(tableId);
  if (!deleted) {
    await ctx.answerCallbackQuery({ text: "Failed to delete table." });
    return;
  }

  await ctx.answerCallbackQuery({ text: "Table deleted" });

  const result = await loadConfig();
  if (!result || result.config.tables.length === 0) {
    await ctx.editMessageText(
      "Table deleted. No tables remaining.",
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "➕ Add Table", callback_data: "cfg:table:add" }],
            [{ text: "« Back to Menu", callback_data: "cfg:menu" }],
          ],
        },
      }
    );
    return;
  }

  await showTablesMenu(ctx);
}

async function handleTextInput(ctx: BotContext, text: string): Promise<boolean> {
  const s = configSession(ctx);
  const step = s.configStep;

  if (!step) {
    return false;
  }

  const trimmed = text.trim();

  switch (step) {
    case "opening_hour":
    case "closing_hour":
    case "custom_hour": {
      const hour = Number.parseInt(trimmed, 10);
      if (!Number.isFinite(hour) || hour < 0 || hour > 23) {
        await ctx.reply("Please enter a valid hour (0–23).");
        return true;
      }

      if (step === "opening_hour" || step === "custom_hour") {
        await persistOpeningHour(hour);
      } else {
        await persistClosingHour(hour);
      }

      resetConfigSession(ctx);
      await showConfigMenu(ctx);
      return true;
    }

    case "opening_minute":
    case "closing_minute":
    case "custom_minute": {
      const minute = Number.parseInt(trimmed, 10);
      if (!Number.isFinite(minute) || minute < 0 || minute > 59) {
        await ctx.reply("Please enter a valid minute (0–59).");
        return true;
      }

      if (step === "opening_minute") {
        await persistOpeningMinute(minute);
      } else if (step === "closing_minute") {
        await persistClosingMinute(minute);
      }

      resetConfigSession(ctx);
      await showConfigMenu(ctx);
      return true;
    }

    case "sitting": {
      const minutes = Number.parseInt(trimmed, 10);
      if (!Number.isFinite(minutes) || minutes < 1 || minutes > 480) {
        await ctx.reply("Please enter a valid sitting length in minutes (1–480).");
        return true;
      }

      await persistSittingLength(minutes);
      resetConfigSession(ctx);
      await showConfigMenu(ctx);
      return true;
    }

    case "granularity": {
      const minutes = Number.parseInt(trimmed, 10);
      if (!Number.isFinite(minutes) || minutes < 1 || minutes > 120) {
        await ctx.reply("Please enter a valid granularity in minutes (1–120).");
        return true;
      }

      await persistGranularity(minutes);
      resetConfigSession(ctx);
      await showConfigMenu(ctx);
      return true;
    }

    case "add_table_seats": {
      const seats = Number.parseInt(trimmed, 10);
      if (!Number.isFinite(seats) || seats < 1 || seats > 100) {
        await ctx.reply("Please enter a valid number of seats (1–100).");
        return true;
      }

      s.configStep = "add_table_label";
      s.configEditingTableSeats = seats;

      await ctx.reply(
        "What label should this table have?\n\nType a label or tap Skip below:",
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: "Skip", callback_data: "cfg:table:skip_label" }],
            ],
          },
        }
      );
      return true;
    }

    case "add_table_label": {
      const seats = s.configEditingTableSeats;
      if (seats === undefined) {
        await ctx.reply("Something went wrong. Please start over with /config.");
        resetConfigSession(ctx);
        return true;
      }

      const table = await addTable(seats, trimmed || undefined);
      if (!table) {
        await ctx.reply("Failed to add table. Please try again.");
        return true;
      }

      resetConfigSession(ctx);
      await ctx.reply(`Table "${table.label ?? table.id}" added with ${table.seats} seats.`);
      await showConfigMenu(ctx);
      return true;
    }

    case "edit_table_seats": {
      const tableId = s.configEditingTableId;
      if (!tableId) {
        await ctx.reply("Something went wrong. Please start over with /config.");
        resetConfigSession(ctx);
        return true;
      }

      const seats = Number.parseInt(trimmed, 10);
      if (!Number.isFinite(seats) || seats < 1 || seats > 100) {
        await ctx.reply("Please enter a valid number of seats (1–100).");
        return true;
      }

      const updated = await updateTableSeats(tableId, seats);
      if (!updated) {
        await ctx.reply("Failed to update table seats. Please try again.");
        return true;
      }

      resetConfigSession(ctx);
      await ctx.reply(`Table updated to ${seats} seats.`);
      await showConfigMenu(ctx);
      return true;
    }

    case "edit_table_label": {
      const tableId = s.configEditingTableId;
      if (!tableId) {
        await ctx.reply("Something went wrong. Please start over with /config.");
        resetConfigSession(ctx);
        return true;
      }

      if (trimmed.length < 1) {
        await ctx.reply("Please enter a label for the table.");
        return true;
      }

      const updated = await updateTableLabel(tableId, trimmed);
      if (!updated) {
        await ctx.reply("Failed to update table label. Please try again.");
        return true;
      }

      resetConfigSession(ctx);
      await ctx.reply(`Table label updated to "${trimmed}".`);
      await showConfigMenu(ctx);
      return true;
    }

    default:
      return false;
  }
}

export async function handleConfigMessage(ctx: BotContext): Promise<boolean> {
  const text = ctx.message?.text;
  if (!text) {
    return false;
  }

  const s = configSession(ctx);
  if (!s.configStep) {
    return false;
  }

  const isBotCommand =
    ctx.message?.entities?.some((entity) => entity.type === "bot_command") ?? false;
  if (isBotCommand) {
    return false;
  }

  return handleTextInput(ctx, text);
}

async function startConfig(ctx: BotContext): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId || !(await isAdmin(userId))) {
    await ctx.reply(ACCESS_DENIED);
    return;
  }

  resetConfigSession(ctx);
  await showConfigMenu(ctx);
}

export function registerConfigHandlers(bot: Bot<BotContext>): void {
  bot.command("config", async (ctx) => {
    await startConfig(ctx);
  });

  bot.callbackQuery(/^cfg:/, async (ctx) => {
    const data = ctx.callbackQuery.data;
    if (!data) {
      await ctx.answerCallbackQuery();
      return;
    }

    const userId = ctx.from?.id;
    if (!userId || !(await isAdmin(userId))) {
      await ctx.answerCallbackQuery({ text: CALLBACK_DENIED });
      return;
    }

    const s = configSession(ctx);

    if (data === "cfg:menu") {
      resetConfigSession(ctx);
      await showConfigMenu(ctx);
      await ctx.answerCallbackQuery();
      return;
    }

    if (data === "cfg:edit:opening_hour") {
      await ctx.editMessageText("Select opening hour:", {
        reply_markup: hourKeyboard("opening"),
      });
      await ctx.answerCallbackQuery();
      return;
    }

    if (data === "cfg:edit:opening_minute") {
      await ctx.editMessageText("Select opening minute:", {
        reply_markup: minuteKeyboard("opening"),
      });
      await ctx.answerCallbackQuery();
      return;
    }

    if (data === "cfg:edit:closing_hour") {
      await ctx.editMessageText("Select closing hour:", {
        reply_markup: hourKeyboard("closing"),
      });
      await ctx.answerCallbackQuery();
      return;
    }

    if (data === "cfg:edit:closing_minute") {
      await ctx.editMessageText("Select closing minute:", {
        reply_markup: minuteKeyboard("closing"),
      });
      await ctx.answerCallbackQuery();
      return;
    }

    if (data === "cfg:edit:sitting") {
      await ctx.editMessageText("Select sitting length:", {
        reply_markup: sittingKeyboard(),
      });
      await ctx.answerCallbackQuery();
      return;
    }

    if (data === "cfg:edit:granularity") {
      await ctx.editMessageText("Select slot granularity:", {
        reply_markup: granularityKeyboard(),
      });
      await ctx.answerCallbackQuery();
      return;
    }

    if (data === "cfg:toggle:splitting") {
      await handleToggleSplitting(ctx);
      return;
    }

    if (data === "cfg:tables") {
      await showTablesMenu(ctx);
      await ctx.answerCallbackQuery();
      return;
    }

    if (data === "cfg:table:add") {
      await handleAddTable(ctx);
      await ctx.answerCallbackQuery();
      return;
    }

    if (data === "cfg:table:skip_label") {
      const seats = s.configEditingTableSeats;
      if (seats === undefined) {
        await ctx.answerCallbackQuery({ text: "Session expired." });
        return;
      }

      const table = await addTable(seats);
      if (!table) {
        await ctx.editMessageText("Failed to add table. Please try again.");
        await ctx.answerCallbackQuery();
        return;
      }

      resetConfigSession(ctx);
      await ctx.editMessageText(
        `Table "${table.label ?? table.id}" added with ${table.seats} seats.`
      );
      await ctx.answerCallbackQuery({ text: "Table added" });
      await showConfigMenu(ctx);
      return;
    }

    if (data.startsWith("cfg:table:edit_seats:")) {
      const tableId = data.slice("cfg:table:edit_seats:".length);
      await handleEditTableSeats(ctx, tableId);
      await ctx.answerCallbackQuery();
      return;
    }

    if (data.startsWith("cfg:table:edit_label:")) {
      const tableId = data.slice("cfg:table:edit_label:".length);
      await handleEditTableLabel(ctx, tableId);
      await ctx.answerCallbackQuery();
      return;
    }

    if (data.startsWith("cfg:table:edit:")) {
      const tableId = data.slice("cfg:table:edit:".length);
      await handleEditTable(ctx, tableId);
      await ctx.answerCallbackQuery();
      return;
    }

    if (data.startsWith("cfg:table:delete:")) {
      const tableId = data.slice("cfg:table:delete:".length);
      await handleDeleteTable(ctx, tableId);
      await ctx.answerCallbackQuery();
      return;
    }

    if (data.startsWith("cfg:table:delete_confirm:")) {
      const tableId = data.slice("cfg:table:delete_confirm:".length);
      await handleDeleteTableConfirm(ctx, tableId);
      return;
    }

    if (data.startsWith("cfg:custom:")) {
      const target = data.slice("cfg:custom:".length);

      if (target === "opening_hour") {
        s.configStep = "opening_hour";
        await ctx.editMessageText("Type the opening hour (0–23):");
        await ctx.answerCallbackQuery();
        return;
      }

      if (target === "closing_hour") {
        s.configStep = "closing_hour";
        await ctx.editMessageText("Type the closing hour (0–23):");
        await ctx.answerCallbackQuery();
        return;
      }

      if (target === "opening_minute") {
        s.configStep = "opening_minute";
        await ctx.editMessageText("Type the opening minute (0–59):");
        await ctx.answerCallbackQuery();
        return;
      }

      if (target === "closing_minute") {
        s.configStep = "closing_minute";
        await ctx.editMessageText("Type the closing minute (0–59):");
        await ctx.answerCallbackQuery();
        return;
      }

      await ctx.answerCallbackQuery();
      return;
    }

    if (data.startsWith("cfg:set:hour:")) {
      const [, , , prefix, value] = data.split(":");
      if (prefix && value) {
        await handleSetHour(ctx, prefix, value);
      } else {
        await ctx.answerCallbackQuery();
      }
      return;
    }

    if (data.startsWith("cfg:set:minute:")) {
      const [, , , prefix, value] = data.split(":");
      if (prefix && value) {
        await handleSetMinute(ctx, prefix, value);
      } else {
        await ctx.answerCallbackQuery();
      }
      return;
    }

    if (data.startsWith("cfg:set:sitting:")) {
      const value = data.slice("cfg:set:sitting:".length);
      await handleSetSitting(ctx, value);
      return;
    }

    if (data.startsWith("cfg:set:granularity:")) {
      const value = data.slice("cfg:set:granularity:".length);
      await handleSetGranularity(ctx, value);
      return;
    }

    await ctx.answerCallbackQuery();
  });
}

export { isAdmin } from "./auth.js";
