import "server-only";

import { GoogleGenerativeAI } from "@google/generative-ai";

import { env } from "@/lib/server/env";
import type { ChatContextBundle, MealPrescription, SessionReport, KnowledgeBasis } from "@/lib/types";

function stripCodeFence(input: string) {
  return input.replace(/^```(?:markdown)?\s*/i, "").replace(/\s*```$/, "").trim();
}

function hasStrictDailyReviewShape(input: string) {
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

  const prompt = [
    "你是 FitCoach 的唯一教练。回答必须简洁、执行导向、避免幻觉。",
    "回答时区分三类依据：资料原文、历史记录、模型推断。",
    "不要改写正式长期计划，只能给建议。",
    "",
    `角色设定：${params.context.persona.name}，风格：${params.context.persona.voice}，使命：${params.context.persona.mission}`,
    `当前目标：${params.context.activeGoal}`,
    `计划摘要：${params.context.activePlanSummary}`,
    `近期执行摘要：${params.context.recentReportSummary}`,
    "检索资料：",
    ...params.context.retrievedKnowledge.map((chunk) => `- ${chunk.title}: ${chunk.content}`),
    "最近消息：",
    ...params.context.recentMessages.map((message) => `- ${message.role}: ${message.content}`),
    "",
    `用户问题：${params.message}`,
    "",
    "输出要求：",
    "1. 先给直接答案。",
    "2. 再用三行列出：资料依据 / 历史依据 / 模型推断。",
    "3. 如果问题其实应该走“今日处方生成”，明确提醒去首页生成。",
  ].join("\n");

  const result = await model.generateContent(prompt);
  return result.response.text();
}

export async function generateGeminiDailyReview(params: {
  report: SessionReport;
  targetMacros: MealPrescription["macros"];
  planLabel: string;
  workoutTitle: string;
}) {
  if (!env.geminiApiKey) {
    return null;
  }

  const client = new GoogleGenerativeAI(env.geminiApiKey);
  const model = client.getGenerativeModel({ model: env.geminiModel });
  const mealLog = params.report.mealLog;
  const postWorkoutText =
    mealLog?.postWorkoutSource === "lunch"
      ? `午餐同时是练后餐：${mealLog.lunch || "未填写"}`
      : mealLog?.postWorkoutSource === "dinner"
        ? `晚餐同时是练后餐：${mealLog.dinner || "未填写"}`
        : `独立练后餐：${mealLog?.postWorkout || "未填写"}`;

  const prompt = [
    "你是 FitCoach 的饮食与训练复盘教练。",
    "你必须严格按以下 Markdown 结构输出，不允许添加额外段落，也不允许添加代码块。",
    "",
    "1. 📊 数据核算",
    "",
    "- 估算摄入：总热量(kcal) / 蛋白质(g) / 碳水(g) / 脂肪(g)",
    "- 缺口分析：距离目标还差多少，或超标多少",
    "",
    "2. 🏋️ 训练评估",
    "",
    "- 超负荷状态：[达标 / 停滞 / 需减载]",
    "- 简要评价：（一句话点评今日训练质量）",
    "",
    "3. 🎯 质量评级",
    "",
    "- [🟢 完美 / 🟡 警告 / 🔴 灾难]（仅保留一个，并附一句理由）",
    "",
    `当天标签：${params.planLabel}`,
    `当天计划：${params.workoutTitle}`,
    `目标宏量：热量约 ${params.targetMacros.proteinG * 4 + params.targetMacros.carbsG * 4 + params.targetMacros.fatsG * 9} kcal / 蛋白质 ${params.targetMacros.proteinG} g / 碳水 ${params.targetMacros.carbsG} g / 脂肪 ${params.targetMacros.fatsG} g`,
    `早餐：${mealLog?.breakfast || "未填写"}`,
    `午餐：${mealLog?.lunch || "未填写"}`,
    `晚餐：${mealLog?.dinner || "未填写"}`,
    `练前餐：${mealLog?.preWorkout || "未填写"}`,
    postWorkoutText,
    `训练与状态文字汇报：${params.report.trainingReportText || "未填写"}`,
    `体重：${params.report.bodyWeightKg} kg`,
    `睡眠：${params.report.sleepHours} h`,
    `疲劳：${params.report.fatigue}/10`,
  ].join("\n");

  const result = await model.generateContent(prompt);
  const text = stripCodeFence(result.response.text());
  return hasStrictDailyReviewShape(text) ? text : null;
}
