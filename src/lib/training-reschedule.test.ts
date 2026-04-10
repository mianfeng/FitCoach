import { describe, expect, it } from "vitest";

import { defaultPlan } from "@/lib/seed";
import { findReportForDate, getCompletedScheduledDateSet, listMissedTrainingEntries } from "@/lib/training-reschedule";
import type { LongTermPlan, SessionReport, TrainingReschedule } from "@/lib/types";

describe("training reschedule helpers", () => {
  it("matches reports by scheduledDate when viewing the original plan day", () => {
    const reports: SessionReport[] = [
      {
        id: "report-1",
        reportVersion: 2,
        date: "2026-03-15",
        scheduledDate: "2026-03-12",
        performedDay: "A",
        exerciseResults: [],
        bodyWeightKg: 60,
        sleepHours: 7,
        fatigue: 4,
        completed: true,
        createdAt: "2026-03-15T10:00:00.000Z",
      },
    ];

    expect(findReportForDate(reports, "2026-03-12")?.id).toBe("report-1");
    expect(Array.from(getCompletedScheduledDateSet(reports))).toEqual(["2026-03-12"]);
  });

  it("lists only unresolved past training days as missed candidates", () => {
    const plan: LongTermPlan = {
      ...defaultPlan,
      startDate: "2026-03-12",
      calendarEntries: [
        { date: "2026-03-12", week: 1, dayIndex: 1, slot: "A", label: "W1D1A" },
        { date: "2026-03-13", week: 1, dayIndex: 2, slot: "B", label: "W1D2B" },
        { date: "2026-03-14", week: 1, dayIndex: 3, slot: "C", label: "W1D3C" },
        { date: "2026-03-15", week: 1, dayIndex: 4, slot: "rest", label: "W1D4休" },
      ],
    };
    const reports: SessionReport[] = [
      {
        id: "report-done",
        reportVersion: 2,
        date: "2026-03-12",
        scheduledDate: "2026-03-12",
        performedDay: "A",
        exerciseResults: [],
        bodyWeightKg: 60,
        sleepHours: 7,
        fatigue: 4,
        completed: true,
        createdAt: "2026-03-12T10:00:00.000Z",
      },
    ];
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

    const candidates = listMissedTrainingEntries({
      plan,
      reports,
      reschedules,
      today: "2026-03-15",
    });

    expect(candidates.map((item) => item.date)).toEqual(["2026-03-14"]);
  });
});
