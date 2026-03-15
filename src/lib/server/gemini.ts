import "server-only";

import { GoogleGenerativeAI } from "@google/generative-ai";

import { env } from "@/lib/server/env";
import type { InferredTokenEstimate } from "@/lib/nutrition";
import { describeTrainingReadiness } from "@/lib/server/domain";
import { mealSlotOrder, normalizeMealLog, resolvePostWorkoutEntry, summarizeMealAdherence } from "@/lib/session-report";
import type {
  ChatContextBundle,
  KnowledgeBasis,
  MealLog,
  MealLogEntry,
  MealPrescription,
  NutritionDish,
  NutritionEstimate,
  ParsedMealItem,
  SessionReport,
} from "@/lib/types";

function stripCodeFence(input: string) {
  return input.replace(/^```(?:markdown)?\s*/i, "").replace(/\s*```$/, "").trim();
}

function normalizeJsonLikeModelOutput(input: string) {
  const normalized = stripCodeFence(input).trim();
  return normalized.replace(/^json\s*/i, "").trim();
}

function tryParseJsonCandidate(input: string) {
  try {
    return JSON.parse(input) as unknown;
  } catch {
    return undefined;
  }
}

function parseJsonLikeModelOutput(input: string) {
  const normalized = normalizeJsonLikeModelOutput(input);
  const direct = tryParseJsonCandidate(normalized);
  if (direct !== undefined) {
    return direct;
  }

  const firstObject = normalized.indexOf("{");
  const lastObject = normalized.lastIndexOf("}");
  if (firstObject >= 0 && lastObject > firstObject) {
    const objectCandidate = normalized.slice(firstObject, lastObject + 1).trim();
    const objectParsed = tryParseJsonCandidate(objectCandidate);
    if (objectParsed !== undefined) {
      return objectParsed;
    }
  }

  const firstArray = normalized.indexOf("[");
  const lastArray = normalized.lastIndexOf("]");
  if (firstArray >= 0 && lastArray > firstArray) {
    const arrayCandidate = normalized.slice(firstArray, lastArray + 1).trim();
    const arrayParsed = tryParseJsonCandidate(arrayCandidate);
    if (arrayParsed !== undefined) {
      return arrayParsed;
    }
  }

  throw new Error("AI response is not valid JSON.");
}

function hasStrictCoachShape(input: string) {
  const normalized = stripCodeFence(input);
  return (
    normalized.includes("1. 结论") &&
    normalized.includes("2. 分析依据") &&
    normalized.includes("3. 结合我的情况") &&
    normalized.includes("4. 实际建议") &&
    normalized.includes("5. 延伸提醒")
  );
}

function hasStrictDailyReviewShape(input: string) {
  const normalized = stripCodeFence(input);
  return (
    normalized.includes("1. 📊 数据核算") &&
    normalized.includes("2. 🏋️ 训练评估") &&
    normalized.includes("3. 🎯 质量评级") &&
    normalized.includes("4. ⚡ 行动建议")
  );
}

function formatEstimateLine(calories: number, proteinG: number, carbsG: number, fatsG: number) {
  return `${calories} kcal / P ${proteinG} / C ${carbsG} / F ${fatsG}`;
}

function toNonNegativeNumber(value: unknown) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return null;
  }
  return Math.max(0, Math.round(value * 10) / 10);
}

type MealSlotKey = (typeof mealSlotOrder)[number];

type MealSlotNutritionOutput = {
  nutritionEstimate: NutritionEstimate;
  parsedItems: ParsedMealItem[];
  analysisWarnings: string[];
};

type MealLogNutritionComputationReady = {
  status: "ready";
  mealLog: MealLog;
  nutritionTotals: NutritionEstimate;
  nutritionGap: NutritionEstimate;
  nutritionWarnings: string[];
  computedAt: string;
};

type MealLogNutritionComputationPending = {
  status: "pending";
  mealLog: MealLog;
  nutritionWarnings: string[];
  error: string;
};

