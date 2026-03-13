import type { MealLog, MealLogEntry, NutritionEstimate, ParsedMealItem } from "@/lib/types";

type FoodPortionUnit = "g" | "ml" | "slice" | "piece" | "cup" | "bowl" | "serving";
type NutritionBasis = "per100g" | "per100ml" | "perUnit";

type FoodLibraryItem = {
  id: string;
  name: string;
  aliases: string[];
  category: string;
  basis: NutritionBasis;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatsG: number;
  defaultServing: {
    amount: number;
    unit: FoodPortionUnit;
    grams?: number;
    milliliters?: number;
  };
};

type ComboDefinition = {
  id: string;
  name: string;
  aliases: string[];
  components: Array<{
    foodId: string;
    amount: number;
    unit: FoodPortionUnit;
  }>;
};

type QuantityInfo = {
  amount: number;
  unit: FoodPortionUnit;
  grams?: number;
  milliliters?: number;
  explicit: boolean;
};

export type MealParseResult = {
  parsedItems: ParsedMealItem[];
  nutritionEstimate: NutritionEstimate;
  analysisWarnings: string[];
};

export type ReportNutritionSummary = {
  mealLog?: MealLog;
  nutritionTotals: NutritionEstimate;
  nutritionGap: NutritionEstimate;
  nutritionWarnings: string[];
};

const chineseNumberMap: Record<string, number> = {
  半: 0.5,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
};

const unitMap: Record<string, FoodPortionUnit> = {
  g: "g",
  kg: "g",
  ml: "ml",
  l: "ml",
  片: "slice",
  个: "piece",
  杯: "cup",
  碗: "bowl",
  份: "serving",
};

