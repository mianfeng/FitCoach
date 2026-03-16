import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createEmptyMealLog } from "@/lib/session-report";

const mockGenerateContent = vi.fn();

vi.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel() {
      return {
        generateContent: mockGenerateContent,
      };
    }
  },
}));

async function loadComputeModule() {
  const loadedGeminiModule = await import("@/lib/server/gemini");
  return loadedGeminiModule.computeMealLogNutritionWithGemini;
}

describe("computeMealLogNutritionWithGemini", () => {
  const originalGeminiApiKey = process.env.GEMINI_API_KEY;
  const originalGeminiModel = process.env.GEMINI_MODEL;

  beforeEach(() => {
    vi.resetModules();
    mockGenerateContent.mockReset();
  });

  afterEach(() => {
    if (originalGeminiApiKey === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = originalGeminiApiKey;
    }

    if (originalGeminiModel === undefined) {
      delete process.env.GEMINI_MODEL;
    } else {
      process.env.GEMINI_MODEL = originalGeminiModel;
    }
  });

  it("returns deterministic local nutrition when all foods are recognized", async () => {
    delete process.env.GEMINI_API_KEY;
    process.env.GEMINI_MODEL = "gemini-2.0-flash";

    const computeMealLogNutritionWithGemini = await loadComputeModule();
    const mealLog = createEmptyMealLog();
    mealLog.breakfast.content = "50g全麦面包，一杯牛奶咖啡";
    mealLog.lunch.content = "100g鱼肉，350g米饭";
    mealLog.dinner.content = "鸡排饭，100g鸡排，250g米饭";
    mealLog.preWorkout.adherence = "missed";
    mealLog.postWorkout.adherence = "missed";

    const result = await computeMealLogNutritionWithGemini({
      mealLog,
      targetNutrition: {
        calories: 2000,
        proteinG: 140,
        carbsG: 220,
        fatsG: 60,
      },
      nutritionDishes: [],
    });

    expect(result.status).toBe("ready");
    if (result.status !== "ready") {
      return;
    }

    expect(mockGenerateContent).not.toHaveBeenCalled();
    expect(result.nutritionTotals.calories).toBe(1317.5);
    expect(result.nutritionTotals.proteinG).toBe(67.6);
    expect(result.nutritionTotals.carbsG).toBe(203.4);
    expect(result.nutritionTotals.fatsG).toBe(25.5);
    expect(result.mealLog.breakfast.parsedItems?.map((item) => item.name)).toEqual(["全麦面包", "牛奶咖啡"]);
  });

  it("uses Gemini only for unresolved tokens and merges them with local parsing", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    process.env.GEMINI_MODEL = "gemini-2.0-flash";
    mockGenerateContent.mockResolvedValue({
      response: {
        text: () =>
          JSON.stringify([
            {
              token: "神秘便当",
              name: "神秘便当",
              calories: 520,
              proteinG: 24,
              carbsG: 62,
              fatsG: 18,
            },
          ]),
      },
    });

    const computeMealLogNutritionWithGemini = await loadComputeModule();
    const mealLog = createEmptyMealLog();
    mealLog.breakfast.content = "50g全麦面包";
    mealLog.lunch.content = "神秘便当";
    mealLog.dinner.adherence = "missed";
    mealLog.preWorkout.adherence = "missed";
    mealLog.postWorkout.adherence = "missed";

    const result = await computeMealLogNutritionWithGemini({
      mealLog,
      targetNutrition: {
        calories: 1800,
        proteinG: 130,
        carbsG: 180,
        fatsG: 50,
      },
      nutritionDishes: [],
    });

    expect(result.status).toBe("ready");
    if (result.status !== "ready") {
      return;
    }

    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    expect(result.nutritionTotals.calories).toBe(643.5);
    expect(result.nutritionTotals.proteinG).toBe(30);
    expect(result.nutritionTotals.carbsG).toBe(82.5);
    expect(result.nutritionTotals.fatsG).toBe(20.1);
    expect(result.mealLog.lunch.parsedItems?.[0]?.quantitySource).toBe("ai");
    expect(result.mealLog.lunch.nutritionEstimate?.calories).toBe(520);
  });
});
