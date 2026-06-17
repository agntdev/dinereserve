import type { Context } from "grammy";
import type { SessionFlavor } from "grammy";
import { createBot } from "./toolkit/index.js";
import type { BookingRow } from "./db/types.js";
import { listOverlapping, getRestaurantConfig } from "./db/repository.js";
import { calculateAvailability, generateSlotsForDate, type TimeSlot } from "./availability/slots.js";
import { DEFAULT_RESTAURANT_CONFIG } from "./config.js";
import { persistBooking } from "./booking.js";

export interface Session {
  step?: "awaiting_date" | "awaiting_party_size" | "awaiting_slot";
  reservationDate?: string;
  partySize?: number;
}

type MyContext = Context & SessionFlavor<Session>;

export function buildBot(token: string) {
  const bot = createBot<Session>(token, {
    initial: () => ({}),
  });

  bot.command("start", async (ctx) => {
    await ctx.reply("Welcome! I am ready to help.");
  });

  bot.command("reserve", async (ctx) => {
    ctx.session.step = "awaiting_date";
    ctx.session.reservationDate = undefined;
    ctx.session.partySize = undefined;
    await ctx.reply(
      "I'll help you book a table. Please enter the date you'd like to reserve (YYYY-MM-DD format, e.g. 2026-06-20):"
    );
  });

  bot.on("message:text", async (ctx) => {
    const step = ctx.session.step;
    if (!step) return;

    if (step === "awaiting_date") {
      const dateText = ctx.message.text.trim();
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(dateText)) {
        await ctx.reply("Please enter a valid date in YYYY-MM-DD format (e.g. 2026-06-20):");
        return;
      }

      const inputDate = new Date(dateText + "T00:00:00Z");
      if (isNaN(inputDate.getTime())) {
        await ctx.reply("That doesn't look like a valid date. Please try again (YYYY-MM-DD):");
        return;
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (inputDate < today) {
        await ctx.reply("You can't book in the past. Please enter a future date (YYYY-MM-DD):");
        return;
      }

      ctx.session.reservationDate = dateText;
      ctx.session.step = "awaiting_party_size";
      await ctx.reply("How many people? Please enter the party size (e.g. 2):");
      return;
    }

    if (step === "awaiting_party_size") {
      const sizeText = ctx.message.text.trim();
      const size = parseInt(sizeText, 10);

      if (isNaN(size) || size < 1 || size > 20) {
        await ctx.reply("Please enter a valid party size between 1 and 20:");
        return;
      }

      ctx.session.partySize = size;
      ctx.session.step = "awaiting_slot";

      const slots = await showAvailabilityForParty(
        size,
        ctx.session.reservationDate!
      );

      if (slots.length === 0) {
        await ctx.reply(
          `No available slots for ${size} people on ${ctx.session.reservationDate}. ` +
            "Try a different date or party size. Send a date to try again (YYYY-MM-DD)."
        );
        ctx.session.step = "awaiting_date";
        ctx.session.reservationDate = undefined;
        ctx.session.partySize = undefined;
        return;
      }

      const slotList = slots
        .map((s, i) => `${i + 1}. ${s.start}–${s.end} (${s.capacity} seats left)`)
        .join("\n");

      await ctx.reply(
        `Available slots for ${size} people on ${ctx.session.reservationDate}:\n\n${slotList}\n\nPlease reply with the slot number to confirm (e.g. 1).`
      );
      return;
    }

    if (step === "awaiting_slot") {
      const choiceText = ctx.message.text.trim();
      const choice = parseInt(choiceText, 10);

      const slots = await showAvailabilityForParty(
        ctx.session.partySize!,
        ctx.session.reservationDate!
      );

      if (isNaN(choice) || choice < 1 || choice > slots.length) {
        await ctx.reply(`Please enter a valid slot number between 1 and ${slots.length}:`);
        return;
      }

      const selected = slots[choice - 1];
      if (!selected.available || selected.capacity < ctx.session.partySize!) {
        await ctx.reply(
          "That slot is no longer available. Let me show you the current availability."
        );
        return await handleSlotSelection(ctx as MyContext);
      }

      const userId = ctx.from?.id ?? 0;
      const guestName =
        [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(" ") ||
        `User ${userId}`;

      const result = await persistBooking({
        user_id: userId,
        guest_name: guestName,
        party_size: ctx.session.partySize!,
        iso_date: ctx.session.reservationDate!,
        slot_start: selected.start,
        slot_end: selected.end,
        status: "confirmed",
      });

      if (result.success) {
        await ctx.reply(
          `Booking confirmed! Your reference code is ${result.ref_code}. ` +
            `${ctx.session.partySize} people on ${ctx.session.reservationDate} at ${selected.start}–${selected.end}.`
        );
      } else {
        await ctx.reply(
          `Sorry, we couldn't complete your booking at this time. Please try again.`
        );
      }

      ctx.session.step = undefined;
      ctx.session.reservationDate = undefined;
      ctx.session.partySize = undefined;
      return;
    }
  });

  return bot;
}

async function handleSlotSelection(ctx: MyContext): Promise<void> {
  const slots = await showAvailabilityForParty(
    ctx.session.partySize!,
    ctx.session.reservationDate!
  );

  if (slots.length === 0) {
    await ctx.reply(
      "No slots available now. Please send a new date to try again (YYYY-MM-DD)."
    );
    ctx.session.step = "awaiting_date";
    ctx.session.reservationDate = undefined;
    ctx.session.partySize = undefined;
    return;
  }

  const slotList = slots
    .map((s, i) => `${i + 1}. ${s.start}–${s.end} (${s.capacity} seats left)`)
    .join("\n");

  await ctx.reply(
    `Updated availability for ${ctx.session.partySize} people on ${ctx.session.reservationDate}:\n\n${slotList}\n\nReply with the slot number:`
  );
}

async function showAvailabilityForParty(
  partySize: number,
  reservationDate: string,
): Promise<TimeSlot[]> {
  const config = await getRestaurantConfig();
  const allSlots = generateSlotsForDate(reservationDate, config ?? DEFAULT_RESTAURANT_CONFIG);

  let overlapping: BookingRow[];
  try {
    overlapping = await listOverlapping(
      reservationDate,
      allSlots[0]?.start ?? "00:00",
      allSlots[allSlots.length - 1]?.end ?? "23:59",
    );
  } catch {
    overlapping = [];
  }

  return calculateAvailability(partySize, overlapping, {
    isoDate: reservationDate,
  }, config ?? DEFAULT_RESTAURANT_CONFIG);
}
