import "server-only";

import { GoogleGenerativeAI } from "@google/generative-ai";

import { summarizeReportNutrition } from "@/lib/nutrition";
import { env } from "@/lib/server/env";
import type { InferredTokenEstimate } from "@/lib/nutrition";
import { buildDailyReviewCoachingFacts, describeTrainingReadiness } from "@/lib/server/domain";
import { mealSlotLabels, normalizeMealLog, resolvePostWorkoutEntry, summarizeMealAdherence } from "@/lib/session-report";
import type {
  ChatContextBundle,
  KnowledgeBasis,
  MealLog,
  MealSlot,
  MealPrescription,
  NutritionDish,
  NutritionEstimate,
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
    normalized.includes("1. 今日结论") &&
    normalized.includes("2. 关键证据") &&
    normalized.includes("3. 最大瓶颈") &&
    normalized.includes("4. 明天执行")
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

function pendingNutritionResult(mealLog: MealLog, error: string): MealLogNutritionComputationPending {
  const message = "营养待 AI 计算，请稍后重试保存。";
  return {
    status: "pending",
    mealLog,
    nutritionWarnings: error ? [message, error] : [message],
    error,
  };
}

function readyNutritionResult(params: {
  mealLog: MealLog;
  nutritionTotals: NutritionEstimate;
  nutritionGap: NutritionEstimate;
  nutritionWarnings: string[];
}): MealLogNutritionComputationReady {
  return {
    status: "ready",
    mealLog: params.mealLog,
    nutritionTotals: params.nutritionTotals,
    nutritionGap: params.nutritionGap,
    nutritionWarnings: params.nutritionWarnings,
    computedAt: new Date().toISOString(),
  };
}

export async function computeMealLogNutritionWithGemini(params: {
  mealLog: MealLog;
  activeMealSlots?: MealSlot[];
  targetNutrition: NutritionEstimate;
  nutritionDishes: NutritionDish[];
}): Promise<MealLogNutritionComputation> {
  const baseSummary = summarizeReportNutrition(params.mealLog, params.targetNutrition, {
    customDishes: params.nutritionDishes,
    activeMealSlots: params.activeMealSlots,
  });

  if (!baseSummary.unknownTokens.length) {
    return readyNutritionResult({
      mealLog: baseSummary.mealLog ?? params.mealLog,
      nutritionTotals: baseSummary.nutritionTotals,
      nutritionGap: baseSummary.nutritionGap,
      nutritionWarnings: baseSummary.nutritionWarnings,
    });
  }

  if (!env.geminiApiKey) {
    return pendingNutritionResult(baseSummary.mealLog ?? params.mealLog, "GEMINI_API_KEY 未配置。");
  }

  try {
    const inferredTokenEstimates = await inferUnknownMealTokensWithGemini(baseSummary.unknownTokens);
    const unresolvedTokens = baseSummary.unknownTokens.filter(
      (token) => !inferredTokenEstimates.some((estimate) => estimate.token.trim() === token.trim()),
    );
    const finalSummary = summarizeReportNutrition(params.mealLog, params.targetNutrition, {
      customDishes: params.nutritionDishes,
      inferredTokenEstimates,
      activeMealSlots: params.activeMealSlots,
    });
    const extraWarnings = unresolvedTokens.length
      ? [`以下条目仍未识别，未计入营养汇总：${unresolvedTokens.join("、")}`]
      : [];

    return readyNutritionResult({
      mealLog: finalSummary.mealLog ?? params.mealLog,
      nutritionTotals: finalSummary.nutritionTotals,
      nutritionGap: finalSummary.nutritionGap,
      nutritionWarnings: [...new Set([...finalSummary.nutritionWarnings, ...extraWarnings])],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI 营养计算失败。";
    return pendingNutritionResult(baseSummary.mealLog ?? params.mealLog, message);
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
  activeMealSlots?: MealSlot[];
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
  const activeMealSlots = params.activeMealSlots ?? params.report.mealSlots ?? ["breakfast", "lunch", "dinner", "preWorkout", "postWorkout"];
  const mealSummary = summarizeMealAdherence(mealLog, activeMealSlots);
  const nutritionStatus =
    params.report.nutritionComputation?.status ??
    (params.report.nutritionTotals && params.report.nutritionGap ? "ready" : "pending");
  const nutritionPending = nutritionStatus === "pending";
  const targetCalories = params.targetMacros.proteinG * 4 + params.targetMacros.carbsG * 4 + params.targetMacros.fatsG * 9;
  const coachingFacts = buildDailyReviewCoachingFacts({
    report: params.report,
    targetMacros: params.targetMacros,
    nextDayDecision: params.report.nextDayDecision,
  });
  const mealBreakdownLines = !nutritionPending && mealLog
    ? activeMealSlots.map((slot) => {
        const entry = slot === "postWorkout" ? effectivePostWorkout : mealLog[slot];
        return `${mealSlotLabels[slot]} nutrition: ${formatEstimateLine(
          entry?.nutritionEstimate?.calories ?? 0,
          entry?.nutritionEstimate?.proteinG ?? 0,
          entry?.nutritionEstimate?.carbsG ?? 0,
          entry?.nutritionEstimate?.fatsG ?? 0,
        )}`;
      })
    : ["Nutrition is pending AI computation. Do not fabricate numeric meal breakdown."];

  const prompt = [
    "You are FitCoach's daily review diagnostician.",
    "Reply in Simplified Chinese.",
    "Do not polish the draft mechanically. Use the structured facts to decide the main bottleneck and the next action.",
    "You must output strictly in this markdown structure and must not add any extra paragraph:",
    "1. 今日结论",
    "- One direct coaching conclusion. Include the rating and tomorrow readiness if relevant.",
    "2. 关键证据",
    "- 3 to 5 bullets. Use concrete recorded data, not generic theory.",
    "3. 最大瓶颈",
    "- One bullet only. Name the single highest-priority problem that limits tomorrow's execution.",
    "4. 明天执行",
    "- 1 to 3 bullets only. Every bullet must be specific and executable.",
    "Rules:",
    "- Do not ask for data that is already present in the report.",
    "- Do not say broad advice like 保持饮食/注意休息 unless it is tied to a concrete meal, lift, pain note, sleep, fatigue, or macro gap.",
    "- Prefer correcting the largest bottleneck over listing every possible issue.",
    "- If pain or discomfort is recorded, treat it as higher priority than normal progression.",
    nutritionPending
      ? "Nutrition status is pending. State that numeric nutrition is pending and do not fabricate totals or gaps."
      : "Use provided numeric nutrition data. Calories must stay consistent with listed P/C/F using the 4/4/9 rule.",
    "",
    "Computed coaching facts:",
    `Conclusion: ${coachingFacts.conclusion}`,
    "Evidence:",
    ...coachingFacts.evidence.map((item) => `- ${item}`),
    `Primary bottleneck: ${coachingFacts.bottleneck}`,
    "Recommended actions:",
    ...coachingFacts.actionItems.map((item) => `- ${item}`),
    "",
    "Raw report context:",
    `Plan label: ${params.planLabel}`,
    `Workout title: ${params.workoutTitle}`,
    `Target intake: ${targetCalories} kcal / ${params.targetMacros.proteinG} g protein / ${params.targetMacros.carbsG} g carbs / ${params.targetMacros.fatsG} g fats`,
    `Nutrition status: ${nutritionStatus}`,
    nutritionPending
      ? "Aggregated nutrition totals: pending"
      : `Aggregated nutrition totals: ${params.report.nutritionTotals?.calories ?? 0} kcal / ${params.report.nutritionTotals?.proteinG ?? 0} g protein / ${params.report.nutritionTotals?.carbsG ?? 0} g carbs / ${params.report.nutritionTotals?.fatsG ?? 0} g fats`,
    `Meal summary: on plan ${mealSummary.onPlan} / adjusted ${mealSummary.adjusted} / missed ${mealSummary.missed}`,
    ...activeMealSlots.map((slot) => {
      const entry = slot === "postWorkout" ? effectivePostWorkout : mealLog?.[slot];
      return `${mealSlotLabels[slot]}: ${entry?.content || "未填写"}`;
    }),
    "Per-meal nutrition breakdown:",
    ...mealBreakdownLines,
    `Training notes: ${params.report.trainingReportText || "未填写"}`,
    `Body weight: ${params.report.bodyWeightKg} kg`,
    `Sleep: ${params.report.sleepHours} h`,
    `Fatigue: ${params.report.fatigue}/10`,
    `Pain notes: ${params.report.painNotes || "未填写"}`,
    `Recovery notes: ${params.report.recoveryNote || "未填写"}`,
    `Next-day readiness: ${params.report.nextDayDecision ? describeTrainingReadiness(params.report.nextDayDecision.trainingReadiness) : "未生成"}`,
    "",
    "Existing deterministic draft for reference only. Do not copy it mechanically:",
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
    "Use Chinese food context and keep the estimate conservative.",
    "If quantity is provided in token (e.g., 270g, 2个, 一只), estimate by that amount.",
    "Only use one serving when quantity is not provided.",
    "Keep calories roughly consistent with macros: calories should be close to proteinG*4 + carbsG*4 + fatsG*9.",
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
