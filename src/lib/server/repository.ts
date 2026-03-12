import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { buildEmptyDashboardSeed, buildDefaultPlanSetup } from "@/lib/seed";
import { buildPlanSnapshots, normalizePlanSetupInput } from "@/lib/plan-generator";
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
  PlanSnapshot,
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

type SnapshotRow = {
  id: string;
  snapshot: PlanSnapshot;
  created_at?: string;
};

type ChatRow = {
  id: string;
  message: ChatMessage;
  created_at?: string;
};

type MockStore = DashboardSnapshot & {
  planSnapshots: PlanSnapshot[];
  knowledgeDocs: Awaited<ReturnType<typeof loadLocalKnowledgeBundle>>["doc"][];
  knowledgeChunks: Awaited<ReturnType<typeof loadLocalKnowledgeBundle>>["chunks"];
};

export interface Repository {
  getDashboardSnapshot(): Promise<DashboardSnapshot>;
  getPlanSetup(): Promise<PlanSetupInput>;
  savePlanSetup(input: PlanSetupInput): Promise<PlanSetupInput>;
  findPlanSnapshotByDate(date: string): Promise<PlanSnapshot | null>;
  replacePlanSnapshots(entries: PlanSnapshot[]): Promise<PlanSnapshot[]>;
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

function sortByDateAndCreatedAtDesc<T extends { date: string; createdAt?: string }>(items: T[]) {
  return [...items].sort((left, right) => {
    const dateOrder = right.date.localeCompare(left.date);
    if (dateOrder !== 0) {
      return dateOrder;
    }

    return (right.createdAt ?? "").localeCompare(left.createdAt ?? "");
  });
}

function dedupeByDate<T extends { date: string; createdAt?: string }>(items: T[]) {
  const seen = new Set<string>();
  const result: T[] = [];

  for (const item of sortByDateAndCreatedAtDesc(items)) {
    if (seen.has(item.date)) {
      continue;
    }
    seen.add(item.date);
    result.push(item);
  }

  return result;
}

function createMockRepository(): Repository {
  return {
    async getDashboardSnapshot() {
      const store = await getMockStore();
      const normalized = normalizePlanSetupInput({
        profile: store.profile,
        persona: store.persona,
        plan: store.plan,
        templates: store.templates,
      });
      store.profile = normalized.profile;
      store.persona = normalized.persona;
      store.plan = normalized.plan;
      store.templates = normalized.templates;
      if (!store.planSnapshots.length) {
        store.planSnapshots = buildPlanSnapshots(normalized);
      }
      return {
        profile: normalized.profile,
        persona: normalized.persona,
        plan: normalized.plan,
        templates: normalized.templates,
        recentBrief: store.recentBrief,
        recentReports: dedupeByDate(store.recentReports).slice(0, 6),
        proposals: store.proposals.slice(0, 6),
        summaries: dedupeByDate(store.summaries).slice(0, 6),
        chatMessages: store.chatMessages.slice(-8),
      };
    },
    async getPlanSetup() {
      const store = await getMockStore();
      const normalized = normalizePlanSetupInput({
        profile: store.profile,
        persona: store.persona,
        plan: store.plan,
        templates: store.templates,
      });
      store.profile = normalized.profile;
      store.persona = normalized.persona;
      store.plan = normalized.plan;
      store.templates = normalized.templates;
      return normalized;
    },
    async savePlanSetup(input) {
      const store = await getMockStore();
      const normalized = normalizePlanSetupInput(input);
      const finalized = {
        ...normalized,
        profile: {
          ...normalized.profile,
          updatedAt: new Date().toISOString(),
        },
        plan: {
          ...normalized.plan,
          planRevisionId: `planrev-${Date.now()}`,
        },
      };
      store.profile = finalized.profile;
      store.persona = finalized.persona;
      store.plan = finalized.plan;
      store.templates = finalized.templates;
      store.planSnapshots = buildPlanSnapshots(finalized);
      return finalized;
    },
    async findPlanSnapshotByDate(date) {
      const store = await getMockStore();
      return store.planSnapshots.find((snapshot) => snapshot.date === date) ?? null;
    },
    async replacePlanSnapshots(entries) {
      const store = await getMockStore();
      store.planSnapshots = entries;
      return entries;
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
      return dedupeByDate(store.recentReports).slice(0, limit);
    },
    async saveSessionReport(report) {
      const store = await getMockStore();
      const priorReports = store.recentReports.filter((item) => item.date !== report.date);
      const { memorySummary, proposals } = buildSessionSummary(report, priorReports, store.plan);
      store.recentReports = [report, ...priorReports].slice(0, 30);
      store.summaries = [memorySummary, ...store.summaries.filter((item) => item.date !== memorySummary.date)].slice(0, 30);
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
      return dedupeByDate(store.summaries).slice(0, limit);
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
      const normalized = normalizePlanSetupInput({
        profile: coachState.profile,
        persona: coachState.persona,
        plan: coachState.active_plan,
        templates: coachState.workout_templates,
      });
      const [{ data: briefRows }, { data: reportRows }, { data: proposalRows }, { data: summaryRows }, { data: chatRows }] =
        await Promise.all([
          supabase.from("daily_briefs").select("*").order("created_at", { ascending: false }).limit(1).returns<BriefRow[]>(),
          supabase.from("session_reports").select("*").order("created_at", { ascending: false }).limit(24).returns<ReportRow[]>(),
          supabase.from("plan_adjustments").select("*").order("created_at", { ascending: false }).limit(6).returns<ProposalRow[]>(),
          supabase.from("memory_summaries").select("*").order("created_at", { ascending: false }).limit(24).returns<SummaryRow[]>(),
          supabase.from("chat_messages").select("*").order("created_at", { ascending: false }).limit(8).returns<ChatRow[]>(),
        ]);

      const recentReports = dedupeByDate((reportRows ?? []).map((row) => row.report)).slice(0, 6);
      const summaries = dedupeByDate((summaryRows ?? []).map((row) => row.summary)).slice(0, 6);

      return {
        profile: normalized.profile,
        persona: normalized.persona,
        plan: normalized.plan,
        templates: normalized.templates,
        recentBrief: briefRows?.[0]?.brief ?? null,
        recentReports,
        proposals: (proposalRows ?? []).map((row) => row.proposal),
        summaries,
        chatMessages: (chatRows ?? []).map((row) => row.message).reverse(),
      };
    },
    async getPlanSetup() {
      const coachState = await ensureCoachState(supabase);
      return normalizePlanSetupInput({
        profile: coachState.profile,
        persona: coachState.persona,
        plan: coachState.active_plan,
        templates: coachState.workout_templates,
      });
    },
    async savePlanSetup(input) {
      const normalized = normalizePlanSetupInput(input);
      const nextPlan = {
        ...normalized.plan,
        planRevisionId: `planrev-${Date.now()}`,
      };
      const finalized = {
        ...normalized,
        profile: {
          ...normalized.profile,
          updatedAt: new Date().toISOString(),
        },
        plan: nextPlan,
      };
      const { error } = await supabase.from("coach_state").upsert({
        id: "primary",
        profile: finalized.profile,
        persona: finalized.persona,
        active_plan: finalized.plan,
        workout_templates: finalized.templates,
      });
      if (error) {
        throw error;
      }
      const snapshots = buildPlanSnapshots(finalized);
      await this.replacePlanSnapshots(snapshots);
      return finalized;
    },
    async findPlanSnapshotByDate(date) {
      try {
        const { data } = await supabase
          .from("plan_snapshots")
          .select("*")
          .order("created_at", { ascending: false })
          .returns<SnapshotRow[]>();
        return data?.map((row) => row.snapshot).find((snapshot) => snapshot.date === date) ?? null;
      } catch {
        return null;
      }
    },
    async replacePlanSnapshots(entries) {
      try {
        await supabase.from("plan_snapshots").delete().neq("id", "");
        if (!entries.length) {
          return [];
        }
        const { error } = await supabase.from("plan_snapshots").insert(
          entries.map((snapshot) => ({
            id: snapshot.id,
            snapshot,
          })),
        );
        if (error) {
          throw error;
        }
        return entries;
      } catch {
        return [];
      }
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
        .limit(Math.max(limit * 3, 24))
        .returns<ReportRow[]>();
      return dedupeByDate((data ?? []).map((row) => row.report)).slice(0, limit);
    },
    async saveSessionReport(report) {
      const coachState = await ensureCoachState(supabase);
      const { data: existingReportRows } = await supabase
        .from("session_reports")
        .select("*")
        .eq("report->>date", report.date)
        .order("created_at", { ascending: false })
        .returns<ReportRow[]>();
      const resolvedReport = {
        ...report,
        id: existingReportRows?.[0]?.id ?? report.id,
      };
      const recentReports = (await this.listSessionReports(10)).filter((item) => item.date !== resolvedReport.date);
      const { memorySummary, proposals } = buildSessionSummary(resolvedReport, recentReports, coachState.active_plan);
      const { data: existingSummaryRows } = await supabase
        .from("memory_summaries")
        .select("*")
        .eq("summary->>date", resolvedReport.date)
        .order("created_at", { ascending: false })
        .returns<SummaryRow[]>();
      const resolvedSummary = {
        ...memorySummary,
        id: existingSummaryRows?.[0]?.id ?? memorySummary.id,
      };

      const { error } = await supabase.from("session_reports").upsert({
        id: resolvedReport.id,
        report: resolvedReport,
      });
      if (error) {
        throw error;
      }

      await supabase.from("memory_summaries").upsert({
        id: resolvedSummary.id,
        summary: resolvedSummary,
      });

      const duplicateReportIds = (existingReportRows ?? []).slice(1).map((row) => row.id);
      if (duplicateReportIds.length) {
        await supabase.from("session_reports").delete().in("id", duplicateReportIds);
      }

      const duplicateSummaryIds = (existingSummaryRows ?? []).slice(1).map((row) => row.id);
      if (duplicateSummaryIds.length) {
        await supabase.from("memory_summaries").delete().in("id", duplicateSummaryIds);
      }

      if (proposals.length) {
        await supabase.from("plan_adjustments").insert(
          proposals.map((proposal) => ({
            id: proposal.id,
            proposal,
          })),
        );
      }

      return resolvedReport;
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
        .limit(Math.max(limit * 3, 24))
        .returns<SummaryRow[]>();
      return dedupeByDate((data ?? []).map((row) => row.summary)).slice(0, limit);
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
