import { NextResponse } from "next/server";

import {
  buildChatContextBundle,
  buildHistoryBasis,
  buildKnowledgeBasisFromChunks,
  buildStructuredCoachFallbackAnswer,
} from "@/lib/server/domain";
import { generateGeminiCoachReply } from "@/lib/server/gemini";
import { getRepository } from "@/lib/server/repository";
import type { ChatMessage } from "@/lib/types";
import { uid } from "@/lib/utils";
import { chatRequestSchema } from "@/lib/validations";

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const { message } = chatRequestSchema.parse(payload);
    const repository = await getRepository();
    const dashboard = await repository.getDashboardSnapshot();
    const retrievedKnowledge = await repository.searchKnowledge(message, 3);
    const context = buildChatContextBundle({
      persona: dashboard.persona,
      plan: dashboard.plan,
      reports: dashboard.recentReports,
      retrievedKnowledge,
      messages: dashboard.chatMessages,
    });
    const basis = [...buildKnowledgeBasisFromChunks(retrievedKnowledge), ...buildHistoryBasis(dashboard.recentReports)];

    const userMessage: ChatMessage = {
      id: uid("chat"),
      role: "user",
      content: message,
      basis: [],
      createdAt: new Date().toISOString(),
    };
    await repository.saveChatMessage(userMessage);

    const aiText = await generateGeminiCoachReply({ message, context, basis });
    const answer = aiText ?? buildStructuredCoachFallbackAnswer(message, context, basis);

    const assistantMessage: ChatMessage = {
      id: uid("chat"),
      role: "assistant",
      content: answer,
      basis,
      createdAt: new Date().toISOString(),
    };
    await repository.saveChatMessage(assistantMessage);

    return NextResponse.json({
      answer,
      basis,
      contextSummary: context.activePlanSummary,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to generate reply";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
