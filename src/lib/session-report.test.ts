import { describe, expect, it } from "vitest";

import { normalizeMealLog, normalizeStoredSessionReport } from "@/lib/session-report";
import { sessionReportSchema } from "@/lib/validations";

describe("session report compatibility", () => {
  it("normalizes legacy meal log strings into structured entries", () => {
    const mealLog = normalizeMealLog({
      breakfast: "鸡蛋 牛奶",
      lunch: "米饭 鸡胸",
      dinner: "",
      preWorkout: "香蕉 面包",
      postWorkout: "蛋白粉",
      postWorkoutSource: "dedicated",
    });

    expect(mealLog?.breakfast.content).toBe("鸡蛋 牛奶");
    expect(mealLog?.breakfast.adherence).toBe("adjusted");
    expect(mealLog?.dinner.adherence).toBe("missed");
  });

  it("accepts a v2 structured payload", () => {
    const parsed = sessionReportSchema.parse({
      reportVersion: 2,
      date: "2026-03-13",
      performedDay: "A",
      exerciseResults: [
        {
          exerciseName: "杠铃卧推",
          targetSets: 5,
          targetReps: "10",
          actualSets: 5,
          actualReps: "10",
          topSetWeightKg: 32.5,
          rpe: 8.5,
          droppedSets: false,
        },
      ],
      bodyWeightKg: 60,
      sleepHours: 7,
      fatigue: 5,
      mealLog: {
        breakfast: { content: "鸡蛋", adherence: "on_plan" },
        lunch: { content: "米饭", adherence: "on_plan" },
        dinner: { content: "牛肉", adherence: "adjusted", deviationNote: "时间偏晚" },
        preWorkout: { content: "香蕉", adherence: "on_plan" },
        postWorkout: { content: "牛奶", adherence: "on_plan" },
        postWorkoutSource: "dedicated",
      },
      trainingReportText: "",
      completed: true,
    });

    expect(parsed.reportVersion).toBe(2);
  });

  it("rejects training-day payloads without exercise results", () => {
    expect(() =>
      sessionReportSchema.parse({
        reportVersion: 2,
        date: "2026-03-13",
        performedDay: "B",
        bodyWeightKg: 60,
        sleepHours: 7,
        fatigue: 5,
        trainingReportText: "",
        completed: true,
      }),
    ).toThrow("训练日必须提交动作执行记录。");
  });

  it("keeps legacy stored reports readable", () => {
    const report = normalizeStoredSessionReport({
      id: "legacy-1",
      date: "2026-03-12",
      performedDay: "rest",
      bodyWeightKg: 60,
      sleepHours: 7.5,
      fatigue: 4,
      completed: true,
      trainingReportText: "今天休息。",
      mealLog: {
        breakfast: "鸡蛋",
        lunch: "米饭",
        dinner: "面条",
        preWorkout: "",
        postWorkout: "",
        postWorkoutSource: "dinner",
      },
      createdAt: "2026-03-12T10:00:00.000Z",
    });

    expect(report.reportVersion).toBe(1);
    expect(report.mealLog?.dinner.content).toBe("面条");
  });
});
