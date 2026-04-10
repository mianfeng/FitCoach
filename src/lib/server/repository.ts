import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { buildEmptyDashboardSeed, buildDefaultPlanSetup } from "@/lib/seed";
import { buildPlanSnapshots, mergePlanSnapshotsFromDate, normalizePlanSetupInput } from "@/lib/plan-generator";
import { buildMealLogForSubmit, createEmptyMealLog, mealSlotOrder, normalizeStoredSessionReport } from "@/lib/session-report";
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
  NutritionDish,
  PlanSnapshot,
  PlanAdjustmentProposal,
  PlanSetupInput,
  ParsedMealItem,
  SessionReport,
  TrainingReschedule,
  WorkoutTemplate,
} from "@/lib/types";
import { isoToday, uid } from "@/lib/utils";

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
  report_version?: number | null;
  report_date?: string | null;
  performed_day?: string | null;
  body_weight_kg?: number | null;
  sleep_hours?: number | null;
  fatigue?: number | null;
  completed?: boolean | null;
  training_readiness?: string | null;
  estimated_kcal?: number | null;
  estimated_protein_g?: number | null;
  estimated_carbs_g?: number | null;
  estimated_fats_g?: number | null;
  nutrition_warnings?: string[] | null;
  created_at?: string;
};

type ReportExerciseRow = {
  id: string;
  report_id: string;
  sort_order: number;
  exercise_name: string;
  performed: boolean;
  target_sets: number;
  target_reps: string;
  actual_sets: number;
  actual_reps: string;
  top_set_weight_kg?: number | null;
  rpe: number;
  dropped_sets: boolean;
  notes?: string | null;
};

