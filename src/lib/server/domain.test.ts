import { describe, expect, it } from "vitest";

import { addDays } from "date-fns";

import { defaultPlan, defaultProfile, defaultTemplates } from "@/lib/seed";
import {
  buildChatContextBundle,
  buildDailyBrief,
  buildNextDayDecision,
  buildSessionSummary,
  buildStrictDailyReviewMarkdown,
  getNextScheduledDay,
} from "@/lib/server/domain";
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

  it("uses 253 meal split on rest days", () => {
    const plan = {
      ...defaultPlan,
      startDate: "2026-03-12",
      calendarEntries: [],
    };
    const result = buildDailyBrief(
      {
        date: addDays(new Date("2026-03-12"), 3).toISOString().slice(0, 10),
        userQuestion: "休息日怎么吃",
      },
      defaultProfile,
      plan,
      defaultTemplates,
      [],
      null,
    );

    expect(result.brief.isRestDay).toBe(true);
    expect(result.brief.mealPrescription.meals.map((meal) => `${meal.label}:${meal.sharePercent}`)).toEqual([
      "早餐:20",
      "午餐:50",
      "晚餐:30",
    ]);
  });

  it("does not reuse a brief from an older plan revision", () => {
    const plan = {
      ...defaultPlan,
      startDate: "2026-03-12",
      planRevisionId: "planrev-new",
      calendarEntries: [],
    };
    const existing = {
      id: "brief-old",
      date: "2026-03-12",
      scheduledDay: "A" as const,
      calendarLabel: "W1D1A",
      calendarSlot: "A" as const,
      isRestDay: false,
      workoutPrescription: {
        dayCode: "A" as const,
        title: "旧计划",
        objective: "旧目标",
        warmup: [],
        exercises: [],
        caution: [],
      },
      mealPrescription: {
        dayType: "training" as const,
        macros: { proteinG: 100, carbsG: 200, fatsG: 50 },
        meals: [],
        guidance: [],
      },
      reasoningSummary: [],
      sourceSnapshotId: "snapshot-old",
      userQuestion: "今天怎么练",
      createdAt: "2026-03-12T10:00:00.000Z",
      planRevisionId: "planrev-old",
    };

    const result = buildDailyBrief(
      {
        date: "2026-03-12",
        userQuestion: "今天怎么练",
      },
      defaultProfile,
      plan,
      defaultTemplates,
      [],
      existing,
    );

    expect(result.reused).toBe(false);
    expect(result.brief.planRevisionId).toBe("planrev-new");
    expect(result.brief.workoutPrescription.title).not.toBe("旧计划");
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

describe("daily review presentation", () => {
  it("builds the strict four-section review format", () => {
    const report: SessionReport = {
      id: "review-1",
      reportVersion: 2,
      date: "2026-03-13",
      performedDay: "rest",
      exerciseResults: [],
      bodyWeightKg: 61,
      sleepHours: 7,
      fatigue: 1,
      mealLog: {
        breakfast: { content: "鸡蛋 牛奶 面包", adherence: "on_plan" },
        lunch: { content: "米饭 鸡胸", adherence: "adjusted", deviationNote: "外食偏油" },
        dinner: { content: "", adherence: "missed" },
        preWorkout: { content: "", adherence: "missed" },
        postWorkout: { content: "", adherence: "missed" },
        postWorkoutSource: "dedicated",
      },
      completed: true,
      nextDayDecision: {
        trainingReadiness: "push",
        nutritionFocus: "先补齐缺失餐次，再看总蛋白和碳水。",
        recoveryFocus: "保持睡眠和补水。",
        priorityNotes: ["先把餐次完整性拉回来"],
      },
      createdAt: "2026-03-13T10:00:00.000Z",
    };

    const review = buildStrictDailyReviewMarkdown({
      report,
      targetMacros: { proteinG: 108, carbsG: 180, fatsG: 54 },
      nextDayDecision: report.nextDayDecision,
    });

    expect(review).toContain("1. 📊 数据核算");
    expect(review).toContain("2. 🏋️ 训练评估");
    expect(review).toContain("3. 🎯 质量评级");
    expect(review).toContain("4. ⚡ 行动建议");
    expect(review).toContain("估算摄入");
    expect(review).toContain("缺口分析");
  });

  it("does not escalate isolated nutrition drift to disaster", () => {
    const report: SessionReport = {
      id: "review-2",
      reportVersion: 2,
      date: "2026-03-14",
      performedDay: "B",
      exerciseResults: [
        {
          exerciseName: "杠铃卧推",
          performed: true,
          targetSets: 5,
          targetReps: "10",
          actualSets: 5,
          actualReps: "10",
          topSetWeightKg: 30,
          rpe: 8.4,
          droppedSets: false,
        },
      ],
      bodyWeightKg: 61,
      sleepHours: 7.5,
      fatigue: 5,
      mealLog: {
        breakfast: { content: "鸡蛋 牛奶 面包", adherence: "on_plan" },
        lunch: { content: "米饭 鸡胸", adherence: "on_plan" },
        dinner: { content: "米饭 牛肉", adherence: "adjusted" },
        preWorkout: { content: "香蕉", adherence: "on_plan" },
        postWorkout: { content: "牛奶", adherence: "on_plan" },
        postWorkoutSource: "dedicated",
      },
      nutritionTotals: {
        calories: 1800,
        proteinG: 100,
        carbsG: 181,
        fatsG: 54,
      },
      nutritionGap: {
        calories: -242,
        proteinG: -8,
        carbsG: 1,
        fatsG: 0,
      },
      nutritionComputation: {
        status: "ready",
        source: "hybrid",
        computedAt: "2026-03-14T10:00:00.000Z",
      },
      completed: true,
      nextDayDecision: {
        trainingReadiness: "push",
        nutritionFocus: "晚餐补一点主食就够。",
        recoveryFocus: "保持睡眠。",
        priorityNotes: ["别把轻微偏差放大"],
      },
      createdAt: "2026-03-14T10:00:00.000Z",
    };

    const review = buildStrictDailyReviewMarkdown({
      report,
      targetMacros: { proteinG: 108, carbsG: 180, fatsG: 54 },
      nextDayDecision: report.nextDayDecision,
    });

    expect(review).not.toContain("🔴 灾难");
  });
});

describe("chat context bundle", () => {
  it("includes latest report detail and date information for coach analysis", () => {
    const report: SessionReport = {
      id: "chat-1",
      reportVersion: 2,
      date: "2026-03-13",
      performedDay: "rest",
      exerciseResults: [],
      bodyWeightKg: 61,
      sleepHours: 7,
      fatigue: 1,
      mealLog: {
        breakfast: { content: "鸡蛋 牛奶 面包", adherence: "on_plan" },
        lunch: { content: "米饭 鸡胸", adherence: "adjusted", deviationNote: "外食偏油" },
        dinner: { content: "", adherence: "missed" },
        preWorkout: { content: "", adherence: "missed" },
        postWorkout: { content: "", adherence: "missed" },
        postWorkoutSource: "dedicated",
      },
      trainingReportText: "今天只回填了早餐和午餐。",
      completed: true,
      createdAt: "2026-03-13T10:00:00.000Z",
    };

    const bundle = buildChatContextBundle({
      persona: {
        id: "coach",
        name: "Coach",
        voice: "direct",
        mission: "keep the user progressing",
        corePrinciples: [],
      },
      plan: defaultPlan,
      reports: [report],
      retrievedKnowledge: [],
      messages: [],
    });

    expect(bundle.latestReportSummary).toContain("体重 61 kg");
    expect(bundle.latestReportSummary).toContain("饮食记录");
    expect(bundle.recentReportSummary).toContain("最新记录");
    expect(bundle.latestReportDate).toBe("2026-03-13");
  });
});
