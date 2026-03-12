import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { buildEmptyDashboardSeed, buildDefaultPlanSetup } from "@/lib/seed";
import { buildSessionSummary } from "@/lib/server/domain";
import { env, hasSupabaseConfig } from "@/lib/server/env";
import { loadLocalKnowledgeBundle, parseKnowledgeMarkdown, searchKnowledgeChunks } from "@/lib/server/knowledge";
import type {
  ChatMessage,
  DashboardSnapshot,
  DailyBrief,
  KnowledgeImportResult,
  LongTermPlan,
  MemorySummary,
  PlanAdjustmentProposal,
  PlanSetupInput,
  SessionReport,
  WorkoutTemplate,
} from "@/lib/types";

type CoachStateRow = {
  id: string;
  profile: DashboardSnapshot["profile"];
  persona: DashboardSnapshot["persona"];
  active_plan: LongTermPlan;
  workout_templates: WorkoutTemplate[];
  updated_at?: string;
};

type BriefRow = {
  id: string;
  brief: DailyBrief;
  created_at?: string;
};

type ReportRow = {
  id: string;
  report: SessionReport;
  created_at?: string;
};

type ProposalRow = {
  id: string;
  proposal: PlanAdjustmentProposal;
  created_at?: string;
};

type SummaryRow = {
  id: string;
  summary: MemorySummary;
  created_at?: string;
};

type ChatRow = {
  id: string;
  message: ChatMessage;
  created_at?: string;
};

type MockStore = DashboardSnapshot & {
  knowledgeDocs: Awaited<ReturnType<typeof loadLocalKnowledgeBundle>>["doc"][];
  knowledgeChunks: Awaited<ReturnType<typeof loadLocalKnowledgeBundle>>["chunks"];
};

export interface Repository {
  getDashboardSnapshot(): Promise<DashboardSnapshot>;
  getPlanSetup(): Promise<PlanSetupInput>;
  savePlanSetup(input: PlanSetupInput): Promise<PlanSetupInput>;
  findDailyBriefByDate(date: string): Promise<DailyBrief | null>;
  saveDailyBrief(brief: DailyBrief): Promise<DailyBrief>;
  listSessionReports(limit?: number): Promise<SessionReport[]>;
  saveSessionReport(report: SessionReport): Promise<SessionReport>;
  listPlanAdjustments(limit?: number): Promise<PlanAdjustmentProposal[]>;
  savePlanAdjustment(proposal: PlanAdjustmentProposal): Promise<PlanAdjustmentProposal>;
  approvePlanAdjustment(id: string): Promise<PlanAdjustmentProposal | null>;
  listMemorySummaries(limit?: number): Promise<MemorySummary[]>;
  saveMemorySummary(summary: MemorySummary): Promise<MemorySummary>;
  listChatMessages(limit?: number): Promise<ChatMessage[]>;
  saveChatMessage(message: ChatMessage): Promise<ChatMessage>;
  searchKnowledge(query: string, limit?: number): Promise<MockStore["knowledgeChunks"]>;
  importKnowledge(markdown: string, title: string, sourcePath: string): Promise<KnowledgeImportResult>;
  bootstrapKnowledge(): Promise<KnowledgeImportResult>;
}

const defaultState = buildEmptyDashboardSeed();

declare global {
  var __fitcoachMockStore__: MockStore | undefined;
}

async function getMockStore() {
  if (!globalThis.__fitcoachMockStore__) {
    const knowledge = await loadLocalKnowledgeBundle();
    globalThis.__fitcoachMockStore__ = {
      ...defaultState,
      knowledgeDocs: [knowledge.doc],
      knowledgeChunks: knowledge.chunks,
    };
  }

  return globalThis.__fitcoachMockStore__;
}

