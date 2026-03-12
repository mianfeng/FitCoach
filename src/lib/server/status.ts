import "server-only";

import { env, hasSupabaseConfig } from "@/lib/server/env";
import { getRepository } from "@/lib/server/repository";

export interface RuntimeStatus {
  storageMode: "mock" | "supabase";
  supabaseConfigured: boolean;
  geminiConfigured: boolean;
  accessGateEnabled: boolean;
  knowledgeDocs: number;
  knowledgeChunks: number;
  hasDailyBrief: boolean;
  recentReportCount: number;
  pendingProposalCount: number;
  readyForPersistentUse: boolean;
  warnings: string[];
}

export async function getRuntimeStatus(): Promise<RuntimeStatus> {
  const repository = await getRepository();
  const snapshot = await repository.getDashboardSnapshot();
  const knowledge = await repository.bootstrapKnowledge();

  const storageMode = hasSupabaseConfig() ? "supabase" : "mock";
  const warnings: string[] = [];

  if (!hasSupabaseConfig()) {
    warnings.push("当前处于 Mock 模式，重启服务后数据不会保留。");
  }
  if (!env.geminiApiKey) {
    warnings.push("Gemini 未配置，问答会退回到规则化回答。");
  }
  if (!env.accessToken) {
    warnings.push("未设置 FITCOACH_ACCESS_TOKEN，公网部署时没有单用户门禁。");
  }
  if (knowledge.importedChunks === 0) {
    warnings.push("知识库为空，理论问答会明显变弱。");
  }

  return {
    storageMode,
    supabaseConfigured: hasSupabaseConfig(),
    geminiConfigured: Boolean(env.geminiApiKey),
    accessGateEnabled: Boolean(env.accessToken),
    knowledgeDocs: knowledge.importedDocs,
    knowledgeChunks: knowledge.importedChunks,
    hasDailyBrief: Boolean(snapshot.recentBrief),
    recentReportCount: snapshot.recentReports.length,
    pendingProposalCount: snapshot.proposals.filter((item) => item.status === "pending").length,
    readyForPersistentUse: hasSupabaseConfig() && Boolean(env.accessToken),
    warnings,
  };
}
