const LOOKAHEAD_DAYS = 180;
const WEEKDAY_LABELS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

export function startOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return startOfDay(next);
}

export function formatIsoDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseMonthKey(monthKey: string): { year: number; month: number } {
  const [year, month] = monthKey.split("-").map(Number);
  return { year, month: month - 1 };
}

export function monthKey(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

export function isSelectableDate(date: Date, today: Date): boolean {
  const normalized = startOfDay(date);
  const lastDay = addDays(today, LOOKAHEAD_DAYS);
  return normalized >= today && normalized <= lastDay;
}

export function buildCalendarKeyboard(
  year: number,
  month: number,
  today: Date
): { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } {
  const firstOfMonth = new Date(Date.UTC(year, month, 1));
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const startWeekday = (firstOfMonth.getUTCDay() + 6) % 7;

  const rows: Array<Array<{ text: string; callback_data: string }>> = [
    WEEKDAY_LABELS.map((label) => ({ text: label, callback_data: "cal:noop" })),
  ];

  let week: Array<{ text: string; callback_data: string }> = [];

  for (let i = 0; i < startWeekday; i++) {
    week.push({ text: " ", callback_data: "cal:noop" });
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(Date.UTC(year, month, day));
    const iso = formatIsoDate(date);

    if (isSelectableDate(date, today)) {
      week.push({ text: String(day), callback_data: `cal:date:${iso}` });
    } else {
      week.push({ text: "·", callback_data: "cal:noop" });
    }

    if (week.length === 7) {
      rows.push(week);
      week = [];
    }
  }

  if (week.length > 0) {
    while (week.length < 7) {
      week.push({ text: " ", callback_data: "cal:noop" });
    }
    rows.push(week);
  }

  const prevMonth = month === 0 ? { year: year - 1, month: 11 } : { year, month: month - 1 };
  const nextMonth = month === 11 ? { year: year + 1, month: 0 } : { year, month: month + 1 };

  const monthLabel = firstOfMonth.toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  rows.unshift([{ text: monthLabel, callback_data: "cal:noop" }]);
  rows.push([
    { text: "« Prev", callback_data: `cal:prev:${monthKey(prevMonth.year, prevMonth.month)}` },
    { text: "Next »", callback_data: `cal:next:${monthKey(nextMonth.year, nextMonth.month)}` },
  ]);

  return { inline_keyboard: rows };
}

export function formatSelectedDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}