export type MealLogNutritionComputation = MealLogNutritionComputationReady | MealLogNutritionComputationPending;

function roundNutrition(value: number) {
  return Math.round(value * 10) / 10;
}

function emptyNutritionEstimate(): NutritionEstimate {
  return {
    calories: 0,
    proteinG: 0,
    carbsG: 0,
    fatsG: 0,
  };
}

function addNutritionEstimate(base: NutritionEstimate, extra: NutritionEstimate): NutritionEstimate {
  return {
    calories: roundNutrition(base.calories + extra.calories),
    proteinG: roundNutrition(base.proteinG + extra.proteinG),
    carbsG: roundNutrition(base.carbsG + extra.carbsG),
    fatsG: roundNutrition(base.fatsG + extra.fatsG),
  };
}

function sanitizeNutritionEstimate(value: unknown) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const calories = toNonNegativeNumber((value as { calories?: unknown }).calories);
  const proteinG = toNonNegativeNumber((value as { proteinG?: unknown }).proteinG);
  const carbsG = toNonNegativeNumber((value as { carbsG?: unknown }).carbsG);
  const fatsG = toNonNegativeNumber((value as { fatsG?: unknown }).fatsG);
  if (calories == null || proteinG == null || carbsG == null || fatsG == null) {
    return null;
  }
  return {
    calories,
    proteinG,
    carbsG,
    fatsG,
  } satisfies NutritionEstimate;
}

function sanitizeParsedItems(value: unknown, sourceText: string) {
  if (!Array.isArray(value)) {
    return [] as ParsedMealItem[];
  }
  const parsed: ParsedMealItem[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const name = typeof (item as { name?: unknown }).name === "string" ? (item as { name: string }).name.trim() : "";
    const nutrition = sanitizeNutritionEstimate(item);
    if (!name || !nutrition) {
      continue;
    }
    const amount = toNonNegativeNumber((item as { amount?: unknown }).amount) ?? 1;
    const unit =
      typeof (item as { unit?: unknown }).unit === "string" && (item as { unit: string }).unit.trim().length > 0
        ? (item as { unit: string }).unit.trim()
        : "serving";
    const grams = toNonNegativeNumber((item as { grams?: unknown }).grams) ?? undefined;
    const milliliters = toNonNegativeNumber((item as { milliliters?: unknown }).milliliters) ?? undefined;
    const category =
      typeof (item as { category?: unknown }).category === "string" && (item as { category: string }).category.trim().length > 0
        ? (item as { category: string }).category.trim()
        : "ai_inferred";
    parsed.push({
      name,
      sourceText:
        typeof (item as { sourceText?: unknown }).sourceText === "string" && (item as { sourceText: string }).sourceText.trim().length > 0
          ? (item as { sourceText: string }).sourceText.trim()
          : sourceText,
      amount,
      unit,
      grams,
      milliliters,
      quantitySource: "ai",
      category,
      calories: nutrition.calories,
      proteinG: nutrition.proteinG,
      carbsG: nutrition.carbsG,
      fatsG: nutrition.fatsG,
      note: "AI估算",
    });
  }
  return parsed;
}

function sanitizeWarnings(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as string[];
  }
  return [...new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))];
}

function buildDishContextLines(dishes: NutritionDish[]) {
  if (!dishes.length) {
    return ["- none"];
  }
  return dishes.map((dish) => {
    const aliases = dish.aliases.length ? ` | aliases: ${dish.aliases.join(", ")}` : "";
    return `- ${dish.name}${aliases} | per serving: kcal ${roundNutrition(
      dish.macros.proteinG * 4 + dish.macros.carbsG * 4 + dish.macros.fatsG * 9,
    )}, protein ${dish.macros.proteinG}g, carbs ${dish.macros.carbsG}g, fats ${dish.macros.fatsG}g`;
  });
}

