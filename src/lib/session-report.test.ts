import { describe, expect, it } from "vitest";

import { normalizeMealLog, normalizeStoredSessionReport } from "@/lib/session-report";
import { nutritionDishSchema, sessionReportSchema } from "@/lib/validations";

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
        lunch: { content: "米饭", adherence: "on_plan", cookingMethod: "poached_steamed", rinseOil: false },
        dinner: { content: "牛肉", adherence: "adjusted", deviationNote: "时间偏晚", cookingMethod: "stir_fry_normal", rinseOil: true },
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

  it("accepts a training-day draft without exercise results", () => {
    const parsed = sessionReportSchema.parse({
      reportVersion: 2,
      date: "2026-03-13",
      performedDay: "B",
      bodyWeightKg: 60,
      sleepHours: 7,
      fatigue: 5,
      trainingReportText: "鍏堣鏃╅锛屾櫄涓婂啀琛ュ叏璁粌",
      mealLog: {
        breakfast: { content: "楦¤泲 鐗涘ザ", adherence: "on_plan" },
        lunch: { content: "", adherence: "missed" },
        dinner: { content: "", adherence: "missed" },
        preWorkout: { content: "", adherence: "missed" },
        postWorkout: { content: "", adherence: "missed" },
        postWorkoutSource: "dedicated",
      },
      completed: false,
    });

    expect(parsed.completed).toBe(false);
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
    expect(report.mealLog?.dinner.rinseOil).toBeUndefined();
  });

  it("preserves cooking metadata on structured meal entries", () => {
    const report = normalizeStoredSessionReport({
      id: "structured-1",
      date: "2026-03-12",
      performedDay: "rest",
      bodyWeightKg: 60,
      sleepHours: 7.5,
      fatigue: 4,
      completed: false,
      trainingReportText: "",
      mealLog: {
        breakfast: { content: "鸡蛋", adherence: "on_plan", cookingMethod: "poached_steamed", rinseOil: false },
        lunch: { content: "辣椒炒肉饭", adherence: "adjusted", cookingMethod: "stir_fry_heavy", rinseOil: true },
        dinner: { content: "", adherence: "missed" },
        preWorkout: { content: "", adherence: "missed" },
        postWorkout: { content: "", adherence: "missed" },
        postWorkoutSource: "dedicated",
      },
      createdAt: "2026-03-12T10:00:00.000Z",
    });

    expect(report.mealLog?.lunch.cookingMethod).toBe("stir_fry_heavy");
    expect(report.mealLog?.lunch.rinseOil).toBe(true);
  });
});

describe("nutrition dish validation", () => {
  it("accepts per-serving macros", () => {
    const parsed = nutritionDishSchema.parse({
      name: "鸡腿饭",
      aliases: ["鸡排饭", "鸡腿盖饭"],
      macros: {
        proteinG: 28,
        carbsG: 62,
        fatsG: 14,
      },
    });
    expect(parsed.name).toBe("鸡腿饭");
  });

  it("rejects non-positive macro totals", () => {
    expect(() =>
      nutritionDishSchema.parse({
        name: "空菜品",
        aliases: [],
        macros: {
          proteinG: 0,
          carbsG: 0,
          fatsG: 0,
        },
      }),
    ).toThrow("至少填写一个大于 0 的宏量营养素。");
  });

  it("rejects negative macro values", () => {
    expect(() =>
      nutritionDishSchema.parse({
        name: "错误菜品",
        aliases: [],
        macros: {
          proteinG: -1,
          carbsG: 12,
          fatsG: 4,
        },
      }),
    ).toThrow();
  });
});
