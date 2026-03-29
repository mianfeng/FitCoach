import type {
  MealCookingMethod,
  MealLog,
  MealLogEntry,
  NutritionDish,
  NutritionEstimate,
  ParsedMealItem,
} from "@/lib/types";

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
  supportsCookingOilRule?: boolean;
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
  defaultCookingMethod?: MealCookingMethod;
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

type MealParseOptions = {
  customDishes?: NutritionDish[];
  inferredTokenEstimates?: InferredTokenEstimate[];
  cookingMethod?: MealCookingMethod;
  rinseOil?: boolean;
};

type CookingMethodResolutionSource = "user" | "text" | "combo" | "default" | "none";

type CookingMethodResolution = {
  method?: MealCookingMethod;
  source: CookingMethodResolutionSource;
};

type CookingOilRule = {
  baseOilG: number;
  label: string;
};

export type MealParseResult = {
  parsedItems: ParsedMealItem[];
  nutritionEstimate: NutritionEstimate;
  analysisWarnings: string[];
  unknownTokens: string[];
};

export type ReportNutritionSummary = {
  mealLog?: MealLog;
  nutritionTotals: NutritionEstimate;
  nutritionGap: NutritionEstimate;
  nutritionWarnings: string[];
  unknownTokens: string[];
};

export type InferredTokenEstimate = {
  token: string;
  name?: string;
  nutrition: NutritionEstimate;
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
  只: "piece",
  块: "piece",
  颗: "piece",
  根: "piece",
  杯: "cup",
  碗: "bowl",
  份: "serving",
  勺: "serving",
};

const cookingOilRules: Record<MealCookingMethod, CookingOilRule> = {
  poached_steamed: { baseOilG: 0, label: "水煮/清蒸" },
  stir_fry_light: { baseOilG: 8, label: "少油炒" },
  stir_fry_normal: { baseOilG: 12, label: "正常炒" },
  stir_fry_heavy: { baseOilG: 16, label: "重油炒" },
  grill_pan_sear: { baseOilG: 5, label: "烤/煎" },
  deep_fry: { baseOilG: 18, label: "炸" },
};

const cookingKeywordRules: Array<{ method: MealCookingMethod; patterns: string[] }> = [
  { method: "stir_fry_light", patterns: ["少油"] },
  { method: "deep_fry", patterns: ["油炸", "脆皮", "炸"] },
  { method: "stir_fry_heavy", patterns: ["重油", "干锅", "香锅", "回锅", "油泼", "红烧"] },
  { method: "poached_steamed", patterns: ["清蒸", "水煮", "白灼", "汆", "蒸"] },
  { method: "grill_pan_sear", patterns: ["烤", "煎"] },
  { method: "stir_fry_normal", patterns: ["小炒", "炝", "爆", "炒"] },
];

const cookingControlTokens = new Set([
  "少油",
  "少油炒",
  "正常炒",
  "普通炒",
  "重油",
  "重油炒",
  "干锅",
  "香锅",
  "回锅",
  "油泼",
  "红烧",
  "清蒸",
  "蒸",
  "水煮",
  "白灼",
  "汆",
  "烤",
  "煎",
  "炸",
  "油炸",
  "脆皮",
  "涮油",
]);

const rinseOilKeywords = ["涮油", "过水去油", "冲油", "清水去油", "已清水去油", "过水去脂"];

