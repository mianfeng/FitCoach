import { afterEach, describe, expect, it, vi } from "vitest";

import { diffIsoDays, formatDateLabel, isoToday, shiftIsoDate } from "@/lib/utils";

describe("date utilities", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses Asia/Shanghai when resolving today", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-10T16:30:00.000Z"));

    expect(isoToday()).toBe("2026-04-11");
  });

  it("shifts ISO dates without timezone drift", () => {
    expect(shiftIsoDate("2026-04-11", 1)).toBe("2026-04-12");
    expect(shiftIsoDate("2026-04-11", -1)).toBe("2026-04-10");
    expect(shiftIsoDate("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("computes day differences from ISO dates directly", () => {
    expect(diffIsoDays("2026-04-11", "2026-04-09")).toBe(2);
    expect(diffIsoDays("2026-04-09", "2026-04-11")).toBe(-2);
  });

  it("formats date labels from ISO strings directly", () => {
    expect(formatDateLabel("2026-04-11")).toBe("04.11");
  });
});
