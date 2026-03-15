import { describe, expect, it } from "vitest";

import { parseMealText, summarizeReportNutrition } from "@/lib/nutrition";
import { createEmptyMealLog } from "@/lib/session-report";
import type { NutritionDish } from "@/lib/types";

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

  it("parses banana with root count", () => {
    const result = parseMealText("一根香蕉");

    expect(result.parsedItems).toHaveLength(1);
    expect(result.parsedItems[0]?.name).toBe("香蕉");
    expect(result.parsedItems[0]?.grams).toBe(120);
    expect(result.nutritionEstimate.calories).toBe(106.8);
    expect(result.analysisWarnings).toHaveLength(0);
  });

  it("parses custom dishes by alias with per-serving macros", () => {
    const customDishes: NutritionDish[] = [
      {
        id: "dish-spicy-beef",
        name: "辣椒炒牛肉",
        aliases: ["炒牛肉", "牛肉小炒"],
        macros: {
          proteinG: 28,
          carbsG: 12,
          fatsG: 18,
        },
      },
    ];
    const result = parseMealText("炒牛肉", { customDishes });

    expect(result.parsedItems).toHaveLength(1);
    expect(result.parsedItems[0]?.name).toBe("辣椒炒牛肉");
    expect(result.nutritionEstimate.calories).toBe(322);
    expect(result.analysisWarnings).toHaveLength(0);
  });

  it("falls back to one serving when custom per-serving dish is logged with grams", () => {
    const customDishes: NutritionDish[] = [
      {
        id: "dish-rice-box",
        name: "一盒米饭",
        aliases: ["盒饭米饭"],
        macros: {
          proteinG: 6,
          carbsG: 75,
          fatsG: 1,
        },
      },
    ];
    const result = parseMealText("一盒米饭270g", { customDishes });

    expect(result.parsedItems).toHaveLength(1);
    expect(result.parsedItems[0]?.name).toBe("一盒米饭");
    expect(result.nutritionEstimate.calories).toBe(333);
    expect(result.nutritionEstimate.proteinG).toBe(6);
    expect(result.nutritionEstimate.carbsG).toBe(75);
    expect(result.nutritionEstimate.fatsG).toBe(1);
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

    expect(result.parsedItems.map((item) => item.name)).toEqual(["鱼肉", "米饭", "食用油"]);
    expect(result.nutritionEstimate.calories).toBe(552.7);
    expect(result.nutritionEstimate.proteinG).toBe(39.5);
    expect(result.nutritionEstimate.carbsG).toBe(64.8);
    expect(result.nutritionEstimate.fatsG).toBe(14.8);
    expect(result.analysisWarnings.some((warning) => warning.includes("烤鱼饭"))).toBe(true);
  });

  it("estimates stir-fry dishes with default oil", () => {
    const result = parseMealText("辣椒炒肉");

    expect(result.parsedItems.map((item) => item.name)).toEqual(["猪肉", "辣椒", "食用油"]);
    expect(result.nutritionEstimate.calories).toBe(376.4);
    expect(result.nutritionEstimate.proteinG).toBe(27.6);
    expect(result.nutritionEstimate.carbsG).toBe(4.8);
    expect(result.nutritionEstimate.fatsG).toBe(28.2);
  });

  it("parses chicken-leg rice components and avoids unknown inflation", () => {
    const result = parseMealText("鸡腿饭，270g米饭，去皮鸡腿一只，一块豆干，一颗卤蛋");

    expect(result.parsedItems.map((item) => item.name)).toEqual(["米饭", "去皮鸡腿", "豆干", "卤蛋", "食用油"]);
    expect(result.nutritionEstimate.calories).toBe(747.2);
    expect(result.unknownTokens).toHaveLength(0);
    expect(result.analysisWarnings.some((warning) => warning.includes("鸡腿饭"))).toBe(true);
  });

  it("uses inferred AI estimate for unknown tokens without warning", () => {
    const result = parseMealText("神秘便当", {
      inferredTokenEstimates: [
        {
          token: "神秘便当",
          nutrition: {
            calories: 520,
            proteinG: 24,
            carbsG: 62,
            fatsG: 18,
          },
        },
      ],
    });

    expect(result.parsedItems).toHaveLength(1);
    expect(result.parsedItems[0]?.quantitySource).toBe("ai");
    expect(result.nutritionEstimate.calories).toBe(520);
    expect(result.analysisWarnings).toHaveLength(0);
    expect(result.unknownTokens).toHaveLength(0);
  });

  it("keeps warning when unknown token has no inferred estimate", () => {
    const result = parseMealText("火星蛋白饭");

    expect(result.analysisWarnings.some((warning) => warning.includes("未识别条目"))).toBe(true);
    expect(result.unknownTokens).toContain("火星蛋白饭");
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
