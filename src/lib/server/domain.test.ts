import { describe, expect, it } from "vitest";

import { defaultPlan, defaultProfile, defaultTemplates } from "@/lib/seed";
import { buildDailyBrief, buildNextDayDecision, buildSessionSummary, getNextScheduledDay } from "@/lib/server/domain";
import type { SessionReport } from "@/lib/types";

describe("training scheduler", () => {
  it("starts from day A when there is no history", () => {
    expect(getNextScheduledDay(defaultPlan, [])).toBe("A");
  });

  it("does not advance after an incomplete draft", () => {
    const reports: SessionReport[] = [
      {
        id: "draft-1",
        reportVersion: 2,
        date: "2026-03-12",
        performedDay: "A",
        exerciseResults: [],
        bodyWeightKg: 60,
        sleepHours: 7.5,
        dietAdherence: 4,
        fatigue: 5,
        completed: false,
        createdAt: "2026-03-12T10:00:00.000Z",
      },
    ];

    expect(getNextScheduledDay(defaultPlan, reports)).toBe("A");
  });

  it("advances to the next day after a completed session", () => {
    const reports: SessionReport[] = [
      {
        id: "r1",
        reportVersion: 2,
        date: "2026-03-12",
        performedDay: "A",
        exerciseResults: [],
        bodyWeightKg: 60,
        sleepHours: 7.5,
        dietAdherence: 4,
        fatigue: 5,
        completed: true,
        createdAt: "2026-03-12T10:00:00.000Z",
      },
    ];

    expect(getNextScheduledDay(defaultPlan, reports)).toBe("B");
  });
});

describe("daily brief", () => {
  it("builds a training prescription and meal card", () => {
    const result = buildDailyBrief(
      {
        date: "2026-03-12",
        userQuestion: "今天怎么练怎么吃",
      },
      defaultProfile,
      defaultPlan,
      defaultTemplates,
      [],
      null,
    );

    expect(result.reused).toBe(false);
    expect(result.brief.scheduledDay).toBe("A");
    expect(result.brief.calendarSlot).toBe("A");
    expect(result.brief.isRestDay).toBe(false);
    expect(result.brief.workoutPrescription.exercises.length).toBeGreaterThan(0);
    expect(result.brief.mealPrescription.macros.carbsG).toBeGreaterThan(0);
  });
});

describe("adjustment proposal", () => {
  it("suggests deload after sustained high fatigue", () => {
    const report = {
      id: "r-new",
      reportVersion: 2 as const,
      date: "2026-03-12",
      performedDay: "C" as const,
      exerciseResults: [
        {
          exerciseName: "哈克深蹲",
          targetSets: 5,
          targetReps: "10",
          actualSets: 5,
          actualReps: "10",
          topSetWeightKg: 55,
          rpe: 9.5,
          droppedSets: true,
        },
      ],
      bodyWeightKg: 60,
      sleepHours: 5.5,
      dietAdherence: 3 as const,
      fatigue: 9,
      trainingReportText: "",
      completed: true,
      createdAt: "2026-03-12T10:00:00.000Z",
    };

    const history: SessionReport[] = [
      {
        ...report,
        id: "r-1",
        date: "2026-03-11",
        performedDay: "B",
        createdAt: "2026-03-11T10:00:00.000Z",
      },
      {
        ...report,
        id: "r-2",
        date: "2026-03-10",
        performedDay: "A",
        createdAt: "2026-03-10T10:00:00.000Z",
      },
    ];

    const result = buildSessionSummary(report, history, defaultPlan);
    expect(result.proposals.some((proposal) => proposal.triggerReason.includes("高疲劳"))).toBe(true);
  });

  it("builds a deload next-day decision under high stress", () => {
    const report: SessionReport = {
      id: "r-deload",
      reportVersion: 2,
      date: "2026-03-13",
      performedDay: "B",
      exerciseResults: [
        {
          exerciseName: "杠铃卧推",
          performed: true,
          targetSets: 5,
          targetReps: "10",
          actualSets: 5,
          actualReps: "10",
          topSetWeightKg: 32.5,
          rpe: 9.4,
          droppedSets: true,
        },
      ],
      bodyWeightKg: 60,
      sleepHours: 5,
      fatigue: 9,
      mealLog: {
        breakfast: { content: "鸡蛋 牛奶", adherence: "on_plan" },
        lunch: { content: "", adherence: "missed" },
        dinner: { content: "米饭 瘦肉", adherence: "adjusted", deviationNote: "吃晚了" },
        preWorkout: { content: "", adherence: "missed" },
        postWorkout: { content: "香蕉 牛奶", adherence: "adjusted" },
        postWorkoutSource: "dedicated",
      },
      trainingReportText: "最后两组明显掉速。",
      completed: true,
      createdAt: "2026-03-13T10:00:00.000Z",
    };

    const decision = buildNextDayDecision(report, defaultPlan);
    expect(decision.trainingReadiness).toBe("deload");
    expect(decision.nutritionFocus).toContain("补齐");
  });
});
