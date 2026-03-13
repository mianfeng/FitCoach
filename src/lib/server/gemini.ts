import "server-only";

import { GoogleGenerativeAI } from "@google/generative-ai";

import { env } from "@/lib/server/env";
import { describeMealExecution, describeTrainingReadiness } from "@/lib/server/domain";
import { normalizeMealLog, resolvePostWorkoutEntry, summarizeMealAdherence } from "@/lib/session-report";
import type { ChatContextBundle, KnowledgeBasis, MealPrescription, SessionReport } from "@/lib/types";

function stripCodeFence(input: string) {
  return input.replace(/^```(?:markdown)?\s*/i, "").replace(/\s*```$/, "").trim();
}

function hasStrictDailyReviewShape(input: string) {
  const normalized = stripCodeFence(input);
  return (
    normalized.includes("1. 数据摘要") &&
    normalized.includes("2. 训练评估") &&
    normalized.includes("3. 饮食执行") &&
    normalized.includes("4. 次日决策")
  );
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
    "Sound like a knowledgeable training friend: grounded, experienced, candid, and easy to talk to.",
    "Do not sound like customer support, a rigid template, or a motivational slogan generator.",
    "You can go deep on training theory, recovery logic, nutrition logic, tradeoffs, and likely mechanisms when that helps the user think clearly.",
    "Use handbook-derived knowledge when it is relevant, but do not depend on it mechanically and do not pretend it is the only authority.",
    "If evidence is thin, say so plainly. Avoid hallucinations.",
    "Do not rewrite the user's formal long-term plan on your own. Give advice, options, cautions, and reasoning.",
    "Do not force numbered sections unless structure genuinely helps. Natural prose is preferred.",
    "Weave evidence naturally: mention when something comes from retrieved knowledge, recent history, or your own inference, but do not mechanically print a fixed template every time.",
    "",
    `Persona name: ${params.context.persona.name}`,
    `Persona voice: ${params.context.persona.voice}`,
    `Persona mission: ${params.context.persona.mission}`,
    `Current goal: ${params.context.activeGoal}`,
    `Plan summary: ${params.context.activePlanSummary}`,
    `Recent execution summary: ${params.context.recentReportSummary}`,
    "Relevant knowledge:",
    ...knowledgeLines,
    "Recent conversation:",
    ...recentMessageLines,
    "Explicit basis:",
    ...basisLines,
    "",
    `User question: ${params.message}`,
    "",
    "Answer requirements:",
    "- Start with the direct answer or recommendation.",
    "- Then explain the reasoning in natural language.",
    "- If useful, unpack the training theory instead of stopping at a short conclusion.",
    "- Keep the tone human and informed, not ceremonial.",
    "- If the question should really be answered by generating today's prescription, say that explicitly.",
  ].join("\n");

  const result = await model.generateContent(prompt);
  return result.response.text();
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

  const prompt = [
    "You are FitCoach's daily review editor.",
    "Reply in Simplified Chinese.",
    "Your job is not to invent a new structure. You must polish the existing draft review only.",
    "You must preserve the four numbered headings exactly: 1. 数据摘要 / 2. 训练评估 / 3. 饮食执行 / 4. 次日决策.",
    "Keep the markdown structure stable. Do not add extra sections and do not add code fences.",
    "Do not change the final training-readiness conclusion. Only improve phrasing so it sounds like an experienced coach.",
    "",
    `Plan label: ${params.planLabel}`,
    `Workout title: ${params.workoutTitle}`,
    `Target macros: about ${params.targetMacros.proteinG * 4 + params.targetMacros.carbsG * 4 + params.targetMacros.fatsG * 9} kcal / protein ${params.targetMacros.proteinG} g / carbs ${params.targetMacros.carbsG} g / fats ${params.targetMacros.fatsG} g`,
    `Meal execution: ${mealLog ? describeMealExecution(params.report) : "未填写"}`,
    `Meal summary: on plan ${mealSummary.onPlan} / adjusted ${mealSummary.adjusted} / missed ${mealSummary.missed}`,
    `Breakfast: ${mealLog?.breakfast.content || "未填写"}`,
    `Lunch: ${mealLog?.lunch.content || "未填写"}`,
    `Dinner: ${mealLog?.dinner.content || "未填写"}`,
    `Pre-workout meal: ${mealLog?.preWorkout.content || "未填写"}`,
    `Post-workout meal: ${effectivePostWorkout?.content || "未填写"}`,
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
