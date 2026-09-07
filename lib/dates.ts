const MANILA = "Asia/Manila";

const dateTime = new Intl.DateTimeFormat("en-PH", {
  timeZone: MANILA,
  dateStyle: "medium",
  timeStyle: "short",
});

const dateOnly = new Intl.DateTimeFormat("en-PH", {
  timeZone: MANILA,
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

const timeOnly = new Intl.DateTimeFormat("en-PH", {
  timeZone: MANILA,
  hour: "numeric",
  minute: "2-digit",
});

export function formatManilaDateTime(value: Date = new Date()): string {
  return dateTime.format(value);
}

export function formatManilaDate(value: Date = new Date()): string {
  return dateOnly.format(value);
}

export function formatManilaTime(value: Date = new Date()): string {
  return timeOnly.format(value);
}

function part(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((item) => item.type === type)?.value ?? "";
}

/** Calendar date in Asia/Manila as YYYY-MM-DD. Never use Date#toISOString for this. */
export function manilaTodayYmd(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: MANILA,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  return `${part(parts, "year")}-${part(parts, "month")}-${part(parts, "day")}`;
}

/**
 * Format a stored calendar date (YYYY-MM-DD) without converting through UTC.
 * ISO timestamps are sliced to the date portion only; time-of-day is ignored.
 */
export function formatCalendarDate(value: string | null | undefined): string {
  if (!value) return "—";
  const ymd = value.slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!match) return value;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return new Intl.DateTimeFormat("en-PH", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(year, month - 1, day));
}

export function parseCalendarDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const ymd = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? ymd : null;
}
