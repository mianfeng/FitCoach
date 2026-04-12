import { describe, expect, it } from "vitest";

import { buildCalendarEntries, materializePlanCalendar } from "@/lib/plan-calendar";
import { normalizePlanSetupInput } from "@/lib/plan-generator";
import { buildDefaultPlanSetup } from "@/lib/seed";
import type { TrainingReschedule } from "@/lib/types";

describe("plan calendar materialization", () => {
  it("initializes baseCalendarEntries together with calendarEntries", () => {
    const setup = buildDefaultPlanSetup();

    expect(setup.plan.baseCalendarEntries).toEqual(setup.plan.calendarEntries);
  });

  it("postpones a training day and shifts the occupied target day forward", () => {
    const baseCalendarEntries = buildCalendarEntries("2026-03-12", 1);
    const reschedules: TrainingReschedule[] = [
      {
        id: "reschedule-1",
        sourceDate: "2026-03-12",
        targetDate: "2026-03-14",
        sourceDay: "A",
        sourceLabel: "W1D1A",
        action: "postpone",
        createdAt: "2026-03-12T10:00:00.000Z",
      },
    ];

    const materialized = materializePlanCalendar(baseCalendarEntries, reschedules);

    expect(materialized.slice(0, 6).map((entry) => `${entry.date}:${entry.slot}`)).toEqual([
      "2026-03-12:rest",
      "2026-03-13:B",
      "2026-03-14:A",
      "2026-03-15:C",
      "2026-03-16:rest",
      "2026-03-17:A",
    ]);
  });

  it("brings a missed training day to today and shifts today's original slot forward", () => {
    const baseCalendarEntries = buildCalendarEntries("2026-03-12", 1);
    const reschedules: TrainingReschedule[] = [
      {
        id: "reschedule-1",
        sourceDate: "2026-03-13",
        targetDate: "2026-03-16",
        sourceDay: "B",
        sourceLabel: "W1D2B",
        action: "postpone",
        createdAt: "2026-03-13T10:00:00.000Z",
      },
    ];

    const materialized = materializePlanCalendar(baseCalendarEntries, reschedules);

    expect(materialized.slice(0, 7).map((entry) => `${entry.date}:${entry.slot}`)).toEqual([
      "2026-03-12:A",
      "2026-03-13:rest",
      "2026-03-14:C",
      "2026-03-15:rest",
      "2026-03-16:B",
      "2026-03-17:A",
      "2026-03-18:B",
    ]);
  });

  it("replays all active reschedules from the base calendar when updating or deleting one", () => {
    const baseCalendarEntries = buildCalendarEntries("2026-03-12", 1);
    const reschedules: TrainingReschedule[] = [
      {
        id: "reschedule-1",
        sourceDate: "2026-03-12",
        targetDate: "2026-03-14",
        sourceDay: "A",
        sourceLabel: "W1D1A",
        action: "postpone",
        createdAt: "2026-03-12T10:00:00.000Z",
      },
      {
        id: "reschedule-2",
        sourceDate: "2026-03-14",
        targetDate: "2026-03-16",
        sourceDay: "A",
        sourceLabel: "W1D3A",
        action: "postpone",
        createdAt: "2026-03-13T10:00:00.000Z",
      },
    ];

    const withBoth = materializePlanCalendar(baseCalendarEntries, reschedules);
    const withoutSecond = materializePlanCalendar(baseCalendarEntries, [reschedules[0]!]);

    expect(withBoth.slice(0, 7).map((entry) => `${entry.date}:${entry.slot}`)).toEqual([
      "2026-03-12:rest",
      "2026-03-13:B",
      "2026-03-14:rest",
      "2026-03-15:C",
      "2026-03-16:A",
      "2026-03-17:rest",
      "2026-03-18:A",
    ]);
    expect(withoutSecond.slice(0, 6).map((entry) => `${entry.date}:${entry.slot}`)).toEqual([
      "2026-03-12:rest",
      "2026-03-13:B",
      "2026-03-14:A",
      "2026-03-15:C",
      "2026-03-16:rest",
      "2026-03-17:A",
    ]);
  });

  it("keeps the base calendar intact while preserving a materialized official calendar", () => {
    const setup = buildDefaultPlanSetup();
    const reschedules: TrainingReschedule[] = [
      {
        id: "reschedule-1",
        sourceDate: setup.plan.baseCalendarEntries[0]!.date,
        targetDate: setup.plan.baseCalendarEntries[2]!.date,
        sourceDay: "A",
        sourceLabel: setup.plan.baseCalendarEntries[0]!.label,
        action: "postpone",
        createdAt: "2026-03-12T10:00:00.000Z",
      },
    ];
    const materialized = materializePlanCalendar(setup.plan.baseCalendarEntries, reschedules);

    const normalized = normalizePlanSetupInput({
      ...setup,
      plan: {
        ...setup.plan,
        calendarEntries: materialized,
      },
    });

    expect(normalized.plan.baseCalendarEntries.map((entry) => `${entry.date}:${entry.slot}`)).toEqual(
      setup.plan.baseCalendarEntries.map((entry) => `${entry.date}:${entry.slot}`),
    );
    expect(normalized.plan.calendarEntries.map((entry) => `${entry.date}:${entry.slot}`)).toEqual(
      materialized.map((entry) => `${entry.date}:${entry.slot}`),
    );
  });
});