function createMockRepository(): Repository {
  return {
    async getDashboardSnapshot() {
      const store = await getMockStore();
      return {
        profile: store.profile,
        persona: store.persona,
        plan: store.plan,
        templates: store.templates,
        recentBrief: store.recentBrief,
        recentReports: store.recentReports.slice(0, 6),
        proposals: store.proposals.slice(0, 6),
        summaries: store.summaries.slice(0, 6),
        chatMessages: store.chatMessages.slice(-8),
      };
    },
    async getPlanSetup() {
      const store = await getMockStore();
      return {
        profile: store.profile,
        persona: store.persona,
        plan: store.plan,
        templates: store.templates,
      };
    },
    async savePlanSetup(input) {
      const store = await getMockStore();
      store.profile = input.profile;
      store.persona = input.persona;
      store.plan = input.plan;
      store.templates = input.templates;
      return input;
    },
    async findDailyBriefByDate(date) {
      const store = await getMockStore();
      return store.recentBrief?.date === date ? store.recentBrief : null;
    },
    async saveDailyBrief(brief) {
      const store = await getMockStore();
      store.recentBrief = brief;
      return brief;
    },
    async listSessionReports(limit = 20) {
      const store = await getMockStore();
      return [...store.recentReports].slice(0, limit);
    },
    async saveSessionReport(report) {
      const store = await getMockStore();
      const { memorySummary, proposals } = buildSessionSummary(report, store.recentReports, store.plan);
      store.recentReports = [report, ...store.recentReports].slice(0, 30);
      store.summaries = [memorySummary, ...store.summaries].slice(0, 30);
      if (proposals.length) {
        store.proposals = [...proposals, ...store.proposals].slice(0, 20);
      }
      return report;
    },
    async listPlanAdjustments(limit = 20) {
      const store = await getMockStore();
      return store.proposals.slice(0, limit);
    },
    async savePlanAdjustment(proposal) {
      const store = await getMockStore();
      store.proposals = [proposal, ...store.proposals];
      return proposal;
    },
    async approvePlanAdjustment(id) {
      const store = await getMockStore();
      const found = store.proposals.find((proposal) => proposal.id === id);
      if (!found) {
        return null;
      }
      found.status = "approved";
      if (found.after.manualOverrides) {
        store.plan = {
          ...store.plan,
          manualOverrides: {
            ...store.plan.manualOverrides,
            ...found.after.manualOverrides,
          },
        };
      }
      if (found.after.mealStrategy) {
        store.plan = {
          ...store.plan,
          mealStrategy: {
            ...store.plan.mealStrategy,
            ...found.after.mealStrategy,
          },
        };
      }
      return found;
    },
    async listMemorySummaries(limit = 20) {
      const store = await getMockStore();
      return store.summaries.slice(0, limit);
    },
    async saveMemorySummary(summary) {
      const store = await getMockStore();
      store.summaries = [summary, ...store.summaries];
      return summary;
    },
    async listChatMessages(limit = 20) {
      const store = await getMockStore();
      return store.chatMessages.slice(-limit);
    },
    async saveChatMessage(message) {
      const store = await getMockStore();
      store.chatMessages = [...store.chatMessages, message].slice(-40);
      return message;
    },
    async searchKnowledge(query, limit = 3) {
      const store = await getMockStore();
      return searchKnowledgeChunks(query, store.knowledgeChunks, limit);
    },
    async importKnowledge(markdown, title, sourcePath) {
      const store = await getMockStore();
      const parsed = parseKnowledgeMarkdown(markdown, title, sourcePath);
      store.knowledgeDocs = [parsed.doc];
      store.knowledgeChunks = parsed.chunks;
      return {
        importedDocs: 1,
        importedChunks: parsed.chunks.length,
      };
    },
    async bootstrapKnowledge() {
      const store = await getMockStore();
      return {
        importedDocs: store.knowledgeDocs.length,
        importedChunks: store.knowledgeChunks.length,
      };
    },
  };
}