function stripParentheticalText(input: string) {
  return input.replace(/[（(][^（）()]*[)）]/g, "");
}

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
    id: "potato",
    name: "土豆",
    aliases: ["土豆", "土豆丝"],
    category: "carb",
    basis: "per100g",
    calories: 87,
    proteinG: 1.7,
    carbsG: 20,
    fatsG: 0.1,
    defaultServing: { amount: 1, unit: "piece", grams: 200 },
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
    calories: 137.3,
    proteinG: 4.5,
    carbsG: 26,
    fatsG: 1.7,
    defaultServing: { amount: 250, unit: "g", grams: 250 },
  },
  {
    id: "oats",
    name: "燕麦",
    aliases: ["燕麦", "燕麦片"],
    category: "carb",
    basis: "per100g",
    calories: 394.9,
    proteinG: 16.9,
    carbsG: 66.3,
    fatsG: 6.9,
    defaultServing: { amount: 50, unit: "g", grams: 50 },
  },
  {
    id: "banana",
    name: "香蕉",
    aliases: ["香蕉", "一根香蕉"],
    category: "fruit",
    basis: "per100g",
    calories: 83.1,
    proteinG: 1.1,
    carbsG: 19,
    fatsG: 0.3,
    defaultServing: { amount: 1, unit: "piece", grams: 100 },
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
    calories: 156.4,
    proteinG: 31,
    carbsG: 0,
    fatsG: 3.6,
    supportsCookingOilRule: true,
    defaultServing: { amount: 120, unit: "g", grams: 120 },
  },
  {
    id: "chicken_cutlet",
    name: "鸡排",
    aliases: ["鸡排", "炸鸡排", "煎鸡排"],
    category: "protein",
    basis: "per100g",
    calories: 245,
    proteinG: 18,
    carbsG: 14,
    fatsG: 13,
    defaultServing: { amount: 120, unit: "g", grams: 120 },
  },
  {
    id: "chicken_leg_skinless",
    name: "去皮鸡腿",
    aliases: ["去皮鸡腿", "鸡腿", "鸡腿肉"],
    category: "protein",
    basis: "per100g",
    calories: 170,
    proteinG: 24,
    carbsG: 0,
    fatsG: 8,
    supportsCookingOilRule: true,
    defaultServing: { amount: 1, unit: "piece", grams: 150 },
  },
  {
    id: "beef",
    name: "牛肉",
    aliases: ["牛肉", "瘦牛肉"],
    category: "protein",
    basis: "per100g",
    calories: 194,
    proteinG: 26,
    carbsG: 0,
    fatsG: 10,
    supportsCookingOilRule: true,
    defaultServing: { amount: 100, unit: "g", grams: 100 },
  },
  {
    id: "pork",
    name: "猪肉",
    aliases: ["猪肉", "瘦猪肉", "里脊"],
    category: "protein",
    basis: "per100g",
    calories: 160,
    proteinG: 22,
    carbsG: 0,
    fatsG: 8,
    supportsCookingOilRule: true,
    defaultServing: { amount: 120, unit: "g", grams: 120 },
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
    supportsCookingOilRule: true,
    defaultServing: { amount: 150, unit: "g", grams: 150 },
  },
  {
    id: "chili_pepper",
    name: "辣椒",
    aliases: ["辣椒", "青椒", "红椒", "甜椒"],
    category: "vegetable",
    basis: "per100g",
    calories: 30,
    proteinG: 1.5,
    carbsG: 6,
    fatsG: 0.3,
    supportsCookingOilRule: true,
    defaultServing: { amount: 80, unit: "g", grams: 80 },
  },
  {
    id: "mixed_vegetables",
    name: "蔬菜",
    aliases: ["蔬菜", "青菜", "菠菜", "莴笋", "冬瓜"],
    category: "vegetable",
    basis: "per100g",
    calories: 20,
    proteinG: 1.2,
    carbsG: 3.8,
    fatsG: 0.2,
    supportsCookingOilRule: true,
    defaultServing: { amount: 100, unit: "g", grams: 100 },
  },
  {
    id: "tofu_dry",
    name: "豆干",
    aliases: ["豆干", "豆腐干"],
    category: "protein",
    basis: "per100g",
    calories: 160,
    proteinG: 17,
    carbsG: 5,
    fatsG: 8,
    defaultServing: { amount: 1, unit: "piece", grams: 30 },
  },

  {
    id: "marinated_egg",
    name: "卤蛋",
    aliases: ["卤蛋", "茶叶蛋"],
    category: "protein",
    basis: "perUnit",
    calories: 78,
    proteinG: 6.5,
    carbsG: 1.3,
    fatsG: 5.2,
    defaultServing: { amount: 1, unit: "piece", grams: 55 },
  },
  {
    id: "milk",
    name: "牛奶",
    aliases: ["牛奶", "纯牛奶"],
    category: "drink",
    basis: "per100ml",
    calories: 59,
    proteinG: 3,
    carbsG: 5,
    fatsG: 3,
    defaultServing: { amount: 250, unit: "ml", milliliters: 250 },
  },
  {
    id: "milk_powder",
    name: "奶粉",
    aliases: ["奶粉", "全脂奶粉", "脱脂奶粉"],
    category: "drink",
    basis: "per100g",
    calories: 495,
    proteinG: 24,
    carbsG: 38,
    fatsG: 27,
    defaultServing: { amount: 25, unit: "g", grams: 25 },
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
    id: "cooking_oil",
    name: "食用油",
    aliases: ["食用油", "烹调油", "橄榄油", "菜籽油"],
    category: "fat",
    basis: "per100g",
    calories: 900,
    proteinG: 0,
    carbsG: 0,
    fatsG: 100,
    defaultServing: { amount: 10, unit: "g", grams: 10 },
  },
  {
    id: "protein_powder",
    name: "蛋白粉",
    aliases: ["蛋白粉", "乳清蛋白", "乳清蛋白粉"],
    category: "supplement",
    basis: "per100g",
    calories: 398,
    proteinG: 78,
    carbsG: 8,
    fatsG: 6,
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
    defaultCookingMethod: "grill_pan_sear",
    components: [
      { foodId: "fish", amount: 150, unit: "g" },
      { foodId: "rice", amount: 250, unit: "g" },
    ],
  },
{
    id: "chaocai",
    name: "炒菜",
    aliases: ["炒菜"],
    defaultCookingMethod: "stir_fry_normal",
    components: [
      { foodId: "rice", amount: 250, unit: "g" },
    ],
  },
  {
    id: "nudles_with_veggies",
    name: "煮面",
    aliases: ["煮面", "面条加菜"],
    defaultCookingMethod: "stir_fry_heavy",
    components: [
      { foodId: "noodles", amount: 200, unit: "g" },
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
    defaultCookingMethod: "stir_fry_normal",
    components: [
      { foodId: "beef", amount: 120, unit: "g" },
      { foodId: "rice", amount: 250, unit: "g" },
    ],
  },
  {
    id: "chicken_bao",
    name: "鸡公煲",
    aliases: ["鸡公煲", "重庆鸡公煲"],
    defaultCookingMethod: "stir_fry_heavy",
    components: [
      { foodId: "chicken_leg_skinless", amount: 50, unit: "g" },
      { foodId: "rice", amount:300, unit: "g" },
    ],
  },
  {
    id: "spicy_pork",
    name: "辣椒炒肉",
    aliases: ["辣椒炒肉", "青椒炒肉", "小炒肉"],
    defaultCookingMethod: "stir_fry_normal",
    components: [
      { foodId: "pork", amount: 120, unit: "g" },
      { foodId: "chili_pepper", amount: 80, unit: "g" },
    ],
  },
  {
    id: "chicken_leg_rice",
    name: "鸡腿饭",
    aliases: ["鸡腿饭", "鸡腿盖饭"],
    defaultCookingMethod: "stir_fry_normal",
    components: [
      { foodId: "chicken_leg_skinless", amount: 150, unit: "g" },
      { foodId: "rice", amount: 250, unit: "g" },
    ],
  },
];

