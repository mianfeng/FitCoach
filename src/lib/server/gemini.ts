import "server-only";

import { GoogleGenerativeAI } from "@google/generative-ai";

import { env } from "@/lib/server/env";
import type { ChatContextBundle, KnowledgeBasis } from "@/lib/types";

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
