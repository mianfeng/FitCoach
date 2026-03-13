import { describe, expect, it } from "vitest";

import { parseMealText, summarizeReportNutrition } from "@/lib/nutrition";
import { createEmptyMealLog } from "@/lib/session-report";

describe("nutrition parser", () => {
  it("parses explicit gram input for whole wheat bread", () => {
    const result = parseMealText("50g全麦面包");

    expect(result.parsedItems).toHaveLength(1);
    expect(result.parsedItems[0]?.name).toBe("全麦面包");
    expect(result.parsedItems[0]?.grams).toBe(50);
    expect(result.nutritionEstimate.calories).toBe(123.5);
    expect(result.nutritionEstimate.proteinG).toBe(6);
    expect(result.analysisWarnings).toHaveLength(0);
  });

  it("uses default cup size for milk coffee when only cup count is provided", () => {
    const result = parseMealText("一杯牛奶咖啡");

    expect(result.parsedItems).toHaveLength(1);
    expect(result.parsedItems[0]?.milliliters).toBe(300);
    expect(result.nutritionEstimate.calories).toBe(120);
    expect(result.analysisWarnings).toHaveLength(0);
  });

  it("accumulates multiple foods in one text block", () => {
    const result = parseMealText("100g鱼肉，30g牛肉，350g米饭");

    expect(result.parsedItems.map((item) => item.name)).toEqual(["鱼肉", "牛肉", "米饭"]);
    expect(result.nutritionEstimate.calories).toBe(594);
    expect(result.nutritionEstimate.proteinG).toBe(39.2);
    expect(result.nutritionEstimate.carbsG).toBe(90.6);
    expect(result.nutritionEstimate.fatsG).toBe(8.1);
  });

  it("does not double count combo defaults when explicit components are present", () => {
    const result = parseMealText("鸡排饭，100g鸡排，250g米饭");

    expect(result.parsedItems.map((item) => item.name)).toEqual(["鸡排", "米饭"]);
    expect(result.nutritionEstimate.calories).toBe(540);
    expect(result.nutritionEstimate.proteinG).toBe(24.5);
    expect(result.nutritionEstimate.carbsG).toBe(78.8);
    expect(result.nutritionEstimate.fatsG).toBe(13.8);
    expect(result.analysisWarnings.some((warning) => warning.includes("鸡排饭"))).toBe(true);
  });

  it("estimates combo defaults when only combo text is provided", () => {
    const result = parseMealText("烤鱼饭");

    expect(result.parsedItems.map((item) => item.name)).toEqual(["鱼肉", "米饭"]);
    expect(result.nutritionEstimate.calories).toBe(482);
    expect(result.nutritionEstimate.proteinG).toBe(39.5);
    expect(result.nutritionEstimate.carbsG).toBe(64.8);
    expect(result.nutritionEstimate.fatsG).toBe(6.8);
    expect(result.analysisWarnings.some((warning) => warning.includes("烤鱼饭"))).toBe(true);
  });
});

describe("nutrition summarizer", () => {
  it("builds report totals and gaps from meal text", () => {
    const mealLog = createEmptyMealLog();
    mealLog.breakfast.content = "50g全麦面包，一杯牛奶咖啡";
    mealLog.lunch.content = "100g鱼肉，350g米饭";
    mealLog.dinner.content = "鸡排饭，100g鸡排，250g米饭";
    mealLog.preWorkout.adherence = "missed";
    mealLog.postWorkout.adherence = "missed";

    const result = summarizeReportNutrition(mealLog, {
      calories: 2000,
      proteinG: 140,
      carbsG: 220,
      fatsG: 60,
    });

    expect(result.mealLog?.breakfast.parsedItems?.length).toBeGreaterThan(0);
    expect(result.nutritionTotals.calories).toBeGreaterThan(1200);
    expect(result.nutritionGap.calories).toBeLessThan(0);
    expect(result.nutritionWarnings.some((warning) => warning.includes("鸡排饭"))).toBe(true);
  });
});
