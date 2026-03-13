import "server-only";

import { GoogleGenerativeAI } from "@google/generative-ai";

import { env } from "@/lib/server/env";
import { describeMealExecution, describeTrainingReadiness } from "@/lib/server/domain";
import { normalizeMealLog, resolvePostWorkoutEntry, summarizeMealAdherence } from "@/lib/session-report";
import type { ChatContextBundle, KnowledgeBasis, MealPrescription, SessionReport } from "@/lib/types";

function stripCodeFence(input: string) {
  return input.replace(/^```(?:markdown)?\s*/i, "").replace(/\s*```$/, "").trim();
}

function hasPreferredDailyReviewShape(input: string) {
  const normalized = stripCodeFence(input);
  return (
    normalized.includes("1. 📊 数据核算") &&
    normalized.includes("2. 🏋️ 训练评估") &&
    normalized.includes("3. 🎯 质量评级")
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
    "Use the handbook as a reference when useful, but do not depend on it mechanically and do not pretend it is the only authority.",
    "You can go deep on training theory, recovery logic, nutrition logic, tradeoffs, and likely mechanisms when that helps the user think clearly.",
    "If evidence is thin, say so plainly. Avoid hallucinations.",
    "Do not rewrite the user's formal long-term plan on your own. Give advice, options, cautions, and reasoning.",
    "Natural prose is preferred. Do not force numbered sections unless structure genuinely helps.",
    "When the user asks about today, today's diet, today's training, today's recovery, or asks '怎么样', you must analyze the latest recorded report first.",
    "For those questions, explicitly use the available numbers before giving judgment: body weight, sleep, fatigue, meal completion, training completion, notes.",
    "If the current report already gives enough signal, do not drift into generic lean-bulk theory and do not tell the user to generate today's prescription first.",
    "Only ask a follow-up question when the current data is truly insufficient, and say exactly what is missing.",
    "If the user asks only about diet completion, focus on adherence, completeness, likely gap, and the next correction. Keep the answer on-topic.",
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
    "",
    "Answer requirements:",
    "- Start with the direct answer or recommendation.",
    "- If current data exists, judge that data first instead of restarting from abstract goals.",
    "- Pull in theory only when it sharpens the judgment, not as filler.",
    "- Mention which part is based on recorded data and which part is inference when that distinction matters.",
    "- Keep the tone human, specific, and slightly sharp when needed.",
    "- If the question should really be answered by generating today's prescription, say that only when the existing data cannot answer the question.",
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
    "You must polish the existing draft review only. Do not invent a new outline.",
    "You must preserve these three headings exactly: 1. 📊 数据核算 / 2. 🏋️ 训练评估 / 3. 🎯 质量评级.",
    "Keep markdown stable. Do not add extra sections and do not add code fences.",
    "Do not turn the review into a bureaucratic summary. It should read like a sharp coach commenting on real execution quality.",
    "Section 1 must talk about the recorded numbers and whether today's intake record is complete enough to support a conclusion.",
    "Section 2 must stay concrete. If it is a rest day, do not fabricate training stress. If it is a training day, mention completion, RPE, and dropped sets when useful.",
    "Section 3 must contain one explicit quality verdict and then the tomorrow focus.",
    "Do not change the final training-readiness conclusion. Improve phrasing and sharpness only.",
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
  return hasPreferredDailyReviewShape(text) ? text : null;
}
