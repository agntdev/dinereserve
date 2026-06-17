const SLOTS_PER_PAGE = 8;

export function buildSlotKeyboard(
  slots: string[],
  page: number
): { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } {
  const totalPages = Math.max(1, Math.ceil(slots.length / SLOTS_PER_PAGE));
  const safePage = Math.min(Math.max(page, 0), totalPages - 1);
  const pageSlots = slots.slice(
    safePage * SLOTS_PER_PAGE,
    safePage * SLOTS_PER_PAGE + SLOTS_PER_PAGE
  );

  const rows: Array<Array<{ text: string; callback_data: string }>> = [];

  for (let index = 0; index < pageSlots.length; index += 4) {
    rows.push(
      pageSlots.slice(index, index + 4).map((time) => ({
        text: time,
        callback_data: `slot:${time}`,
      }))
    );
  }

  const navigation: Array<{ text: string; callback_data: string }> = [];
  if (safePage > 0) {
    navigation.push({
      text: "« Prev",
      callback_data: `slotpage:${safePage - 1}`,
    });
  }
  if (safePage < totalPages - 1) {
    navigation.push({
      text: "Next »",
      callback_data: `slotpage:${safePage + 1}`,
    });
  }

  if (navigation.length > 0) {
    rows.push(navigation);
  }

  return { inline_keyboard: rows };
}

export function formatSlotSelection(
  slot: string,
  partySize: number,
  tableSummary: string
): string {
  return `Selected ${slot} for ${partySize} guests.\nTables: ${tableSummary}`;
}