function roundNutrition(value: number) {
  return Math.round(value * 10) / 10;
}

function calculateCaloriesFromMacros(proteinG: number, carbsG: number, fatsG: number) {
  return roundNutrition(proteinG * 4 + carbsG * 4 + fatsG * 9);
}

function normalizeNutritionEstimate(input: NutritionEstimate): NutritionEstimate {
  const proteinG = roundNutrition(input.proteinG);
  const carbsG = roundNutrition(input.carbsG);
  const fatsG = roundNutrition(input.fatsG);

  return {
    calories: calculateCaloriesFromMacros(proteinG, carbsG, fatsG),
    proteinG,
    carbsG,
    fatsG,
  };
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
  return normalizeNutritionEstimate({
    calories: base.calories + extra.calories,
    proteinG: base.proteinG + extra.proteinG,
    carbsG: base.carbsG + extra.carbsG,
    fatsG: base.fatsG + extra.fatsG,
  });
}

function extractChineseNumber(value: string) {
  return chineseNumberMap[value] ?? null;
}

function normalizeLookupToken(input: string) {
  return stripParentheticalText(input).replace(/\s+/g, "").toLowerCase();
}

function isQuantitySegment(segment: string) {
  return /^(\d+(?:\.\d+)?|[半一二两三四五六七八九十])$/i.test(segment);
}