const foodLibrary: FoodLibraryItem[] = [
  {
    id: "rice",
    name: "米饭",
    aliases: ["米饭", "白米饭", "米饭饭"],
    category: "carb",
    basis: "per100g",
    calories: 116,
    proteinG: 2.6,
    carbsG: 25.9,
    fatsG: 0.3,
    defaultServing: { amount: 250, unit: "g", grams: 250 },
  },
  {
    id: "bread",
    name: "面包",
    aliases: ["面包", "吐司", "白面包"],
    category: "carb",
    basis: "per100g",
    calories: 264,
    proteinG: 8.6,
    carbsG: 49,
    fatsG: 3.2,
    defaultServing: { amount: 2, unit: "slice", grams: 60 },
  },
  {
    id: "whole_wheat_bread",
    name: "全麦面包",
    aliases: ["全麦面包", "全麦吐司", "全麦切片面包"],
    category: "carb",
    basis: "per100g",
    calories: 247,
    proteinG: 12,
    carbsG: 41,
    fatsG: 4.2,
    defaultServing: { amount: 2, unit: "slice", grams: 60 },
  },
  {
    id: "noodles",
    name: "面条",
    aliases: ["面条", "挂面", "汤面", "拌面"],
    category: "carb",
    basis: "per100g",
    calories: 137,
    proteinG: 4.5,
    carbsG: 27,
    fatsG: 1.7,
    defaultServing: { amount: 250, unit: "g", grams: 250 },
  },
  {
    id: "oats",
    name: "燕麦",
    aliases: ["燕麦", "燕麦片"],
    category: "carb",
    basis: "per100g",
    calories: 389,
    proteinG: 16.9,
    carbsG: 66.3,
    fatsG: 6.9,
    defaultServing: { amount: 50, unit: "g", grams: 50 },
  },
  {
    id: "egg",
    name: "鸡蛋",
    aliases: ["鸡蛋", "蛋", "全蛋"],
    category: "protein",
    basis: "perUnit",
    calories: 72,
    proteinG: 6.3,
    carbsG: 0.4,
    fatsG: 4.8,
    defaultServing: { amount: 1, unit: "piece", grams: 50 },
  },
  {
    id: "chicken_breast",
    name: "鸡胸肉",
    aliases: ["鸡胸", "鸡胸肉"],
    category: "protein",
    basis: "per100g",
    calories: 165,
    proteinG: 31,
    carbsG: 0,
    fatsG: 3.6,
    defaultServing: { amount: 120, unit: "g", grams: 120 },
  },
  {
    id: "chicken_cutlet",
    name: "鸡排",
    aliases: ["鸡排", "炸鸡排", "煎鸡排"],
    category: "protein",
    basis: "per100g",
    calories: 250,
    proteinG: 18,
    carbsG: 14,
    fatsG: 13,
    defaultServing: { amount: 120, unit: "g", grams: 120 },
  },
  {
    id: "beef",
    name: "牛肉",
    aliases: ["牛肉", "瘦牛肉"],
    category: "protein",
    basis: "per100g",
    calories: 200,
    proteinG: 27,
    carbsG: 0,
    fatsG: 10,
    defaultServing: { amount: 100, unit: "g", grams: 100 },
  },
  {
    id: "fish",
    name: "鱼肉",
    aliases: ["鱼肉", "鱼", "烤鱼"],
    category: "protein",
    basis: "per100g",
    calories: 128,
    proteinG: 22,
    carbsG: 0,
    fatsG: 4,
    defaultServing: { amount: 150, unit: "g", grams: 150 },
  },
  {
    id: "milk",
    name: "牛奶",
    aliases: ["牛奶", "纯牛奶"],
    category: "drink",
    basis: "per100ml",
    calories: 54,
    proteinG: 3,
    carbsG: 5,
    fatsG: 3,
    defaultServing: { amount: 250, unit: "ml", milliliters: 250 },
  },
  {
    id: "yogurt",
    name: "酸奶",
    aliases: ["酸奶", "无糖酸奶"],
    category: "drink",
    basis: "per100g",
    calories: 72,
    proteinG: 3.1,
    carbsG: 9,
    fatsG: 2.4,
    defaultServing: { amount: 200, unit: "g", grams: 200 },
  },
  {
    id: "protein_powder",
    name: "蛋白粉",
    aliases: ["蛋白粉", "乳清蛋白", "乳清蛋白粉"],
    category: "supplement",
    basis: "per100g",
    calories: 400,
    proteinG: 80,
    carbsG: 10,
    fatsG: 5,
    defaultServing: { amount: 30, unit: "g", grams: 30 },
  },
  {
    id: "milk_coffee",
    name: "牛奶咖啡",
    aliases: ["牛奶咖啡", "拿铁", "咖啡牛奶"],
    category: "drink",
    basis: "per100ml",
    calories: 40,
    proteinG: 2,
    carbsG: 4.5,
    fatsG: 1.5,
    defaultServing: { amount: 300, unit: "ml", milliliters: 300 },
  },
  {
    id: "black_coffee",
    name: "黑咖啡",
    aliases: ["黑咖啡", "美式", "咖啡"],
    category: "drink",
    basis: "per100ml",
    calories: 2,
    proteinG: 0.2,
    carbsG: 0,
    fatsG: 0,
    defaultServing: { amount: 300, unit: "ml", milliliters: 300 },
  },
];

const comboLibrary: ComboDefinition[] = [
  {
    id: "grilled_fish_rice",
    name: "烤鱼饭",
    aliases: ["烤鱼饭"],
    components: [
      { foodId: "fish", amount: 150, unit: "g" },
      { foodId: "rice", amount: 250, unit: "g" },
    ],
  },
  {
    id: "chicken_cutlet_rice",
    name: "鸡排饭",
    aliases: ["鸡排饭"],
    components: [
      { foodId: "chicken_cutlet", amount: 120, unit: "g" },
      { foodId: "rice", amount: 250, unit: "g" },
    ],
  },
  {
    id: "beef_rice",
    name: "牛肉饭",
    aliases: ["牛肉饭"],
    components: [
      { foodId: "beef", amount: 120, unit: "g" },
      { foodId: "rice", amount: 250, unit: "g" },
    ],
  },
];

const foodAliasIndex = [...foodLibrary]
  .flatMap((item) => [item.name, ...item.aliases].map((alias) => ({ alias: alias.replace(/\s+/g, "").toLowerCase(), item })))
  .sort((left, right) => right.alias.length - left.alias.length);

const comboAliasIndex = [...comboLibrary]
  .flatMap((combo) => [combo.name, ...combo.aliases].map((alias) => ({ alias: alias.replace(/\s+/g, "").toLowerCase(), combo })))
  .sort((left, right) => right.alias.length - left.alias.length);