function getEffectiveMealKeys(mealLog: MealLog): MealSlotKey[] {
  return mealLog.postWorkoutSource === "dedicated"
    ? (["breakfast", "lunch", "dinner", "preWorkout", "postWorkout"] as MealSlotKey[])
    : (["breakfast", "lunch", "dinner", "preWorkout"] as MealSlotKey[]);
}

function pendingNutritionResult(mealLog: MealLog, error: string): MealLogNutritionComputationPending {
  const message = "营养待 AI 计算，请稍后重试保存。";
  return {
    status: "pending",
    mealLog,
    nutritionWarnings: error ? [message, error] : [message],
    error,
  };
}

export async function computeMealLogNutritionWithGemini(params: {
  mealLog: MealLog;
  targetNutrition: NutritionEstimate;
  nutritionDishes: NutritionDish[];
}): Promise<MealLogNutritionComputation> {
  if (!env.geminiApiKey) {
    return pendingNutritionResult(params.mealLog, "GEMINI_API_KEY 未配置。");
  }

  const client = new GoogleGenerativeAI(env.geminiApiKey);
  const model = client.getGenerativeModel({ model: env.geminiModel });
  const prompt = [
    "You are a nutrition parser and estimator.",
    "Reply with pure JSON only. No markdown, no prose.",
    "Use Chinese food context.",
    "Use custom dishes as prior when names or aliases match.",
    "When quantity is explicit in text, estimate by that quantity.",
    "Return all five meal slots exactly: breakfast, lunch, dinner, preWorkout, postWorkout.",
    "JSON shape:",
    `{"meals":{"breakfast":{"nutritionEstimate":{"calories":0,"proteinG":0,"carbsG":0,"fatsG":0},"parsedItems":[{"name":"string","amount":1,"unit":"serving","grams":0,"milliliters":0,"category":"string","calories":0,"proteinG":0,"carbsG":0,"fatsG":0}],"analysisWarnings":["string"]},"lunch":{"nutritionEstimate":{"calories":0,"proteinG":0,"carbsG":0,"fatsG":0},"parsedItems":[],"analysisWarnings":[]},"dinner":{"nutritionEstimate":{"calories":0,"proteinG":0,"carbsG":0,"fatsG":0},"parsedItems":[],"analysisWarnings":[]},"preWorkout":{"nutritionEstimate":{"calories":0,"proteinG":0,"carbsG":0,"fatsG":0},"parsedItems":[],"analysisWarnings":[]},"postWorkout":{"nutritionEstimate":{"calories":0,"proteinG":0,"carbsG":0,"fatsG":0},"parsedItems":[],"analysisWarnings":[]}},"nutritionWarnings":["string"]}`,
    "All numeric fields must be non-negative numbers.",
    "Meal slot input:",
    `postWorkoutSource: ${params.mealLog.postWorkoutSource}`,
    `breakfast: ${params.mealLog.breakfast.content || "未填写"}`,
    `lunch: ${params.mealLog.lunch.content || "未填写"}`,
    `dinner: ${params.mealLog.dinner.content || "未填写"}`,
    `preWorkout: ${params.mealLog.preWorkout.content || "未填写"}`,
    `postWorkout: ${params.mealLog.postWorkout.content || "未填写"}`,
    "Custom dishes (per serving):",
    ...buildDishContextLines(params.nutritionDishes),
  ].join("\n");

  try {
    const result = await model.generateContent(prompt);
    const parsed = parseJsonLikeModelOutput(result.response.text());
    if (!parsed || typeof parsed !== "object") {
      return pendingNutritionResult(params.mealLog, "AI 返回格式无效。");
    }

    const meals = (parsed as { meals?: unknown }).meals;
    if (!meals || typeof meals !== "object") {
      return pendingNutritionResult(params.mealLog, "AI 未返回 meals 结构。");
    }

    const nextMealLog: MealLog = {
      ...params.mealLog,
      breakfast: { ...params.mealLog.breakfast },
      lunch: { ...params.mealLog.lunch },
      dinner: { ...params.mealLog.dinner },
      preWorkout: { ...params.mealLog.preWorkout },
      postWorkout: { ...params.mealLog.postWorkout },
    };

    const mealOutput: Record<MealSlotKey, MealSlotNutritionOutput> = {
      breakfast: { nutritionEstimate: emptyNutritionEstimate(), parsedItems: [], analysisWarnings: [] },
      lunch: { nutritionEstimate: emptyNutritionEstimate(), parsedItems: [], analysisWarnings: [] },
      dinner: { nutritionEstimate: emptyNutritionEstimate(), parsedItems: [], analysisWarnings: [] },
      preWorkout: { nutritionEstimate: emptyNutritionEstimate(), parsedItems: [], analysisWarnings: [] },
      postWorkout: { nutritionEstimate: emptyNutritionEstimate(), parsedItems: [], analysisWarnings: [] },
    };

    for (const slot of mealSlotOrder) {
      const slotValue = (meals as Record<string, unknown>)[slot];
      if (!slotValue || typeof slotValue !== "object") {
        return pendingNutritionResult(params.mealLog, `AI 缺少 ${slot} 槽位结果。`);
      }
      const nutritionEstimate = sanitizeNutritionEstimate((slotValue as { nutritionEstimate?: unknown }).nutritionEstimate);
      if (!nutritionEstimate) {
        return pendingNutritionResult(params.mealLog, `AI ${slot} 槽位营养数据无效。`);
      }
      const sourceText = nextMealLog[slot].content || slot;
      mealOutput[slot] = {
        nutritionEstimate,
        parsedItems: sanitizeParsedItems((slotValue as { parsedItems?: unknown }).parsedItems, sourceText),
        analysisWarnings: sanitizeWarnings((slotValue as { analysisWarnings?: unknown }).analysisWarnings),
      };
      (nextMealLog[slot] as MealLogEntry).nutritionEstimate = nutritionEstimate;
      (nextMealLog[slot] as MealLogEntry).parsedItems = mealOutput[slot].parsedItems;
      (nextMealLog[slot] as MealLogEntry).analysisWarnings = mealOutput[slot].analysisWarnings;
    }

    const effectiveKeys = getEffectiveMealKeys(nextMealLog);
    const nutritionTotals = effectiveKeys.reduce(
      (sum, slot) => addNutritionEstimate(sum, mealOutput[slot].nutritionEstimate),
      emptyNutritionEstimate(),
    );
    const nutritionGap = {
      calories: roundNutrition(nutritionTotals.calories - params.targetNutrition.calories),
      proteinG: roundNutrition(nutritionTotals.proteinG - params.targetNutrition.proteinG),
      carbsG: roundNutrition(nutritionTotals.carbsG - params.targetNutrition.carbsG),
      fatsG: roundNutrition(nutritionTotals.fatsG - params.targetNutrition.fatsG),
    };
    const slotWarnings = effectiveKeys.flatMap((slot) => mealOutput[slot].analysisWarnings);
    const reportWarnings = sanitizeWarnings((parsed as { nutritionWarnings?: unknown }).nutritionWarnings);

    return {
      status: "ready",
      mealLog: nextMealLog,
      nutritionTotals,
      nutritionGap,
      nutritionWarnings: [...new Set([...reportWarnings, ...slotWarnings])],
      computedAt: new Date().toISOString(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI 营养计算失败。";
    return pendingNutritionResult(params.mealLog, message);
  }
}

export async function generateGeminiCoachReply(params: {
  message: string;
  context: ChatContextBundle;
  basis: KnowledgeBasis[];
}) {
  if (!env.geminiApiKey) {
    return null;
  }

  const client = new GoogleGenerativeAI(env.geminiApiKey);
  const model = client.getGenerativeModel({ model: env.geminiModel });
  const knowledgeLines = params.context.retrievedKnowledge.length
    ? params.context.retrievedKnowledge.map((chunk) => `- ${chunk.title}: ${chunk.content}`)
    : ["- none"];
  const recentMessageLines = params.context.recentMessages.length
    ? params.context.recentMessages.map((message) => `- ${message.role}: ${message.content}`)
    : ["- none"];
  const basisLines = params.basis.length
    ? params.basis.map((item) => `- [${item.type}] ${item.label}: ${item.excerpt}`)
    : ["- none"];

  const prompt = [
    "You are FitCoach.",
    "Reply in Simplified Chinese.",
    "Sound like a knowledgeable training friend, not customer support.",
    "Use the handbook as a reference when useful, but do not depend on it mechanically.",
    "You must output strictly in this markdown structure and must not add any extra section, preface, or closing paragraph:",
    "1. 结论",
    "- Directly answer which option is better, or whether you recommend it.",
    "2. 分析依据",
    "- Analyze from goal fit / nutrition structure or training stimulus / fatigue cost / practicality / long-term return.",
    "3. 结合我的情况",
    "- Explain using the user's current weight, goal, split, handbook logic, equipment limits, and latest report status.",
    "4. 实际建议",
    "- Tell the user what to choose, when to use it, and how to substitute it.",
    "5. 延伸提醒",
    "- Give one mistake to avoid, one judging criterion, or one useful follow-up question.",
    "When the user asks about today, today's diet, today's training, or asks '怎么样', you must first analyze recorded data.",
    `Today's date is ${params.context.currentDate}.`,
    params.context.latestReportDate
      ? `Latest recorded report date is ${params.context.latestReportDate}.`
      : "There is no recorded report yet.",
    params.context.latestReportIsToday
      ? "The latest recorded report is for today."
      : "Do not pretend the latest recorded report is today's report if the dates differ. State the date mismatch clearly in section 3.",
    "If the user asks only about diet completion, stay focused on diet adherence, completeness, likely gap, and the next correction.",
    "If the current data is enough, do not tell the user to generate today's prescription first.",
    "Only ask for more data if the current record truly cannot answer the question.",
    "",
    `Persona name: ${params.context.persona.name}`,
    `Persona voice: ${params.context.persona.voice}`,
    `Persona mission: ${params.context.persona.mission}`,
    `Current goal: ${params.context.activeGoal}`,
    `Plan summary: ${params.context.activePlanSummary}`,
    `Latest report detail: ${params.context.latestReportSummary}`,
    `Recent execution summary: ${params.context.recentReportSummary}`,
    "Relevant knowledge:",
    ...knowledgeLines,
    "Recent conversation:",
    ...recentMessageLines,
    "Explicit basis:",
    ...basisLines,
    "",
    `User question: ${params.message}`,
  ].join("\n");

  const result = await model.generateContent(prompt);
  const text = stripCodeFence(result.response.text());
  return hasStrictCoachShape(text) ? text : null;
}

export async function generateGeminiDailyReview(params: {
  report: SessionReport;
  targetMacros: MealPrescription["macros"];
  planLabel: string;
  workoutTitle: string;
  draftReview: string;
}) {
  if (!env.geminiApiKey) {
    return null;
  }

  const client = new GoogleGenerativeAI(env.geminiApiKey);
  const model = client.getGenerativeModel({ model: env.geminiModel });
  const mealLog = normalizeMealLog(params.report.mealLog);
  const effectivePostWorkout = mealLog ? resolvePostWorkoutEntry(mealLog) : null;
  const mealSummary = summarizeMealAdherence(mealLog);
  const nutritionStatus =
    params.report.nutritionComputation?.status ??
    (params.report.nutritionTotals && params.report.nutritionGap ? "ready" : "pending");
  const nutritionPending = nutritionStatus === "pending";
  const targetCalories = params.targetMacros.proteinG * 4 + params.targetMacros.carbsG * 4 + params.targetMacros.fatsG * 9;
  const mealBreakdownLines = !nutritionPending && mealLog
    ? [
        `Breakfast nutrition: ${formatEstimateLine(
          mealLog.breakfast.nutritionEstimate?.calories ?? 0,
          mealLog.breakfast.nutritionEstimate?.proteinG ?? 0,
          mealLog.breakfast.nutritionEstimate?.carbsG ?? 0,
          mealLog.breakfast.nutritionEstimate?.fatsG ?? 0,
        )}`,
        `Lunch nutrition: ${formatEstimateLine(
          mealLog.lunch.nutritionEstimate?.calories ?? 0,
          mealLog.lunch.nutritionEstimate?.proteinG ?? 0,
          mealLog.lunch.nutritionEstimate?.carbsG ?? 0,
          mealLog.lunch.nutritionEstimate?.fatsG ?? 0,
        )}`,
        `Dinner nutrition: ${formatEstimateLine(
          mealLog.dinner.nutritionEstimate?.calories ?? 0,
          mealLog.dinner.nutritionEstimate?.proteinG ?? 0,
          mealLog.dinner.nutritionEstimate?.carbsG ?? 0,
          mealLog.dinner.nutritionEstimate?.fatsG ?? 0,
        )}`,
        `Pre-workout nutrition: ${formatEstimateLine(
          mealLog.preWorkout.nutritionEstimate?.calories ?? 0,
          mealLog.preWorkout.nutritionEstimate?.proteinG ?? 0,
          mealLog.preWorkout.nutritionEstimate?.carbsG ?? 0,
          mealLog.preWorkout.nutritionEstimate?.fatsG ?? 0,
        )}`,
        `Post-workout nutrition: ${formatEstimateLine(
          effectivePostWorkout?.nutritionEstimate?.calories ?? 0,
          effectivePostWorkout?.nutritionEstimate?.proteinG ?? 0,
          effectivePostWorkout?.nutritionEstimate?.carbsG ?? 0,
          effectivePostWorkout?.nutritionEstimate?.fatsG ?? 0,
        )}`,
      ]
    : ["Nutrition is pending AI computation. Do not fabricate numeric meal breakdown."];

  const prompt = [
    "You are FitCoach's daily review editor.",
    "Reply in Simplified Chinese.",
    "You must polish the existing draft review only.",
    "You must output strictly in this markdown structure and must not add any extra paragraph:",
    "1. 📊 数据核算",
    "- 估算摄入：总热量(kcal) / 蛋白质(g) / 碳水(g) / 脂肪(g)",
    "- 缺口分析：距离目标还差多少，或超标多少",
    "- 每餐拆解：早餐/午餐/晚餐/练前/练后，逐餐给出 kcal 与 P/C/F",
    "2. 🏋️ 训练评估",
    "- 超负荷状态：[达标 / 停滞 / 需减载]",
    "- 简要评价：（一句话点评今日训练质量）",
    "3. 🎯 质量评级",
    "- [🟢 完美 / 🟡 警告 / 🔴 灾难]（仅保留一个，并附一句理由）",
    "4. ⚡ 行动建议",
    "- 仅限1-3条",
    "- 必须具体、直接、可执行",
    "Rating rules:",
    "- 🟢 完美：营养目标总体偏差在±10%内，训练完成度高，无明显违规",
    "- 🟡 警告：任一关键指标偏差10%–25%，或训练质量一般，或存在轻度违规",
    "- 🔴 灾难：任一关键指标偏差超过25%，或出现饮酒、暴食、明显漏训、持续疲劳等重大问题",
    "Do not add theory dump. Do not add narrative before section 1 or after section 4.",
    nutritionPending
      ? "If nutrition status is pending, section 1 must explicitly state nutrition is pending AI computation and must not include fabricated numeric totals or gaps."
      : "Use provided numeric nutrition data for section 1 and keep numbers internally consistent.",
    "",
    `Plan label: ${params.planLabel}`,
    `Workout title: ${params.workoutTitle}`,
    `Target intake: ${targetCalories} kcal / ${params.targetMacros.proteinG} g protein / ${params.targetMacros.carbsG} g carbs / ${params.targetMacros.fatsG} g fats`,
    `Nutrition status: ${nutritionStatus}`,
    nutritionPending
      ? "Aggregated nutrition totals: pending"
      : `Aggregated nutrition totals: ${params.report.nutritionTotals?.calories ?? 0} kcal / ${params.report.nutritionTotals?.proteinG ?? 0} g protein / ${params.report.nutritionTotals?.carbsG ?? 0} g carbs / ${params.report.nutritionTotals?.fatsG ?? 0} g fats`,
    `Meal summary: on plan ${mealSummary.onPlan} / adjusted ${mealSummary.adjusted} / missed ${mealSummary.missed}`,
    `Breakfast: ${mealLog?.breakfast.content || "未填写"}`,
    `Lunch: ${mealLog?.lunch.content || "未填写"}`,
    `Dinner: ${mealLog?.dinner.content || "未填写"}`,
    `Pre-workout meal: ${mealLog?.preWorkout.content || "未填写"}`,
    `Post-workout meal: ${effectivePostWorkout?.content || "未填写"}`,
    "Per-meal nutrition breakdown:",
    ...mealBreakdownLines,
    `Training notes: ${params.report.trainingReportText || "未填写"}`,
    `Body weight: ${params.report.bodyWeightKg} kg`,
    `Sleep: ${params.report.sleepHours} h`,
    `Fatigue: ${params.report.fatigue}/10`,
    `Next-day readiness: ${params.report.nextDayDecision ? describeTrainingReadiness(params.report.nextDayDecision.trainingReadiness) : "未生成"}`,
    "",
    "Polish this draft review directly:",
    params.draftReview,
  ].join("\n");

  const result = await model.generateContent(prompt);
  const text = stripCodeFence(result.response.text());
  return hasStrictDailyReviewShape(text) ? text : null;
}

export async function inferUnknownMealTokensWithGemini(tokens: string[]): Promise<InferredTokenEstimate[]> {
  if (!env.geminiApiKey || !tokens.length) {
    return [];
  }

  const client = new GoogleGenerativeAI(env.geminiApiKey);
  const model = client.getGenerativeModel({ model: env.geminiModel });
  const dedupedTokens = [...new Set(tokens.map((item) => item.trim()).filter(Boolean))];
  if (!dedupedTokens.length) {
    return [];
  }

  const prompt = [
    "You are a nutrition estimator.",
    "Reply with pure JSON only. No markdown.",
    "If quantity is provided in token (e.g., 270g, 2个, 一只), estimate by that amount.",
    "Only use one serving when quantity is not provided.",
    "Output JSON array with this shape:",
    `[{"token":"string","name":"string","calories":number,"proteinG":number,"carbsG":number,"fatsG":number}]`,
    "All nutrient values must be non-negative numbers.",
    "Tokens to estimate:",
    ...dedupedTokens.map((token) => `- ${token}`),
  ].join("\n");

  try {
    const result = await model.generateContent(prompt);
    const parsed = parseJsonLikeModelOutput(result.response.text());
    if (!Array.isArray(parsed)) {
      return [];
    }

    const estimates: InferredTokenEstimate[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") {
        continue;
      }
      const token = typeof (item as { token?: unknown }).token === "string" ? (item as { token: string }).token.trim() : "";
      if (!token) {
        continue;
      }
      const calories = toNonNegativeNumber((item as { calories?: unknown }).calories);
      const proteinG = toNonNegativeNumber((item as { proteinG?: unknown }).proteinG);
      const carbsG = toNonNegativeNumber((item as { carbsG?: unknown }).carbsG);
      const fatsG = toNonNegativeNumber((item as { fatsG?: unknown }).fatsG);
      if (calories == null || proteinG == null || carbsG == null || fatsG == null) {
        continue;
      }
      estimates.push({
        token,
        name: typeof (item as { name?: unknown }).name === "string" ? ((item as { name: string }).name.trim() || token) : token,
        nutrition: {
          calories,
          proteinG,
          carbsG,
          fatsG,
        },
      });
    }
    return estimates;
  } catch {
    return [];
  }
}