function isUnitSegment(segment: string) {
  return /^(kg|g|ml|l|片|个|只|块|颗|根|杯|碗|份|勺)$/i.test(segment);
}

function endsWithQuantityAndUnit(segment: string) {
  return /(\d+(?:\.\d+)?|[半一二两三四五六七八九十])(kg|g|ml|l|片|个|只|块|颗|根|杯|碗|份|勺)$/i.test(segment);
}

function splitTokenByWhitespace(token: string) {
  const segments = token.trim().split(/\s+/).filter(Boolean);
  if (segments.length <= 1) {
    return token.trim() ? [token.trim()] : [];
  }

  const tokens: string[] = [];
  let current = "";

  for (const segment of segments) {
    if (!current) {
      current = segment;
      continue;
    }

    const shouldMerge =
      isQuantitySegment(current) ||
      (isUnitSegment(segment) && /(\d+(?:\.\d+)?|[半一二两三四五六七八九十])$/i.test(current)) ||
      (endsWithQuantityAndUnit(current) && !/^(\d+(?:\.\d+)?|[半一二两三四五六七八九十])/i.test(segment));

    if (shouldMerge) {
      current += segment;
      continue;
    }

    tokens.push(current);
    current = segment;
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}

function splitMealTokens(text: string) {
  const chunks: string[] = [];
  let current = "";
  let parenthesisDepth = 0;

  for (const char of text) {
    if (char === "(" || char === "（") {
      parenthesisDepth += 1;
      current += char;
      continue;
    }

    if (char === ")" || char === "）") {
      parenthesisDepth = Math.max(0, parenthesisDepth - 1);
      current += char;
      continue;
    }

    if (parenthesisDepth === 0 && /[，,\/+\n；;、]/.test(char)) {
      const token = current.trim();
      if (token) {
        chunks.push(token);
      }
      current = "";
      continue;
    }

    current += char;
  }

  const finalToken = current.trim();
  if (finalToken) {
    chunks.push(finalToken);
  }

  return chunks.flatMap((chunk) => splitTokenByWhitespace(chunk));
}

export function getFoodLibraryConsistencyIssues() {
  return foodLibrary
    .map((item) => {
      const derivedCalories = calculateCaloriesFromMacros(item.proteinG, item.carbsG, item.fatsG);
      return {
        id: item.id,
        calories: item.calories,
        derivedCalories,
        difference: roundNutrition(derivedCalories - item.calories),
      };
    })
    .filter((item) => Math.abs(item.difference) >= 5);
}

function detectCookingMethodFromText(text: string): MealCookingMethod | undefined {
  const normalized = normalizeLookupToken(text);
  for (const rule of cookingKeywordRules) {
    if (rule.patterns.some((pattern) => normalized.includes(normalizeLookupToken(pattern)))) {
      return rule.method;
    }
  }
  return undefined;
}

export function detectRinseOilFromText(text: string) {
  const normalized = normalizeLookupToken(text);
  return rinseOilKeywords.some((keyword) => normalized.includes(normalizeLookupToken(keyword)));
}

function formatQuantityValue(value: number) {
  return Number.isInteger(value) ? String(value) : String(roundNutrition(value));
}

function formatQuantityLabel(quantity: QuantityInfo) {
  if (quantity.grams != null) {
    return `${formatQuantityValue(quantity.grams)}g`;
  }
  if (quantity.milliliters != null) {
    return `${formatQuantityValue(quantity.milliliters)}ml`;
  }
  return `${formatQuantityValue(quantity.amount)}${quantity.unit}`;
}

function isCookingControlToken(token: string) {
  return cookingControlTokens.has(normalizeLookupToken(token));
}

function toCustomFoodLibrary(customDishes?: NutritionDish[]) {
  const dishes: FoodLibraryItem[] = [];
  for (const dish of customDishes ?? []) {
    const normalizedName = dish.name.trim();
    if (!normalizedName) {
      continue;
    }
    dishes.push({
      id: `custom-${dish.id}`,
      name: normalizedName,
      aliases: dish.aliases.map((alias) => alias.trim()).filter(Boolean),
      category: "custom",
      basis: "perUnit",
      calories: roundNutrition(dish.macros.proteinG * 4 + dish.macros.carbsG * 4 + dish.macros.fatsG * 9),
      proteinG: roundNutrition(dish.macros.proteinG),
      carbsG: roundNutrition(dish.macros.carbsG),
      fatsG: roundNutrition(dish.macros.fatsG),
      supportsCookingOilRule: false,
      defaultServing: { amount: 1, unit: "serving" },
    });
  }
  return dishes;
}

function buildFoodAliasIndex(items: FoodLibraryItem[]) {
  return items
    .flatMap((item) => [item.name, ...item.aliases].map((alias) => ({ alias: normalizeLookupToken(alias), item })))
    .sort((left, right) => right.alias.length - left.alias.length);
}

const comboAliasIndex = comboLibrary
  .flatMap((combo) => [combo.name, ...combo.aliases].map((alias) => ({ alias: normalizeLookupToken(alias), combo })))
  .sort((left, right) => right.alias.length - left.alias.length);

function findFoodMatch(token: string, foodAliasIndex: Array<{ alias: string; item: FoodLibraryItem }>) {
  const normalized = normalizeLookupToken(token);
  return (
    foodAliasIndex.find((entry) => {
      if (entry.alias.length <= 1) {
        return normalized === entry.alias || normalized.endsWith(entry.alias);
      }
      return normalized.includes(entry.alias);
    })?.item ?? null
  );
}

function findComboMatch(token: string) {
  const normalized = normalizeLookupToken(token);
  return comboAliasIndex.find((entry) => normalized.includes(entry.alias))?.combo ?? null;
}

function findContextualFoodMatch(token: string, combos: Array<{ combo: ComboDefinition }>) {
  if (!token.includes("肉")) {
    return null;
  }

  const proteinFoodIds = [
    ...new Set(
      combos.flatMap(({ combo }) =>
        combo.components
          .map((component) => foodLibrary.find((item) => item.id === component.foodId))
          .filter((item): item is FoodLibraryItem => Boolean(item?.supportsCookingOilRule && item.category === "protein"))
          .map((item) => item.id),
      ),
    ),
  ];

  if (proteinFoodIds.length !== 1) {
    return null;
  }

  return foodLibrary.find((item) => item.id === proteinFoodIds[0]) ?? null;
}

function buildInferredTokenMap(estimates?: InferredTokenEstimate[]) {
  const map = new Map<string, InferredTokenEstimate>();
  for (const item of estimates ?? []) {
    const key = normalizeLookupToken(item.token);
    if (!key) {
      continue;
    }
    map.set(key, item);
  }
  return map;
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
  const numericMatches = [...normalized.matchAll(/(\d+(?:\.\d+)?)\s*(kg|g|ml|l|片|个|只|块|颗|根|杯|碗|份|勺)/gi)];
  const chineseMatch = normalized.match(/([半一二两三四五六七八九十])\s*(片|个|只|块|颗|根|杯|碗|份|勺)/);

  const preferredMatch = numericMatches.find((match) => ["kg", "g", "ml", "l"].includes(match[2].toLowerCase())) ?? numericMatches[0];
  if (preferredMatch) {
    const rawAmount = Number(preferredMatch[1]);
    const rawUnit = preferredMatch[2].toLowerCase();
    const mappedUnit = unitMap[rawUnit];
    const normalizedAmount = rawUnit === "kg" || rawUnit === "l" ? rawAmount * 1000 : rawAmount;
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

    if (factor === 0 && quantity.explicit) {
      factor = 1;
    }
  }

  return normalizeNutritionEstimate({
    calories: item.calories * factor,
    proteinG: item.proteinG * factor,
    carbsG: item.carbsG * factor,
    fatsG: item.fatsG * factor,
  });
}

function createParsedItem(item: FoodLibraryItem, sourceText: string, quantity: QuantityInfo, note?: string): ParsedMealItem {
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

function createRuleOilParsedItem(sourceText: string, cookingMethod: MealCookingMethod, retainedOilG: number, rinseOil: boolean): ParsedMealItem {
  const nutrition = normalizeNutritionEstimate({
    calories: (884 * retainedOilG) / 100,
    proteinG: 0,
    carbsG: 0,
    fatsG: retainedOilG,
  });

  return {
    name: "烹调保留油",
    sourceText,
    amount: retainedOilG,
    unit: "g",
    grams: retainedOilG,
    quantitySource: "rule",
    category: "fat",
    calories: nutrition.calories,
    proteinG: nutrition.proteinG,
    carbsG: nutrition.carbsG,
    fatsG: nutrition.fatsG,
    note: rinseOil ? `${cookingOilRules[cookingMethod].label}，按涮油折算` : cookingOilRules[cookingMethod].label,
  };
}

function uniqueWarnings(warnings: string[]) {
  return [...new Set(warnings.filter(Boolean))];
}

function isOilApplicable(params: {
  hasParsedItems: boolean;
  hasComboMatch: boolean;
  oilEligibleCategories: Set<string>;
  cookingMethod?: MealCookingMethod;
}) {
  if (!params.hasParsedItems) {
    return false;
  }

  if (params.cookingMethod) {
    return params.hasComboMatch || params.oilEligibleCategories.size > 0;
  }

  if (params.oilEligibleCategories.size === 0) {
    return false;
  }

  return (
    params.hasComboMatch ||
    (params.oilEligibleCategories.has("protein") && params.oilEligibleCategories.has("vegetable"))
  );
}

function resolveCookingMethod(params: {
  text: string;
  cookingMethod?: MealCookingMethod;
  comboCookingMethods: MealCookingMethod[];
  oilApplicable: boolean;
}): CookingMethodResolution {
  if (!params.oilApplicable) {
    return { source: "none" };
  }
  if (params.cookingMethod) {
    return { method: params.cookingMethod, source: "user" };
  }

  const textMethod = detectCookingMethodFromText(params.text);
  if (textMethod) {
    return { method: textMethod, source: "text" };
  }

  const comboMethod = params.comboCookingMethods[0];
  if (comboMethod) {
    return { method: comboMethod, source: "combo" };
  }

  return { method: "stir_fry_normal", source: "default" };
}

function resolveRetainedOil(cookingMethod: MealCookingMethod, rinseOil: boolean) {
  const baseOilG = cookingOilRules[cookingMethod].baseOilG;
  if (!rinseOil || baseOilG === 0) {
    return baseOilG;
  }

  const discounted = baseOilG * 0.5;
  return roundNutrition(baseOilG >= 4 ? Math.max(2, discounted) : discounted);
}

export function parseMealText(text: string, options: MealParseOptions = {}): MealParseResult {
  const tokens = splitMealTokens(text);
  if (!tokens.length) {
    return {
      parsedItems: [],
      nutritionEstimate: emptyNutrition(),
      analysisWarnings: [],
      unknownTokens: [],
    };
  }

  const customFoodAliasIndex = buildFoodAliasIndex(toCustomFoodLibrary(options.customDishes));
  const regularFoodAliasIndex = buildFoodAliasIndex(foodLibrary);
  const inferredTokenMap = buildInferredTokenMap(options.inferredTokenEstimates);
  const parsedItems: ParsedMealItem[] = [];
  const warnings: string[] = [];
  const unknownTokens: string[] = [];
  const combos: Array<{ combo: ComboDefinition; token: string; count: number }> = [];
  const explicitFoodNames = new Set<string>();
  const comboCookingMethods: MealCookingMethod[] = [];
  const oilEligibleCategories = new Set<string>();

  for (const token of tokens) {
    if (isCookingControlToken(token)) {
      continue;
    }

    const customFood = findFoodMatch(token, customFoodAliasIndex);
    if (customFood) {
      const quantity = parseQuantity(token, customFood);
      parsedItems.push(
        createParsedItem(
          customFood,
          token,
          quantity,
          quantity.explicit ? undefined : `按默认份量估算 ${customFood.defaultServing.amount}${customFood.defaultServing.unit}`,
        ),
      );
      explicitFoodNames.add(customFood.name);
      continue;
    }

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
      if (combo.defaultCookingMethod) {
        comboCookingMethods.push(combo.defaultCookingMethod);
      }
      continue;
    }

    const food = findFoodMatch(token, regularFoodAliasIndex) ?? findContextualFoodMatch(token, combos);
    if (!food) {
      const inferred = inferredTokenMap.get(normalizeLookupToken(token));
      if (inferred) {
        const nutrition = normalizeNutritionEstimate(inferred.nutrition);
        parsedItems.push({
          name: inferred.name?.trim() || token,
          sourceText: token,
          amount: 1,
          unit: "serving",
          quantitySource: "ai",
          category: "ai_inferred",
          calories: nutrition.calories,
          proteinG: nutrition.proteinG,
          carbsG: nutrition.carbsG,
          fatsG: nutrition.fatsG,
          note: "AI估算",
        });
        continue;
      }

      warnings.push(`未识别条目：${token}`);
      unknownTokens.push(token);
      continue;
    }

    const quantity = parseQuantity(token, food);
    const parsedItem = createParsedItem(
      food,
      token,
      quantity,
      quantity.explicit ? undefined : `按默认份量估算 ${food.defaultServing.amount}${food.defaultServing.unit}`,
    );
    parsedItems.push(parsedItem);
    explicitFoodNames.add(food.name);

    if (food.supportsCookingOilRule) {
      oilEligibleCategories.add(food.category);
    }

    if (!quantity.explicit && food.category !== "custom") {
      warnings.push(`${food.name} 未写明份量，按默认份量估算。`);
    }
  }

  for (const comboEntry of combos) {
    const defaultedComponents: string[] = [];
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
      parsedItems.push(createParsedItem(food, comboEntry.token, quantity, `${comboEntry.combo.name} 默认构成`));
      defaultedComponents.push(`${food.name}${formatQuantityLabel(quantity)}`);
      if (food.supportsCookingOilRule) {
        oilEligibleCategories.add(food.category);
      }
    }

    if (defaultedComponents.length > 0) {
      warnings.push(
        `${comboEntry.combo.name} 使用套餐默认补全：${defaultedComponents.join("、")}；若实际克数不同，请继续补充。`,
      );
    }
  }

  const oilApplicable = isOilApplicable({
    hasParsedItems: parsedItems.length > 0,
    hasComboMatch: combos.length > 0,
    oilEligibleCategories,
    cookingMethod: options.cookingMethod,
  });
  const cookingMethodResolution = resolveCookingMethod({
    text,
    cookingMethod: options.cookingMethod,
    comboCookingMethods,
    oilApplicable,
  });
  const rinseOil = options.rinseOil ?? detectRinseOilFromText(text);

  if (cookingMethodResolution.method) {
    if (cookingMethodResolution.source === "text") {
      warnings.push(`未手动选择烹调方式，按文本识别为${cookingOilRules[cookingMethodResolution.method].label}估算保留油。`);
    } else if (cookingMethodResolution.source === "combo") {
      warnings.push(`未手动选择烹调方式，按套餐默认烹调方式 ${cookingOilRules[cookingMethodResolution.method].label} 估算保留油。`);
    } else if (cookingMethodResolution.source === "default") {
      warnings.push("未手动选择烹调方式，按默认正常炒估算保留油。");
    }

    const retainedOilG = resolveRetainedOil(cookingMethodResolution.method, rinseOil);
    if (retainedOilG > 0) {
      parsedItems.push(createRuleOilParsedItem(text, cookingMethodResolution.method, retainedOilG, rinseOil));
      if (rinseOil) {
        warnings.push("已按涮油处理，将保留油按 50% 折算。");
      }
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
    unknownTokens: uniqueWarnings(unknownTokens),
  };
}

function enrichMealEntry(entry: MealLogEntry, options?: MealParseOptions) {
  const parsed = parseMealText(entry.content, {
    ...options,
    cookingMethod: entry.cookingMethod,
    rinseOil: entry.rinseOil,
  });

  return {
    entry: {
      ...entry,
      parsedItems: parsed.parsedItems,
      nutritionEstimate: parsed.nutritionEstimate,
      analysisWarnings: parsed.analysisWarnings,
    } satisfies MealLogEntry,
    unknownTokens: parsed.unknownTokens,
  };
}

function mergeUnknownTokens(chunks: string[]) {
  return uniqueWarnings(chunks);
}

function getEffectiveSlotKeys(mealLog: MealLog) {
  return mealLog.postWorkoutSource === "dedicated"
    ? (["breakfast", "lunch", "dinner", "preWorkout", "postWorkout"] as const)
    : (["breakfast", "lunch", "dinner", "preWorkout"] as const);
}

export function summarizeReportNutrition(
  mealLog: MealLog | undefined,
  targetMacros: NutritionEstimate,
  options: MealParseOptions = {},
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
      unknownTokens: [],
    };
  }

  const breakfastParsed = enrichMealEntry(mealLog.breakfast, options);
  const lunchParsed = enrichMealEntry(mealLog.lunch, options);
  const dinnerParsed = enrichMealEntry(mealLog.dinner, options);
  const preWorkoutParsed = enrichMealEntry(mealLog.preWorkout, options);
  const postWorkoutParsed = enrichMealEntry(mealLog.postWorkout, options);

  const enrichedMealLog: MealLog = {
    ...mealLog,
    breakfast: breakfastParsed.entry,
    lunch: lunchParsed.entry,
    dinner: dinnerParsed.entry,
    preWorkout: preWorkoutParsed.entry,
    postWorkout: postWorkoutParsed.entry,
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

  const nutritionWarnings = uniqueWarnings(slotKeys.flatMap((slot) => enrichedMealLog[slot].analysisWarnings ?? []));
  const unknownTokens = mergeUnknownTokens([
    ...breakfastParsed.unknownTokens,
    ...lunchParsed.unknownTokens,
    ...dinnerParsed.unknownTokens,
    ...preWorkoutParsed.unknownTokens,
    ...postWorkoutParsed.unknownTokens,
  ]);

  return {
    mealLog: enrichedMealLog,
    nutritionTotals,
    nutritionGap,
    nutritionWarnings,
    unknownTokens,
  };
}