function roundNutrition(value: number) {
  return Math.round(value * 10) / 10;
}

function emptyNutrition(): NutritionEstimate {
  return {
    calories: 0,
    proteinG: 0,
    carbsG: 0,
    fatsG: 0,
  };
}

function addNutrition(base: NutritionEstimate, extra: NutritionEstimate): NutritionEstimate {
  return {
    calories: roundNutrition(base.calories + extra.calories),
    proteinG: roundNutrition(base.proteinG + extra.proteinG),
    carbsG: roundNutrition(base.carbsG + extra.carbsG),
    fatsG: roundNutrition(base.fatsG + extra.fatsG),
  };
}

function extractChineseNumber(value: string) {
  return chineseNumberMap[value] ?? null;
}

function normalizeLookupToken(input: string) {
  return input.replace(/\s+/g, "").toLowerCase();
}

function splitMealTokens(text: string) {
  return text
    .split(/[，,\/+\n；;、]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function findFoodMatch(token: string) {
  const normalized = normalizeLookupToken(token);
  return foodAliasIndex.find((entry) => normalized.includes(entry.alias))?.item ?? null;
}

function findComboMatch(token: string) {
  const normalized = normalizeLookupToken(token);
  return comboAliasIndex.find((entry) => normalized.includes(entry.alias))?.combo ?? null;
}

function convertQuantityToMeasure(
  quantity: number,
  unit: FoodPortionUnit,
  item: FoodLibraryItem,
): { grams?: number; milliliters?: number } {
  if (unit === "g") {
    return { grams: quantity };
  }
  if (unit === "ml") {
    return { milliliters: quantity };
  }

  if (item.defaultServing.unit === unit) {
    if (item.defaultServing.grams) {
      return { grams: quantity * (item.defaultServing.grams / item.defaultServing.amount) };
    }
    if (item.defaultServing.milliliters) {
      return { milliliters: quantity * (item.defaultServing.milliliters / item.defaultServing.amount) };
    }
  }

  if (unit === "slice" || unit === "piece" || unit === "cup" || unit === "bowl" || unit === "serving") {
    if (item.defaultServing.grams) {
      return { grams: quantity * item.defaultServing.grams };
    }
    if (item.defaultServing.milliliters) {
      return { milliliters: quantity * item.defaultServing.milliliters };
    }
  }

  if (item.defaultServing.grams) {
    return { grams: quantity * (item.defaultServing.grams / item.defaultServing.amount) };
  }
  if (item.defaultServing.milliliters) {
    return { milliliters: quantity * (item.defaultServing.milliliters / item.defaultServing.amount) };
  }
  return {};
}

function parseQuantity(token: string, item: FoodLibraryItem): QuantityInfo {
  const normalized = token.replace(/\s+/g, "");
  const numericMatches = [...normalized.matchAll(/(\d+(?:\.\d+)?)\s*(kg|g|ml|l|片|个|杯|碗|份)/gi)];
  const chineseMatch = normalized.match(/([半一二两三四五六七八九十])\s*(片|个|杯|碗|份)/);

  const preferredMatch = numericMatches.find((match) => ["kg", "g", "ml", "l"].includes(match[2].toLowerCase())) ?? numericMatches[0];
  if (preferredMatch) {
    const rawAmount = Number(preferredMatch[1]);
    const rawUnit = preferredMatch[2].toLowerCase();
    const mappedUnit = unitMap[rawUnit];
    const normalizedAmount = rawUnit === "kg" ? rawAmount * 1000 : rawUnit === "l" ? rawAmount * 1000 : rawAmount;
    const converted = convertQuantityToMeasure(normalizedAmount, mappedUnit, item);

    return {
      amount: normalizedAmount,
      unit: mappedUnit,
      grams: converted.grams,
      milliliters: converted.milliliters,
      explicit: true,
    };
  }

  if (chineseMatch) {
    const rawAmount = extractChineseNumber(chineseMatch[1]) ?? 1;
    const mappedUnit = unitMap[chineseMatch[2]];
    const converted = convertQuantityToMeasure(rawAmount, mappedUnit, item);
    return {
      amount: rawAmount,
      unit: mappedUnit,
      grams: converted.grams,
      milliliters: converted.milliliters,
      explicit: true,
    };
  }

  const fallbackQuantity =
    item.defaultServing.grams !== undefined
      ? { grams: item.defaultServing.grams }
      : item.defaultServing.milliliters !== undefined
        ? { milliliters: item.defaultServing.milliliters }
        : {};

  return {
    amount: item.defaultServing.amount,
    unit: item.defaultServing.unit,
    grams: fallbackQuantity.grams,
    milliliters: fallbackQuantity.milliliters,
    explicit: false,
  };
}

function calculateNutrition(item: FoodLibraryItem, quantity: QuantityInfo): NutritionEstimate {
  let factor = 0;

  if (item.basis === "per100g") {
    const grams = quantity.grams ?? item.defaultServing.grams ?? 0;
    factor = grams / 100;
  } else if (item.basis === "per100ml") {
    const milliliters = quantity.milliliters ?? item.defaultServing.milliliters ?? 0;
    factor = milliliters / 100;
  } else {
    if (quantity.unit === "piece" || quantity.unit === "slice" || quantity.unit === "cup" || quantity.unit === "bowl" || quantity.unit === "serving") {
      factor = quantity.amount / item.defaultServing.amount;
    } else if (quantity.grams && item.defaultServing.grams) {
      factor = quantity.grams / item.defaultServing.grams;
    } else if (quantity.milliliters && item.defaultServing.milliliters) {
      factor = quantity.milliliters / item.defaultServing.milliliters;
    }
  }

  return {
    calories: roundNutrition(item.calories * factor),
    proteinG: roundNutrition(item.proteinG * factor),
    carbsG: roundNutrition(item.carbsG * factor),
    fatsG: roundNutrition(item.fatsG * factor),
  };
}

function createParsedItem(
  item: FoodLibraryItem,
  sourceText: string,
  quantity: QuantityInfo,
  note?: string,
): ParsedMealItem {
  const nutrition = calculateNutrition(item, quantity);
  return {
    name: item.name,
    sourceText,
    amount: quantity.amount,
    unit: quantity.unit,
    grams: quantity.grams,
    milliliters: quantity.milliliters,
    quantitySource: quantity.explicit ? "explicit" : "default",
    category: item.category,
    calories: nutrition.calories,
    proteinG: nutrition.proteinG,
    carbsG: nutrition.carbsG,
    fatsG: nutrition.fatsG,
    note,
  };
}

function uniqueWarnings(warnings: string[]) {
  return [...new Set(warnings.filter(Boolean))];
}

export function parseMealText(text: string): MealParseResult {
  const tokens = splitMealTokens(text);
  if (!tokens.length) {
    return {
      parsedItems: [],
      nutritionEstimate: emptyNutrition(),
      analysisWarnings: [],
    };
  }

  const parsedItems: ParsedMealItem[] = [];
  const warnings: string[] = [];
  const combos: Array<{ combo: ComboDefinition; token: string; count: number }> = [];
  const explicitFoodNames = new Set<string>();

  for (const token of tokens) {
    const combo = findComboMatch(token);
    if (combo) {
      const comboCountMatch = token.match(/(\d+(?:\.\d+)?)\s*份/);
      const comboChineseCount = token.match(/([一二两三四五六七八九十])\s*份/);
      const count = comboCountMatch
        ? Number(comboCountMatch[1])
        : comboChineseCount
          ? (extractChineseNumber(comboChineseCount[1]) ?? 1)
          : 1;
      combos.push({ combo, token, count });
      warnings.push(`${combo.name} 使用套餐默认构成估算；若实际克数不同，请补充主食或蛋白重量。`);
      continue;
    }

    const food = findFoodMatch(token);
    if (!food) {
      warnings.push(`未识别条目：${token}`);
      continue;
    }

    const quantity = parseQuantity(token, food);
    const parsedItem = createParsedItem(food, token, quantity, quantity.explicit ? undefined : `按默认份量估算 ${food.defaultServing.amount}${food.defaultServing.unit}`);
    parsedItems.push(parsedItem);
    explicitFoodNames.add(food.name);

    if (!quantity.explicit) {
      warnings.push(`${food.name} 未写明份量，按默认份量估算。`);
    }
  }

  for (const comboEntry of combos) {
    for (const component of comboEntry.combo.components) {
      const food = foodLibrary.find((item) => item.id === component.foodId);
      if (!food || explicitFoodNames.has(food.name)) {
        continue;
      }

      const quantity: QuantityInfo = {
        amount: component.amount * comboEntry.count,
        unit: component.unit,
        grams: component.unit === "g" ? component.amount * comboEntry.count : undefined,
        milliliters: component.unit === "ml" ? component.amount * comboEntry.count : undefined,
        explicit: false,
      };
      parsedItems.push(
        createParsedItem(food, comboEntry.token, quantity, `${comboEntry.combo.name} 默认构成`),
      );
    }
  }

  const nutritionEstimate = parsedItems.reduce(
    (sum, item) =>
      addNutrition(sum, {
        calories: item.calories,
        proteinG: item.proteinG,
        carbsG: item.carbsG,
        fatsG: item.fatsG,
      }),
    emptyNutrition(),
  );

  return {
    parsedItems,
    nutritionEstimate,
    analysisWarnings: uniqueWarnings(warnings),
  };
}

function enrichMealEntry(entry: MealLogEntry): MealLogEntry {
  const parsed = parseMealText(entry.content);
  return {
    ...entry,
    parsedItems: parsed.parsedItems,
    nutritionEstimate: parsed.nutritionEstimate,
    analysisWarnings: parsed.analysisWarnings,
  };
}

function getEffectiveSlotKeys(mealLog: MealLog) {
  return mealLog.postWorkoutSource === "dedicated"
    ? (["breakfast", "lunch", "dinner", "preWorkout", "postWorkout"] as const)
    : (["breakfast", "lunch", "dinner", "preWorkout"] as const);
}

export function summarizeReportNutrition(
  mealLog: MealLog | undefined,
  targetMacros: NutritionEstimate,
): ReportNutritionSummary {
  if (!mealLog) {
    return {
      mealLog,
      nutritionTotals: emptyNutrition(),
      nutritionGap: {
        calories: -targetMacros.calories,
        proteinG: -targetMacros.proteinG,
        carbsG: -targetMacros.carbsG,
        fatsG: -targetMacros.fatsG,
      },
      nutritionWarnings: ["今天还没有可解析的餐次文本。"],
    };
  }

  const enrichedMealLog: MealLog = {
    ...mealLog,
    breakfast: enrichMealEntry(mealLog.breakfast),
    lunch: enrichMealEntry(mealLog.lunch),
    dinner: enrichMealEntry(mealLog.dinner),
    preWorkout: enrichMealEntry(mealLog.preWorkout),
    postWorkout: enrichMealEntry(mealLog.postWorkout),
  };

  if (mealLog.postWorkoutSource === "lunch") {
    enrichedMealLog.postWorkout = {
      ...enrichedMealLog.lunch,
      analysisWarnings: uniqueWarnings([...(enrichedMealLog.lunch.analysisWarnings ?? []), "午餐兼作练后餐，全天合计未重复计入。"]),
    };
  } else if (mealLog.postWorkoutSource === "dinner") {
    enrichedMealLog.postWorkout = {
      ...enrichedMealLog.dinner,
      analysisWarnings: uniqueWarnings([...(enrichedMealLog.dinner.analysisWarnings ?? []), "晚餐兼作练后餐，全天合计未重复计入。"]),
    };
  }

  const slotKeys = getEffectiveSlotKeys(mealLog);
  const nutritionTotals = slotKeys.reduce((sum, slot) => {
    const estimate = enrichedMealLog[slot].nutritionEstimate ?? emptyNutrition();
    return addNutrition(sum, estimate);
  }, emptyNutrition());

  const nutritionGap = {
    calories: roundNutrition(nutritionTotals.calories - targetMacros.calories),
    proteinG: roundNutrition(nutritionTotals.proteinG - targetMacros.proteinG),
    carbsG: roundNutrition(nutritionTotals.carbsG - targetMacros.carbsG),
    fatsG: roundNutrition(nutritionTotals.fatsG - targetMacros.fatsG),
  };

  const nutritionWarnings = uniqueWarnings(
    slotKeys.flatMap((slot) => enrichedMealLog[slot].analysisWarnings ?? []),
  );

  return {
    mealLog: enrichedMealLog,
    nutritionTotals,
    nutritionGap,
    nutritionWarnings,
  };
}
