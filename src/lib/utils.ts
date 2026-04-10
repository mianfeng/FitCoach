import clsx, { type ClassValue } from "clsx";

const BEIJING_TIME_ZONE = "Asia/Shanghai";

function parseIsoDateParts(date: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) {
    throw new Error(`Invalid ISO date: ${date}`);
  }

  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function formatUtcDate(date: Date) {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

export function roundToIncrement(value: number, increment = 2.5) {
  if (!increment) {
    return Math.round(value);
  }

  return Math.round(value / increment) * increment;
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function isoToday() {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: BEIJING_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) {
    throw new Error("Failed to resolve Beijing date");
  }

  return `${year}-${month}-${day}`;
}

export function formatDateLabel(date: string) {
  const { month, day } = parseIsoDateParts(date);
  return `${String(month).padStart(2, "0")}.${String(day).padStart(2, "0")}`;
}

export function shiftIsoDate(date: string, offsetDays: number) {
  const { year, month, day } = parseIsoDateParts(date);
  const next = new Date(Date.UTC(year, month - 1, day + offsetDays));
  return formatUtcDate(next);
}

export function diffIsoDays(leftDate: string, rightDate: string) {
  const left = parseIsoDateParts(leftDate);
  const right = parseIsoDateParts(rightDate);
  const leftUtc = Date.UTC(left.year, left.month - 1, left.day);
  const rightUtc = Date.UTC(right.year, right.month - 1, right.day);
  return Math.round((leftUtc - rightUtc) / 86_400_000);
}

export function uid(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export function average(values: number[]) {
  if (!values.length) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function normalizeText(input: string) {
  return input
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function segmentWords(input: string) {
  const normalized = normalizeText(input);
  if (!normalized) {
    return [];
  }

  if ("Segmenter" in Intl) {
    const segmenter = new Intl.Segmenter("zh-CN", { granularity: "word" });
    return Array.from(segmenter.segment(normalized))
      .map((item) => item.segment.trim())
      .filter((item) => item.length > 0 && !/^\s+$/.test(item));
  }

  return normalized.split(" ");
}