function createSupabaseAdmin() {
  return createClient(env.supabaseUrl!, env.supabaseServiceRoleKey!, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

async function ensureCoachState(supabase: SupabaseClient) {
  const { data } = await supabase.from("coach_state").select("*").eq("id", "primary").maybeSingle<CoachStateRow>();
  if (data) {
    return data;
  }

  const seed = buildDefaultPlanSetup();
  const insert: CoachStateRow = {
    id: "primary",
    profile: seed.profile,
    persona: seed.persona,
    active_plan: seed.plan,
    workout_templates: seed.templates,
  };
  const { data: inserted, error } = await supabase
    .from("coach_state")
    .upsert(insert)
    .select("*")
    .single<CoachStateRow>();
  if (error || !inserted) {
    throw error ?? new Error("Unable to seed coach_state");
  }
  return inserted;
}

async function ensureKnowledgeSeeded(supabase: SupabaseClient) {
  const { count } = await supabase.from("knowledge_docs").select("*", { count: "exact", head: true });
  if (count && count > 0) {
    return;
  }

  const knowledge = await loadLocalKnowledgeBundle();
  await supabase.from("knowledge_docs").insert({
    id: knowledge.doc.id,
    title: knowledge.doc.title,
    source_path: knowledge.doc.sourcePath,
    markdown: knowledge.doc.markdown,
    imported_at: knowledge.doc.importedAt,
  });
  await supabase.from("knowledge_chunks").insert(
    knowledge.chunks.map((chunk) => ({
      id: chunk.id,
      doc_id: chunk.docId,
      title: chunk.title,
      content: chunk.content,
      anchor: chunk.anchor,
      tags: chunk.tags,
    })),
  );
}

function createSupabaseRepository(): Repository {
  const supabase = createSupabaseAdmin();

  return {
    async getDashboardSnapshot() {
      await ensureKnowledgeSeeded(supabase);
      const coachState = await ensureCoachState(supabase);
      const [{ data: briefRows }, { data: reportRows }, { data: proposalRows }, { data: summaryRows }, { data: chatRows }] =
        await Promise.all([
          supabase.from("daily_briefs").select("*").order("created_at", { ascending: false }).limit(1).returns<BriefRow[]>(),
          supabase.from("session_reports").select("*").order("created_at", { ascending: false }).limit(6).returns<ReportRow[]>(),
          supabase.from("plan_adjustments").select("*").order("created_at", { ascending: false }).limit(6).returns<ProposalRow[]>(),
          supabase.from("memory_summaries").select("*").order("created_at", { ascending: false }).limit(6).returns<SummaryRow[]>(),
          supabase.from("chat_messages").select("*").order("created_at", { ascending: false }).limit(8).returns<ChatRow[]>(),
        ]);

      return {
        profile: coachState.profile,
        persona: coachState.persona,
        plan: coachState.active_plan,
        templates: coachState.workout_templates,
        recentBrief: briefRows?.[0]?.brief ?? null,
        recentReports: (reportRows ?? []).map((row) => row.report),
        proposals: (proposalRows ?? []).map((row) => row.proposal),
        summaries: (summaryRows ?? []).map((row) => row.summary),
        chatMessages: (chatRows ?? []).map((row) => row.message).reverse(),
      };
    },
    async getPlanSetup() {
      const coachState = await ensureCoachState(supabase);
      return {
        profile: coachState.profile,
        persona: coachState.persona,
        plan: coachState.active_plan,
        templates: coachState.workout_templates,
      };
    },
    async savePlanSetup(input) {
      const { error } = await supabase.from("coach_state").upsert({
        id: "primary",
        profile: input.profile,
        persona: input.persona,
        active_plan: input.plan,
        workout_templates: input.templates,
      });
      if (error) {
        throw error;
      }
      return input;
    },
    async findDailyBriefByDate(date) {
      const { data } = await supabase
        .from("daily_briefs")
        .select("*")
        .eq("brief->>date", date)
        .order("created_at", { ascending: false })
        .limit(1)
        .returns<BriefRow[]>();
      return data?.[0]?.brief ?? null;
    },
    async saveDailyBrief(brief) {
      const { error } = await supabase.from("daily_briefs").upsert({
        id: brief.id,
        brief,
      });
      if (error) {
        throw error;
      }
      return brief;
    },
    async listSessionReports(limit = 20) {
      const { data } = await supabase
        .from("session_reports")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit)
        .returns<ReportRow[]>();
      return (data ?? []).map((row) => row.report);
    },
    async saveSessionReport(report) {
      const coachState = await ensureCoachState(supabase);
      const recentReports = await this.listSessionReports(10);
      const { memorySummary, proposals } = buildSessionSummary(report, recentReports, coachState.active_plan);

      const { error } = await supabase.from("session_reports").upsert({
        id: report.id,
        report,
      });
      if (error) {
        throw error;
      }

      await supabase.from("memory_summaries").upsert({
        id: memorySummary.id,
        summary: memorySummary,
      });

      if (proposals.length) {
        await supabase.from("plan_adjustments").insert(
          proposals.map((proposal) => ({
            id: proposal.id,
            proposal,
          })),
        );
      }

      return report;
    },
    async listPlanAdjustments(limit = 20) {
      const { data } = await supabase
        .from("plan_adjustments")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit)
        .returns<ProposalRow[]>();
      return (data ?? []).map((row) => row.proposal);
    },
    async savePlanAdjustment(proposal) {
      const { error } = await supabase.from("plan_adjustments").upsert({
        id: proposal.id,
        proposal,
      });
      if (error) {
        throw error;
      }
      return proposal;
    },
    async approvePlanAdjustment(id) {
      const { data, error } = await supabase
        .from("plan_adjustments")
        .select("*")
        .eq("id", id)
        .maybeSingle<ProposalRow>();
      if (error) {
        throw error;
      }
      if (!data) {
        return null;
      }

      const proposal = { ...data.proposal, status: "approved" as const };
      await supabase.from("plan_adjustments").update({ proposal }).eq("id", id);

      const coachState = await ensureCoachState(supabase);
      const updatedPlan = {
        ...coachState.active_plan,
        manualOverrides: {
          ...coachState.active_plan.manualOverrides,
          ...proposal.after.manualOverrides,
        },
        mealStrategy: {
          ...coachState.active_plan.mealStrategy,
          ...proposal.after.mealStrategy,
        },
      };
      await supabase.from("coach_state").update({ active_plan: updatedPlan }).eq("id", "primary");
      return proposal;
    },
    async listMemorySummaries(limit = 20) {
      const { data } = await supabase
        .from("memory_summaries")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit)
        .returns<SummaryRow[]>();
      return (data ?? []).map((row) => row.summary);
    },
    async saveMemorySummary(summary) {
      const { error } = await supabase.from("memory_summaries").upsert({
        id: summary.id,
        summary,
      });
      if (error) {
        throw error;
      }
      return summary;
    },
    async listChatMessages(limit = 20) {
      const { data } = await supabase
        .from("chat_messages")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit)
        .returns<ChatRow[]>();
      return (data ?? []).map((row) => row.message).reverse();
    },
    async saveChatMessage(message) {
      const { error } = await supabase.from("chat_messages").upsert({
        id: message.id,
        message,
      });
      if (error) {
        throw error;
      }
      return message;
    },
    async searchKnowledge(query, limit = 3) {
      await ensureKnowledgeSeeded(supabase);
      const { data } = await supabase
        .from("knowledge_chunks")
        .select("id, doc_id, title, content, anchor, tags")
        .or(`title.ilike.%${query}%,content.ilike.%${query}%`)
        .limit(limit);

      if (!data?.length) {
        const allRows = await supabase
          .from("knowledge_chunks")
          .select("id, doc_id, title, content, anchor, tags")
          .returns<
            {
              id: string;
              doc_id: string;
              title: string;
              content: string;
              anchor: string;
              tags: string[];
            }[]
          >();
        return searchKnowledgeChunks(
          query,
          (allRows.data ?? []).map((row) => ({
            id: row.id,
            docId: row.doc_id,
            title: row.title,
            content: row.content,
            anchor: row.anchor,
            tags: row.tags ?? [],
          })),
          limit,
        );
      }

      return data.map((row) => ({
        id: row.id,
        docId: row.doc_id,
        title: row.title,
        content: row.content,
        anchor: row.anchor,
        tags: row.tags ?? [],
      }));
    },
    async importKnowledge(markdown, title, sourcePath) {
      const parsed = parseKnowledgeMarkdown(markdown, title, sourcePath);
      await supabase.from("knowledge_chunks").delete().neq("id", "");
      await supabase.from("knowledge_docs").delete().neq("id", "");
      await supabase.from("knowledge_docs").insert({
        id: parsed.doc.id,
        title: parsed.doc.title,
        source_path: parsed.doc.sourcePath,
        markdown: parsed.doc.markdown,
        imported_at: parsed.doc.importedAt,
      });
      await supabase.from("knowledge_chunks").insert(
        parsed.chunks.map((chunk) => ({
          id: chunk.id,
          doc_id: chunk.docId,
          title: chunk.title,
          content: chunk.content,
          anchor: chunk.anchor,
          tags: chunk.tags,
        })),
      );
      return {
        importedDocs: 1,
        importedChunks: parsed.chunks.length,
      };
    },
    async bootstrapKnowledge() {
      await ensureKnowledgeSeeded(supabase);
      const { count: docCount } = await supabase.from("knowledge_docs").select("*", { head: true, count: "exact" });
      const { count: chunkCount } = await supabase
        .from("knowledge_chunks")
        .select("*", { head: true, count: "exact" });
      return {
        importedDocs: docCount ?? 0,
        importedChunks: chunkCount ?? 0,
      };
    },
  };
}

export async function getRepository() {
  if (hasSupabaseConfig()) {
    return createSupabaseRepository();
  }

  return createMockRepository();
}