type ReportMealRow = {
  id: string;
  report_id: string;
  sort_order: number;
  slot: string;
  content: string;
  adherence: "on_plan" | "adjusted" | "missed";
  deviation_note?: string | null;
  cooking_method?:
    | "poached_steamed"
    | "stir_fry_light"
    | "stir_fry_normal"
    | "stir_fry_heavy"
    | "grill_pan_sear"
    | "deep_fry"
    | null;
  rinse_oil?: boolean | null;
  post_workout_source?: "dedicated" | "lunch" | "dinner" | null;
  parsed_items?: ParsedMealItem[] | null;
  estimated_kcal?: number | null;
  estimated_protein_g?: number | null;
  estimated_carbs_g?: number | null;
  estimated_fats_g?: number | null;
  analysis_warnings?: string[] | null;
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

type NutritionDishRow = {
  id: string;
  name: string;
  aliases?: string[] | null;
  macros: NutritionDish["macros"];
  created_at?: string;
  updated_at?: string;
};

type ChatRow = {
  id: string;
  message: ChatMessage;
  created_at?: string;
};

type TrainingRescheduleRow = {
  id: string;
  reschedule: TrainingReschedule;
  source_date?: string | null;
  target_date?: string | null;
  created_at?: string;
};

type MockStore = DashboardSnapshot & {
  planSnapshots: PlanSnapshot[];
  trainingReschedules: TrainingReschedule[];
  knowledgeDocs: Awaited<ReturnType<typeof loadLocalKnowledgeBundle>>["doc"][];
  knowledgeChunks: Awaited<ReturnType<typeof loadLocalKnowledgeBundle>>["chunks"];
};

export interface Repository {
  getDashboardSnapshot(): Promise<DashboardSnapshot>;
  getPlanSetup(): Promise<PlanSetupInput>;
  savePlanSetup(input: PlanSetupInput): Promise<PlanSetupInput>;
  listNutritionDishes(): Promise<NutritionDish[]>;
  upsertNutritionDish(input: NutritionDish): Promise<NutritionDish>;
  deleteNutritionDish(id: string): Promise<void>;
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
  listTrainingReschedules(): Promise<TrainingReschedule[]>;
  saveTrainingReschedule(reschedule: TrainingReschedule): Promise<TrainingReschedule>;
  deleteTrainingReschedule(id: string): Promise<void>;
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
      trainingReschedules: [],
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

function normalizeNutritionDish(input: NutritionDish): NutritionDish {
  const aliases = [...new Set((input.aliases ?? []).map((item) => item.trim()).filter(Boolean))];
  return {
    id: input.id,
    name: input.name.trim(),
    aliases,
    macros: {
      proteinG: Number(input.macros.proteinG),
      carbsG: Number(input.macros.carbsG),
      fatsG: Number(input.macros.fatsG),
    },
  };
}

function normalizeReportRow(row: ReportRow) {
  return normalizeStoredSessionReport({
    ...row.report,
    reportVersion: (row.report.reportVersion ?? row.report_version ?? undefined) as 1 | 2 | undefined,
    date: row.report.date ?? row.report_date ?? "",
    performedDay: row.report.performedDay ?? ((row.performed_day ?? "rest") as SessionReport["performedDay"]),
    bodyWeightKg: row.report.bodyWeightKg ?? Number(row.body_weight_kg ?? 0),
    sleepHours: row.report.sleepHours ?? Number(row.sleep_hours ?? 0),
    fatigue: row.report.fatigue ?? Number(row.fatigue ?? 0),
    completed: row.report.completed ?? row.completed ?? true,
    nutritionTotals:
      row.report.nutritionTotals ??
      (row.estimated_kcal != null && row.estimated_protein_g != null && row.estimated_carbs_g != null && row.estimated_fats_g != null
        ? {
            calories: Number(row.estimated_kcal),
            proteinG: Number(row.estimated_protein_g),
            carbsG: Number(row.estimated_carbs_g),
            fatsG: Number(row.estimated_fats_g),
          }
        : undefined),
    nutritionWarnings: row.report.nutritionWarnings ?? row.nutrition_warnings ?? undefined,
    createdAt: row.report.createdAt ?? row.created_at ?? new Date().toISOString(),
  });
}

function buildExerciseResultsFromRows(rows: ReportExerciseRow[] | undefined) {
  return rows
    ?.sort((left, right) => left.sort_order - right.sort_order)
    .map((row) => ({
      exerciseName: row.exercise_name,
      performed: row.performed,
      targetSets: row.target_sets,
      targetReps: row.target_reps,
      actualSets: row.actual_sets,
      actualReps: row.actual_reps,
      topSetWeightKg: row.top_set_weight_kg ?? undefined,
      rpe: row.rpe,
      droppedSets: row.dropped_sets,
      notes: row.notes ?? undefined,
    }));
}

function buildMealLogFromRows(rows: ReportMealRow[] | undefined) {
  if (!rows?.length) {
    return undefined;
  }

  const mealLog = createEmptyMealLog();
  for (const row of rows.sort((left, right) => left.sort_order - right.sort_order)) {
    if (!mealSlotOrder.includes(row.slot as (typeof mealSlotOrder)[number])) {
      continue;
    }

    const slot = row.slot as (typeof mealSlotOrder)[number];
    mealLog[slot] = {
      content: row.content ?? "",
      adherence: row.adherence ?? "adjusted",
      deviationNote: row.deviation_note ?? "",
      cookingMethod: row.cooking_method ?? undefined,
      rinseOil: row.rinse_oil ?? undefined,
      parsedItems: row.parsed_items ?? [],
      nutritionEstimate:
        row.estimated_kcal != null &&
        row.estimated_protein_g != null &&
        row.estimated_carbs_g != null &&
        row.estimated_fats_g != null
          ? {
              calories: Number(row.estimated_kcal),
              proteinG: Number(row.estimated_protein_g),
              carbsG: Number(row.estimated_carbs_g),
              fatsG: Number(row.estimated_fats_g),
            }
          : undefined,
      analysisWarnings: row.analysis_warnings ?? [],
    };
    if (row.post_workout_source) {
      mealLog.postWorkoutSource = row.post_workout_source;
    }
  }

  return mealLog;
}

function normalizeTrainingRescheduleRow(row: TrainingRescheduleRow): TrainingReschedule {
  return {
    ...row.reschedule,
    sourceDate: row.reschedule.sourceDate ?? row.source_date ?? "",
    targetDate: row.reschedule.targetDate ?? row.target_date ?? "",
    createdAt: row.reschedule.createdAt ?? row.created_at ?? new Date().toISOString(),
  };
}

function groupByReportId<T extends { report_id: string }>(items: T[] | null | undefined) {
  const grouped = new Map<string, T[]>();
  for (const item of items ?? []) {
    const current = grouped.get(item.report_id) ?? [];
    current.push(item);
    grouped.set(item.report_id, current);
  }
  return grouped;
}

function toExerciseRows(report: SessionReport): ReportExerciseRow[] {
  return (report.exerciseResults ?? []).map((exercise, index) => ({
    id: uid("report-exercise"),
    report_id: report.id,
    sort_order: index,
    exercise_name: exercise.exerciseName,
    performed: exercise.performed ?? true,
    target_sets: exercise.targetSets,
    target_reps: exercise.targetReps,
    actual_sets: exercise.actualSets,
    actual_reps: exercise.actualReps,
    top_set_weight_kg: exercise.topSetWeightKg ?? null,
    rpe: exercise.rpe,
    dropped_sets: exercise.droppedSets,
    notes: exercise.notes ?? null,
  }));
}

function toMealRows(report: SessionReport): ReportMealRow[] {
  if (!report.mealLog) {
    return [];
  }

  const mealLog = buildMealLogForSubmit(report.mealLog);
  return mealSlotOrder.map((slot, index) => ({
    id: uid("report-meal"),
    report_id: report.id,
    sort_order: index,
    slot,
    content: mealLog[slot].content,
    adherence: mealLog[slot].adherence,
    deviation_note: mealLog[slot].deviationNote ?? null,
    cooking_method: mealLog[slot].cookingMethod ?? null,
    rinse_oil: mealLog[slot].rinseOil ?? null,
    post_workout_source: slot === "postWorkout" ? mealLog.postWorkoutSource : null,
    parsed_items: mealLog[slot].parsedItems ?? [],
    estimated_kcal: mealLog[slot].nutritionEstimate?.calories ?? null,
    estimated_protein_g: mealLog[slot].nutritionEstimate?.proteinG ?? null,
    estimated_carbs_g: mealLog[slot].nutritionEstimate?.carbsG ?? null,
    estimated_fats_g: mealLog[slot].nutritionEstimate?.fatsG ?? null,
    analysis_warnings: mealLog[slot].analysisWarnings ?? [],
  }));
}

async function hydrateReportRows(supabase: SupabaseClient, rows: ReportRow[] | null | undefined) {
  const baseRows = rows ?? [];
  if (!baseRows.length) {
    return [] as SessionReport[];
  }

  try {
    const reportIds = baseRows.map((row) => row.id);
    const [{ data: exerciseRows }, { data: mealRows }] = await Promise.all([
      supabase
        .from("session_report_exercises")
        .select("*")
        .in("report_id", reportIds)
        .returns<ReportExerciseRow[]>(),
      supabase
        .from("session_report_meals")
        .select("*")
        .in("report_id", reportIds)
        .returns<ReportMealRow[]>(),
    ]);

    const exercisesByReportId = groupByReportId(exerciseRows);
    const mealsByReportId = groupByReportId(mealRows);

    return baseRows.map((row) => {
      const fallback = normalizeReportRow(row);
      const exerciseResults = buildExerciseResultsFromRows(exercisesByReportId.get(row.id));
      const mealLog = buildMealLogFromRows(mealsByReportId.get(row.id));

      return normalizeStoredSessionReport({
        ...fallback,
        exerciseResults: exerciseResults?.length ? exerciseResults : fallback.exerciseResults,
        mealLog: mealLog ?? fallback.mealLog,
      });
    });
  } catch {
    return baseRows.map((row) => normalizeReportRow(row));
  }
}

function createMockRepository(): Repository {
  return {
    async getDashboardSnapshot() {
      const store = await getMockStore();
      const today = isoToday();
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
      } else {
        store.planSnapshots = mergePlanSnapshotsFromDate(
          store.planSnapshots,
          buildPlanSnapshots(normalized),
          today,
        );
      }
      return {
        profile: normalized.profile,
        persona: normalized.persona,
        plan: normalized.plan,
        templates: normalized.templates,
        nutritionDishes: store.nutritionDishes.map((dish) => normalizeNutritionDish(dish)),
        recentBrief: store.recentBrief,
        recentReports: dedupeByDate(store.recentReports.map((report) => normalizeStoredSessionReport(report))).slice(0, 6),
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
      const today = isoToday();
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
      store.planSnapshots = mergePlanSnapshotsFromDate(
        store.planSnapshots,
        buildPlanSnapshots(finalized),
        today,
      );
      return finalized;
    },
    async listNutritionDishes() {
      const store = await getMockStore();
      return [...store.nutritionDishes].map((dish) => normalizeNutritionDish(dish));
    },
    async upsertNutritionDish(input) {
      const store = await getMockStore();
      const normalized = normalizeNutritionDish(input);
      const rest = store.nutritionDishes.filter((item) => item.id !== normalized.id);
      store.nutritionDishes = [normalized, ...rest];
      return normalized;
    },
    async deleteNutritionDish(id) {
      const store = await getMockStore();
      store.nutritionDishes = store.nutritionDishes.filter((item) => item.id !== id);
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
      return dedupeByDate(store.recentReports.map((report) => normalizeStoredSessionReport(report))).slice(0, limit);
    },
    async saveSessionReport(report) {
      const store = await getMockStore();
      const normalizedReport = normalizeStoredSessionReport({
        ...report,
        mealLog: report.mealLog ? buildMealLogForSubmit(report.mealLog) : undefined,
      });
      const priorReports = store.recentReports
        .map((item) => normalizeStoredSessionReport(item))
        .filter((item) => item.date !== normalizedReport.date);
      store.recentReports = [normalizedReport, ...priorReports].slice(0, 30);
      if (!normalizedReport.completed) {
        store.summaries = store.summaries.filter((item) => item.date !== normalizedReport.date).slice(0, 30);
        return normalizedReport;
      }

      const { memorySummary, proposals } = buildSessionSummary(normalizedReport, priorReports, store.plan);
      store.summaries = [memorySummary, ...store.summaries.filter((item) => item.date !== memorySummary.date)].slice(0, 30);
      if (proposals.length) {
        store.proposals = [...proposals, ...store.proposals].slice(0, 20);
      }
      return normalizedReport;
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
    async listTrainingReschedules() {
      const store = await getMockStore();
      return [...store.trainingReschedules].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    },
    async saveTrainingReschedule(reschedule) {
      const store = await getMockStore();
      store.trainingReschedules = [
        ...store.trainingReschedules.filter(
          (item) => item.id !== reschedule.id && item.sourceDate !== reschedule.sourceDate && item.targetDate !== reschedule.targetDate,
        ),
        reschedule,
      ].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
      return reschedule;
    },
    async deleteTrainingReschedule(id) {
      const store = await getMockStore();
      store.trainingReschedules = store.trainingReschedules.filter((item) => item.id !== id);
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
      const [
        { data: briefRows },
        { data: reportRows },
        { data: proposalRows },
        { data: summaryRows },
        { data: chatRows },
        { data: nutritionDishRows },
      ] = await Promise.all([
        supabase.from("daily_briefs").select("*").order("created_at", { ascending: false }).limit(1).returns<BriefRow[]>(),
        supabase.from("session_reports").select("*").order("created_at", { ascending: false }).limit(24).returns<ReportRow[]>(),
        supabase.from("plan_adjustments").select("*").order("created_at", { ascending: false }).limit(6).returns<ProposalRow[]>(),
        supabase.from("memory_summaries").select("*").order("created_at", { ascending: false }).limit(24).returns<SummaryRow[]>(),
        supabase.from("chat_messages").select("*").order("created_at", { ascending: false }).limit(8).returns<ChatRow[]>(),
        supabase.from("nutrition_dishes").select("*").order("updated_at", { ascending: false }).returns<NutritionDishRow[]>(),
      ]);

      const hydratedReports = await hydrateReportRows(supabase, reportRows);
      const recentReports = dedupeByDate(hydratedReports).slice(0, 6);
      const summaries = dedupeByDate((summaryRows ?? []).map((row) => row.summary)).slice(0, 6);

      return {
        profile: normalized.profile,
        persona: normalized.persona,
        plan: normalized.plan,
        templates: normalized.templates,
        nutritionDishes: (nutritionDishRows ?? []).map((row) =>
          normalizeNutritionDish({
            id: row.id,
            name: row.name,
            aliases: row.aliases ?? [],
            macros: row.macros,
          }),
        ),
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
      const today = isoToday();
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
      const { data: existingSnapshotRows } = await supabase
        .from("plan_snapshots")
        .select("*")
        .order("created_at", { ascending: false })
        .returns<SnapshotRow[]>();
      const snapshots = mergePlanSnapshotsFromDate(
        (existingSnapshotRows ?? []).map((row) => row.snapshot),
        buildPlanSnapshots(finalized),
        today,
      );
      await this.replacePlanSnapshots(snapshots);
      return finalized;
    },
    async listNutritionDishes() {
      const { data } = await supabase
        .from("nutrition_dishes")
        .select("*")
        .order("updated_at", { ascending: false })
        .returns<NutritionDishRow[]>();
      return (data ?? []).map((row) =>
        normalizeNutritionDish({
          id: row.id,
          name: row.name,
          aliases: row.aliases ?? [],
          macros: row.macros,
        }),
      );
    },
    async upsertNutritionDish(input) {
      const normalized = normalizeNutritionDish(input);
      const now = new Date().toISOString();
      const { error } = await supabase.from("nutrition_dishes").upsert({
        id: normalized.id,
        name: normalized.name,
        aliases: normalized.aliases,
        macros: normalized.macros,
        updated_at: now,
      });
      if (error) {
        throw error;
      }
      return normalized;
    },
    async deleteNutritionDish(id) {
      const { error } = await supabase.from("nutrition_dishes").delete().eq("id", id);
      if (error) {
        throw error;
      }
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
      const hydrated = await hydrateReportRows(supabase, data);
      return dedupeByDate(hydrated).slice(0, limit);
    },
    async saveSessionReport(report) {
      let { data: existingReportRows } = await supabase
        .from("session_reports")
        .select("*")
        .eq("report_date", report.date)
        .order("created_at", { ascending: false })
        .returns<ReportRow[]>();
      if (!existingReportRows?.length) {
        const legacyLookup = await supabase
          .from("session_reports")
          .select("*")
          .eq("report->>date", report.date)
          .order("created_at", { ascending: false })
          .returns<ReportRow[]>();
        existingReportRows = legacyLookup.data ?? [];
      }

      const resolvedReport = normalizeStoredSessionReport({
        ...report,
        id: existingReportRows?.[0]?.id ?? report.id,
        mealLog: report.mealLog ? buildMealLogForSubmit(report.mealLog) : undefined,
      });
      const { data: existingSummaryRows } = await supabase
        .from("memory_summaries")
        .select("*")
        .eq("summary->>date", resolvedReport.date)
        .order("created_at", { ascending: false })
        .returns<SummaryRow[]>();

      const { error } = await supabase.from("session_reports").upsert({
        id: resolvedReport.id,
        report: resolvedReport,
        report_version: resolvedReport.reportVersion,
        report_date: resolvedReport.date,
        performed_day: resolvedReport.performedDay,
        body_weight_kg: resolvedReport.bodyWeightKg,
        sleep_hours: resolvedReport.sleepHours,
        fatigue: resolvedReport.fatigue,
        completed: resolvedReport.completed,
        training_readiness: resolvedReport.nextDayDecision?.trainingReadiness ?? null,
        estimated_kcal: resolvedReport.nutritionTotals?.calories ?? null,
        estimated_protein_g: resolvedReport.nutritionTotals?.proteinG ?? null,
        estimated_carbs_g: resolvedReport.nutritionTotals?.carbsG ?? null,
        estimated_fats_g: resolvedReport.nutritionTotals?.fatsG ?? null,
        nutrition_warnings: resolvedReport.nutritionWarnings ?? [],
      });
      if (error) {
        throw error;
      }

      await supabase.from("session_report_exercises").delete().eq("report_id", resolvedReport.id);
      const exerciseRows = toExerciseRows(resolvedReport);
      if (exerciseRows.length) {
        const { error: exerciseError } = await supabase.from("session_report_exercises").insert(exerciseRows);
        if (exerciseError) {
          throw exerciseError;
        }
      }

      await supabase.from("session_report_meals").delete().eq("report_id", resolvedReport.id);
      const mealRows = toMealRows(resolvedReport);
      if (mealRows.length) {
        const { error: mealError } = await supabase.from("session_report_meals").insert(mealRows);
        if (mealError) {
          throw mealError;
        }
      }

      const duplicateReportIds = (existingReportRows ?? []).slice(1).map((row) => row.id);
      if (duplicateReportIds.length) {
        await supabase.from("session_reports").delete().in("id", duplicateReportIds);
      }

      if (!resolvedReport.completed) {
        const summaryIdsToDelete = (existingSummaryRows ?? []).map((row) => row.id);
        if (summaryIdsToDelete.length) {
          await supabase.from("memory_summaries").delete().in("id", summaryIdsToDelete);
        }
        return resolvedReport;
      }

      const coachState = await ensureCoachState(supabase);
      const recentReports = (await this.listSessionReports(10)).filter((item) => item.date !== resolvedReport.date);
      const { memorySummary, proposals } = buildSessionSummary(resolvedReport, recentReports, coachState.active_plan);
      const resolvedSummary = {
        ...memorySummary,
        id: existingSummaryRows?.[0]?.id ?? memorySummary.id,
      };

      await supabase.from("memory_summaries").upsert({
        id: resolvedSummary.id,
        summary: resolvedSummary,
      });

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
    async listTrainingReschedules() {
      const { data } = await supabase
        .from("training_reschedules")
        .select("*")
        .order("created_at", { ascending: true })
        .returns<TrainingRescheduleRow[]>();
      return (data ?? []).map((row) => normalizeTrainingRescheduleRow(row));
    },
    async saveTrainingReschedule(reschedule) {
      const { error } = await supabase.from("training_reschedules").upsert({
        id: reschedule.id,
        reschedule,
        source_date: reschedule.sourceDate,
        target_date: reschedule.targetDate,
      });
      if (error) {
        throw error;
      }
      return reschedule;
    },
    async deleteTrainingReschedule(id) {
      const { error } = await supabase.from("training_reschedules").delete().eq("id", id);
      if (error) {
        throw error;
      }
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
