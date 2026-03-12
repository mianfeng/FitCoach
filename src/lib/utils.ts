import { format } from "date-fns";
import clsx, { type ClassValue } from "clsx";

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
  return format(new Date(), "yyyy-MM-dd");
}

export function formatDateLabel(date: string) {
  return format(new Date(date), "MM.dd");
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
