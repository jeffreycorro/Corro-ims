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
