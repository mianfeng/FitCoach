"use client";

import { type ReactNode, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { SectionCard } from "@/components/section-card";
import { detectRinseOilFromText } from "@/lib/nutrition";
import { findInboundReschedule, findOutboundReschedule, findReportForDate, listMissedTrainingEntries } from "@/lib/training-reschedule";
import {
  buildMealLogForSubmit,
  countFilledMealSlots,
  createEmptyMealLog,
  mealCookingMethodLabels,
  mealSlotLabels,
} from "@/lib/session-report";
import { shiftIsoDate } from "@/lib/utils";
import type {
  ChatMessage,
  DashboardSnapshot,
  DailyBrief,
  ExerciseResult,
  LongTermPlan,
  MealCookingMethod,
  MealLog,
  SessionReport,
  TrainingReschedule,
} from "@/lib/types";

type ReportDraft = {
  reportVersion: 2;
  date: string;
  performedDay: SessionReport["performedDay"];
  exerciseResults: ExerciseResult[];
  mealLog: MealLog;
  trainingReportText: string;
  bodyWeightKg: number;
  sleepHours: number;
  fatigue: number;
  painNotes: string;
  recoveryNote: string;
  completed: boolean;
};

type FeedbackState = {
  tone: "success" | "error" | "info";
  message: string;
};

type CoachReplyState = {
  title: string;
  content: string;
  basis: ChatMessage["basis"];
  contextSummary?: string;
  source: "coach" | "review" | "draft" | "error";
};

type StoredReportState = {
  feedback: FeedbackState;
  panel?: Pick<CoachReplyState, "title" | "content" | "source">;
  review?: Pick<CoachReplyState, "title" | "content" | "source">;
};

type SessionReportResponse = {
  report: SessionReport;
  review: string | null;
  submissionMode: "draft" | "completed";
};

type TrainingRescheduleResponse = {
  reschedule: TrainingReschedule;
};

type TrainingRescheduleDeleteResponse = {
  ok: boolean;
};

type CoachChatResponse = {
  answer: string;
  basis: ChatMessage["basis"];
  contextSummary: string;
};

type ReportFlowStep = "training" | "nutrition" | "recovery";

const REPORT_FEEDBACK_KEY = "fitcoach:report-feedback";

const POST_WORKOUT_SOURCE_OPTIONS: Array<{ value: MealLog["postWorkoutSource"]; label: string }> = [
  { value: "dedicated", label: "独立练后餐" },
  { value: "lunch", label: "午餐同时作为练后餐" },
  { value: "dinner", label: "晚餐同时作为练后餐" },
];

const MEAL_SLOTS: Array<{ key: keyof Omit<MealLog, "postWorkoutSource">; label: string }> = [
  { key: "breakfast", label: "早餐" },
  { key: "lunch", label: "午餐" },
  { key: "dinner", label: "晚餐" },
  { key: "preWorkout", label: "练前餐" },
  { key: "postWorkout", label: "练后餐" },
];

const COOKING_METHOD_OPTIONS: Array<{ value: MealCookingMethod; label: string }> = [
  { value: "poached_steamed", label: mealCookingMethodLabels.poached_steamed },
  { value: "stir_fry_light", label: mealCookingMethodLabels.stir_fry_light },
  { value: "stir_fry_normal", label: mealCookingMethodLabels.stir_fry_normal },
  { value: "stir_fry_heavy", label: mealCookingMethodLabels.stir_fry_heavy },
  { value: "grill_pan_sear", label: mealCookingMethodLabels.grill_pan_sear },
  { value: "deep_fry", label: mealCookingMethodLabels.deep_fry },
];

function formatNutritionSummary(calories: number, proteinG: number, carbsG: number, fatsG: number) {
  return `${calories} kcal / P ${proteinG} g / C ${carbsG} g / F ${fatsG} g`;
}

function formatGapValue(value: number, unit: string) {
  if (Math.abs(value) < 0.05) {
    return `0 ${unit}`;
  }

  const sign = value > 0 ? "+" : "";
  return `${sign}${value} ${unit}`;
}

function formatRestLabel(restSeconds: number) {
  if (restSeconds >= 60) {
    const minutes = restSeconds / 60;
    const value = Number.isInteger(minutes) ? String(minutes) : minutes.toFixed(1);
    return `${value} 分钟休息`;
  }

  return `${restSeconds} 秒休息`;
}

function formatSuggestedWeightLabel(weight?: number) {
  return weight != null ? `建议 ${weight} kg` : "重量自定";
}

function buildDefaultExerciseResults(brief: DailyBrief) {
  if (brief.isRestDay) {
    return [] as ExerciseResult[];
  }

  return brief.workoutPrescription.exercises.map(
    (exercise) =>
      ({
        exerciseName: exercise.name,
        performed: false,
        targetSets: exercise.sets,
        targetReps: exercise.reps,
        actualSets: 0,
        actualReps: exercise.reps,
        topSetWeightKg: undefined,
        rpe: 8,
        droppedSets: false,
        notes: "",
      }) satisfies ExerciseResult,
  );
}

function buildDraftCoachReply(snapshot: DashboardSnapshot, report: SessionReport): CoachReplyState {
  const mealCount = countFilledMealSlots(report.mealLog);
  const recordedExercises = (report.exerciseResults ?? []).filter((exercise) => exercise.performed !== false && exercise.actualSets > 0).length;
  const lines = ["Draft saved. Formal review and next-day decision are deferred until you complete the report."];

  if (mealCount > 0) {
    lines.push(`Meals logged: ${mealCount}/5. You can keep adding lunch, dinner, and peri-workout meals later today.`);
  } else {
    lines.push("You can log breakfast or recovery data now and finish the rest tonight.");
  }

  if (report.performedDay !== "rest") {
    lines.push(
      recordedExercises > 0
        ? `Exercise entries recorded: ${recordedExercises}. You can continue filling the remaining lifts later.`
        : "Exercise cards stay in pending state, so the draft will not be treated as a completed workout.",
    );
  }

  lines.push("Use Complete Report when you want the final review.");

  return {
    title: "Today Draft",
    content: lines.join("\n"),
    basis: [],
    contextSummary: snapshot.plan.goal,
    source: "draft",
  };
}

function buildReportDraft(
  brief: DailyBrief,
  snapshot: DashboardSnapshot,
  date: string,
  existingReport?: SessionReport,
): ReportDraft {
  return {
    reportVersion: 2,
    date,
    performedDay: brief.calendarSlot,
    exerciseResults:
      existingReport?.exerciseResults && existingReport.exerciseResults.length > 0
        ? existingReport.exerciseResults
        : buildDefaultExerciseResults(brief),
    mealLog: existingReport?.mealLog ?? createEmptyMealLog(),
    trainingReportText: existingReport?.trainingReportText ?? "",
    bodyWeightKg: existingReport?.bodyWeightKg ?? snapshot.profile.currentWeightKg,
    sleepHours: existingReport?.sleepHours ?? snapshot.profile.sleepTargetHours,
    fatigue: existingReport?.fatigue ?? 5,
    painNotes: existingReport?.painNotes ?? "",
    recoveryNote: existingReport?.recoveryNote ?? "",
    completed: existingReport?.completed ?? false,
  };
}

async function postJson<T>(url: string, payload: unknown, method = "POST") {
  const parseResponseBody = (raw: string) => {
    const normalized = raw
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .replace(/^json\s*/i, "")
      .trim();
    if (!normalized) {
      return null;
    }
    return JSON.parse(normalized) as unknown;
  };

  const response = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const rawBody = await response.text();
  let parsedBody: unknown = null;
  if (rawBody.trim()) {
    try {
      parsedBody = parseResponseBody(rawBody);
    } catch (error) {
      if (response.ok) {
        const reason = error instanceof Error ? error.message : "Invalid JSON response";
        throw new Error(`Server returned invalid JSON: ${reason}`);
      }
      throw new Error(`Request failed (${response.status})`);
    }
  }

  if (!response.ok) {
    const errorMessage =
      parsedBody && typeof parsedBody === "object" && "error" in parsedBody && typeof parsedBody.error === "string"
        ? parsedBody.error
        : "Request failed";
    throw new Error(errorMessage);
  }

  return parsedBody as T;
}

function buildInitialCoachReply(snapshot: DashboardSnapshot, existingReport?: SessionReport): CoachReplyState {
  if (existingReport?.dailyReviewMarkdown) {
    return {
      title: "今日点评",
      content: existingReport.dailyReviewMarkdown,
      basis: [],
      contextSummary: snapshot.plan.goal,
      source: "review",
    };
  }

  if (existingReport && !existingReport.completed) {
    return buildDraftCoachReply(snapshot, existingReport);
  }

  const latestAssistant = [...snapshot.chatMessages].reverse().find((message) => message.role === "assistant");
  if (latestAssistant) {
    return {
      title: "最近一次教练回复",
      content: latestAssistant.content,
      basis: latestAssistant.basis,
      contextSummary: snapshot.plan.goal,
      source: "coach",
    };
  }

  return {
    title: "教练问答",
    content: "这里可以问训练理论、饮食策略和恢复安排。提交今日汇报后，这里也会自动显示当天点评。",
    basis: [],
    contextSummary: snapshot.persona.mission,
    source: "coach",
  };
}

function getFlowStatusClass(tone: "pending" | "active" | "ready") {
  if (tone === "ready") {
    return "border-[#b5d56b] bg-[#eff8d4] text-[#1d2612]";
  }
  if (tone === "active") {
    return "border-[#d5ff63]/40 bg-[#d5ff63] text-[#151811]";
  }
  return "border-black/10 bg-[#f7f3e8] text-black/56";
}

interface ReportFlowCardProps {
  step: string;
  title: string;
  summary: string;
  status: string;
  tone: "pending" | "active" | "ready";
  active: boolean;
  onSelect: () => void;
  children: ReactNode;
}

function ReportFlowCard({
  step,
  title,
  summary,
  status,
  tone,
  active,
  onSelect,
  children,
}: ReportFlowCardProps) {
  return (
    <section
      className={`overflow-hidden rounded-[26px] border transition ${
        active ? "border-[#151811] bg-white shadow-[0_24px_60px_rgba(18,22,16,0.12)]" : "border-black/10 bg-white/82"
      }`}
    >
      <button
        type="button"
        onClick={onSelect}
        className="flex w-full items-start justify-between gap-4 px-4 py-4 text-left sm:px-5 sm:py-5"
        aria-expanded={active}
      >
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-[0.26em] text-black/42">{step}</div>
          <h3 className="mt-2 text-lg font-semibold text-[#151811]">{title}</h3>
          <p className="mt-2 text-sm leading-6 text-black/56">{summary}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span
            className={`rounded-full border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] ${getFlowStatusClass(
              tone,
            )}`}
          >
            {status}
          </span>
          <span className="rounded-full border border-black/10 bg-white px-2.5 py-1 text-xs text-black/48">
            {active ? "收起" : "展开"}
          </span>
        </div>
      </button>

      {active ? <div className="border-t border-black/8 px-4 py-4 sm:px-5 sm:py-5">{children}</div> : null}
    </section>
  );
}

interface HomeDashboardProps {
  snapshot: DashboardSnapshot;
  today: string;
  currentDate: string;
  todayBrief: DailyBrief;
  reportHistory: SessionReport[];
  trainingReschedules: TrainingReschedule[];
  isHistorical?: boolean;
  historyMissingSnapshot?: boolean;
}

export function HomeDashboard({
  snapshot,
  today,
  currentDate,
  todayBrief,
  reportHistory,
  trainingReschedules,
  isHistorical = false,
  historyMissingSnapshot = false,
}: HomeDashboardProps) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [submissionMode, setSubmissionMode] = useState<"draft" | "completed" | null>(null);
  const [isAsking, startAskTransition] = useTransition();
  const [isRescheduling, startRescheduleTransition] = useTransition();
  const existingReport = findReportForDate(reportHistory, today);
  const [coachInput, setCoachInput] = useState("");
  const [coachReply, setCoachReply] = useState<CoachReplyState>(() =>
    buildInitialCoachReply(snapshot, existingReport ?? undefined),
  );
  const [reportDraft, setReportDraft] = useState(() =>
    buildReportDraft(todayBrief, snapshot, today, existingReport ?? undefined),
  );
  const [hasExerciseEdits, setHasExerciseEdits] = useState(() => Boolean(existingReport?.exerciseResults?.length));
  const [mealLogDirty, setMealLogDirty] = useState(false);
  const [postponeDate, setPostponeDate] = useState(() => shiftIsoDate(today, 1));
  const [selectedMissedDate, setSelectedMissedDate] = useState("");
  const [activeFlowStep, setActiveFlowStep] = useState<ReportFlowStep>("training");
  const isSubmitting = submissionMode !== null;
  const setIsSubmitting = (value: boolean) => setSubmissionMode(value ? "completed" : null);
  const inboundReschedule = findInboundReschedule(trainingReschedules, today);
  const outboundReschedule = findOutboundReschedule(trainingReschedules, today);
  const activeReschedule = outboundReschedule ?? inboundReschedule;
  const missedTrainingEntries = listMissedTrainingEntries({
    plan: snapshot.plan as LongTermPlan,
    reports: reportHistory,
    reschedules: trainingReschedules,
    today,
  });
  const hasMealContent = MEAL_SLOTS.some((slot) => reportDraft.mealLog[slot.key].content.trim().length > 0);
  const hasReadyNutrition =
    !mealLogDirty &&
    existingReport?.nutritionComputation?.status === "ready" &&
    Boolean(existingReport.nutritionTotals) &&
    Boolean(existingReport.nutritionGap);
  const nutritionPendingMessage = hasMealContent
    ? mealLogDirty
      ? "Meal content changed. Save again to trigger AI recomputation."
      : existingReport?.nutritionWarnings?.[0] ?? "Nutrition is pending AI computation. Please retry save later."
    : "After entering meals, save draft or submit to trigger AI computation.";
  const previewMealLog = reportDraft.mealLog;
  const exerciseTargetCount = todayBrief.workoutPrescription.exercises.length;
  const loggedExerciseCount = reportDraft.exerciseResults.filter(
    (exercise) =>
      exercise.actualSets > 0 ||
      exercise.topSetWeightKg != null ||
      exercise.performed !== false ||
      (exercise.notes?.trim().length ?? 0) > 0,
  ).length;
  const filledMealCount = countFilledMealSlots(reportDraft.mealLog);
  const recoveryNoteCount = [reportDraft.painNotes, reportDraft.recoveryNote, reportDraft.trainingReportText].filter(
    (item) => item.trim().length > 0,
  ).length;
  const recoverySignalsTouched =
    reportDraft.bodyWeightKg !== snapshot.profile.currentWeightKg ||
    reportDraft.sleepHours !== snapshot.profile.sleepTargetHours ||
    reportDraft.fatigue !== 5 ||
    recoveryNoteCount > 0;
  const trainingSummary = todayBrief.isRestDay
    ? "今天是恢复日，动作记录会自动跳过，重点放在饮食和恢复。"
    : loggedExerciseCount
      ? `已记录 ${loggedExerciseCount}/${exerciseTargetCount} 个动作，继续补齐今天的真实执行。`
      : "先从今天实际完成的动作开始填写，按真实执行情况记录即可。";
  const nutritionSummary = filledMealCount
    ? hasReadyNutrition
      ? `已填写 ${filledMealCount}/5 个餐次，营养估算已可查看。`
      : `已填写 ${filledMealCount}/5 个餐次，保存草稿或提交后会重新计算营养。`
    : "先填写今天已经吃掉的餐次，剩余餐次可以晚些补录。";
  const recoverySummary = recoverySignalsTouched
    ? recoveryNoteCount
      ? `基础恢复信号已就绪，另有 ${recoveryNoteCount} 条补充备注。`
      : "体重、睡眠和疲劳基线已就绪，可以补充异常或时间错位说明。"
    : "补充恢复感受、疼痛或时间错位，会让点评更准确。";
  const actionSummary = todayBrief.isRestDay
    ? `恢复日记录 · 餐次 ${filledMealCount}/5 · 补充备注 ${recoveryNoteCount}`
    : `动作 ${loggedExerciseCount}/${exerciseTargetCount} · 餐次 ${filledMealCount}/5 · 恢复备注 ${recoveryNoteCount}`;

  useEffect(() => {
    const report = findReportForDate(reportHistory, today);
    setReportDraft(buildReportDraft(todayBrief, snapshot, today, report ?? undefined));
    setCoachReply(buildInitialCoachReply(snapshot, report ?? undefined));
    setHasExerciseEdits(Boolean(report?.exerciseResults?.length));
    setMealLogDirty(false);
    setShowAdvanced(false);
    setPostponeDate(shiftIsoDate(today, 1));
    if (outboundReschedule || inboundReschedule) {
      setPostponeDate((outboundReschedule ?? inboundReschedule)?.targetDate ?? shiftIsoDate(today, 1));
    }
    setSelectedMissedDate("");
  }, [inboundReschedule, outboundReschedule, reportHistory, snapshot, today, todayBrief]);

  useEffect(() => {
    const storedFeedback = window.sessionStorage.getItem(REPORT_FEEDBACK_KEY);
    if (!storedFeedback) {
      setFeedback(null);
      return;
    }

    try {
      const parsed = JSON.parse(storedFeedback) as FeedbackState | StoredReportState;
      if ("feedback" in parsed) {
        setFeedback(parsed.feedback);
        const panel = parsed.panel ?? parsed.review;
        if (panel) {
          setCoachReply({
            title: panel.title,
            content: panel.content,
            basis: [],
            contextSummary: snapshot.plan.goal,
            source: panel.source,
          });
        }
      } else {
        setFeedback(parsed);
      }
    } finally {
      window.sessionStorage.removeItem(REPORT_FEEDBACK_KEY);
    }
  }, [snapshot.plan.goal, today, todayBrief.id]);

  useEffect(() => {
    setActiveFlowStep("training");
  }, [today]);

  function updateMeal(
    field: keyof Omit<MealLog, "postWorkoutSource">,
    patch: Partial<MealLog[keyof Omit<MealLog, "postWorkoutSource">]>,
  ) {
    setMealLogDirty(true);
    const invalidatesNutrition =
      Object.prototype.hasOwnProperty.call(patch, "content") ||
      Object.prototype.hasOwnProperty.call(patch, "cookingMethod") ||
      Object.prototype.hasOwnProperty.call(patch, "rinseOil");
    setReportDraft((current) => ({
      ...current,
      mealLog: {
        ...current.mealLog,
        [field]: {
          ...current.mealLog[field],
          ...patch,
          ...(invalidatesNutrition
            ? { parsedItems: [], nutritionEstimate: undefined, analysisWarnings: [] }
            : {}),
        },
      },
    }));
  }

  function updatePostWorkoutSource(source: MealLog["postWorkoutSource"]) {
    setMealLogDirty(true);
    setReportDraft((current) => ({
      ...current,
      mealLog: {
        ...current.mealLog,
        postWorkoutSource: source,
      },
    }));
  }

  function updateTrainingReport(value: string) {
    setReportDraft((current) => ({
      ...current,
      trainingReportText: value,
    }));
  }

  function updateExercise(index: number, patch: Partial<ExerciseResult>) {
    setHasExerciseEdits(true);
    setReportDraft((current) => ({
      ...current,
      exerciseResults: current.exerciseResults.map((exercise, exerciseIndex) =>
        exerciseIndex === index ? { ...exercise, ...patch } : exercise,
      ),
    }));
  }

  function sendCoachMessage() {
    if (!coachInput.trim()) {
      return;
    }

    const message = coachInput.trim();
    setCoachInput("");

    startAskTransition(async () => {
      try {
        const data = await postJson<CoachChatResponse>("/api/assistant/chat", { message });
        setCoachReply({
          title: "教练回答",
          content: data.answer,
          basis: data.basis,
          contextSummary: data.contextSummary,
          source: "coach",
        });
      } catch (error) {
        setCoachReply({
          title: "Coach reply failed",
          content: error instanceof Error ? error.message : "Request failed. Please retry later.",
          basis: [],
          contextSummary: snapshot.plan.goal,
          source: "error",
        });
      }
    });
  }

  function submitTrainingReschedule(sourceDate: string, targetDate: string) {
    startRescheduleTransition(async () => {
      try {
        const response = await postJson<TrainingRescheduleResponse>("/api/training-reschedules", {
          sourceDate,
          targetDate,
        });
        const direction = response.reschedule.action === "postpone" ? "已顺延" : "已提到今天";
        setFeedback({
          tone: "success",
          message: `${response.reschedule.sourceLabel} ${direction}，目标日期 ${response.reschedule.targetDate}。`,
        });
        router.refresh();
      } catch (error) {
        setFeedback({
          tone: "error",
          message: error instanceof Error ? error.message : "调整训练日失败。",
        });
      }
    });
  }

  function updateTrainingReschedule(id: string, targetDate: string) {
    startRescheduleTransition(async () => {
      try {
        const response = await postJson<TrainingRescheduleResponse>(
          "/api/training-reschedules",
          {
            id,
            targetDate,
          },
          "PATCH",
        );
        setFeedback({
          tone: "success",
          message: `${response.reschedule.sourceLabel} 已改期到 ${response.reschedule.targetDate}。`,
        });
        router.refresh();
      } catch (error) {
        setFeedback({
          tone: "error",
          message: error instanceof Error ? error.message : "改期失败。",
        });
      }
    });
  }

  function cancelTrainingReschedule(id: string) {
    startRescheduleTransition(async () => {
      try {
        await postJson<TrainingRescheduleDeleteResponse>("/api/training-reschedules", { id }, "DELETE");
        setFeedback({
          tone: "success",
          message: "已取消这条训练顺延。",
        });
        router.refresh();
      } catch (error) {
        setFeedback({
          tone: "error",
          message: error instanceof Error ? error.message : "取消顺延失败。",
        });
      }
    });
  }

  async function handleSubmitReport() {
    setIsSubmitting(true);
    setFeedback({ tone: "info", message: "正在保存今日记录并生成点评..." });

    try {
      const payload: ReportDraft = {
        ...reportDraft,
        date: today,
        reportVersion: 2,
        performedDay: todayBrief.calendarSlot,
        exerciseResults: todayBrief.isRestDay ? [] : reportDraft.exerciseResults,
        completed: true,
        mealLog: buildMealLogForSubmit(reportDraft.mealLog),
      };

      const data = await postJson<SessionReportResponse>("/api/session-report", payload);
      const successFeedback = {
        tone: "success",
        message: "Today report saved. Review updated.",
      } satisfies FeedbackState;
      const reviewCard = {
        title: `${todayBrief.calendarLabel} Daily Review`,
        content: data.review ?? "",
        source: "review" as const,
      };

      window.sessionStorage.setItem(
        REPORT_FEEDBACK_KEY,
        JSON.stringify({
          feedback: successFeedback,
          review: reviewCard,
        } satisfies StoredReportState),
      );

      setCoachReply({
        title: reviewCard.title,
        content: reviewCard.content,
        basis: [],
        contextSummary: snapshot.plan.goal,
        source: "review",
      });
      setMealLogDirty(false);
      setFeedback({ tone: "success", message: "Today report saved. Refreshing latest state..." });
      router.refresh();
    } catch (error) {
      setFeedback({
        tone: "error",
        message: error instanceof Error ? error.message : "Submit failed. Please retry later.",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  function buildExerciseResultsForSubmit(completed: boolean) {
    if (todayBrief.isRestDay) {
      return [] as ExerciseResult[];
    }

    if (completed) {
      return reportDraft.exerciseResults;
    }

    return hasExerciseEdits || existingReport?.exerciseResults?.length ? reportDraft.exerciseResults : [];
  }

  async function handleSaveDraft() {
    setSubmissionMode("draft");
    setFeedback({ tone: "info", message: "Saving draft..." });

    try {
      const payload: ReportDraft = {
        ...reportDraft,
        date: today,
        reportVersion: 2,
        performedDay: todayBrief.calendarSlot,
        exerciseResults: buildExerciseResultsForSubmit(false),
        completed: false,
        mealLog: buildMealLogForSubmit(reportDraft.mealLog),
      };

      const data = await postJson<SessionReportResponse>("/api/session-report", payload);
      const draftCard = {
        title: "Today Draft",
        content: buildDraftCoachReply(snapshot, data.report).content,
        source: "draft" as const,
      };

      window.sessionStorage.setItem(
        REPORT_FEEDBACK_KEY,
        JSON.stringify({
          feedback: {
            tone: "success",
            message: "Draft saved. You can keep updating meals and workout details today.",
          } satisfies FeedbackState,
          panel: draftCard,
        } satisfies StoredReportState),
      );

      setCoachReply({
        title: draftCard.title,
        content: draftCard.content,
        basis: [],
        contextSummary: snapshot.plan.goal,
        source: draftCard.source,
      });
      setMealLogDirty(false);
      setFeedback({ tone: "success", message: "Draft saved. Refreshing the latest state..." });
      router.refresh();
    } catch (error) {
      setFeedback({
        tone: "error",
        message: error instanceof Error ? error.message : "Failed to save draft",
      });
    } finally {
      setSubmissionMode(null);
    }
  }

  const feedbackClass =
    feedback?.tone === "success"
      ? "border-[#b5d56b] bg-[#eff8d4] text-[#1d2612]"
      : feedback?.tone === "error"
        ? "border-[#e6b5a8] bg-[#fff0eb] text-[#7c2f1f]"
        : "border-[#d9d0b9] bg-[#faf4e3] text-[#3d3425]";

  return (
    <div className="grid gap-5 pb-[calc(12rem+env(safe-area-inset-bottom))] sm:pb-[calc(10rem+env(safe-area-inset-bottom))]">
      {isHistorical ? (
        <SectionCard
          eyebrow="History"
          title={`Backfill ${todayBrief.calendarLabel}`}
          description={
            historyMissingSnapshot
              ? "No historical plan snapshot for this date. Showing fallback schedule."
              : "You are viewing a historical date and can backfill that day's report directly."
          }
          className="bg-[rgba(249,247,235,0.96)]"
        >
          <div className="rounded-[20px] border border-black/10 bg-[#151811] px-4 py-4 text-sm text-white/78">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <div>{`Viewing date: ${today}${todayBrief.isRestDay ? " · Rest day" : ""}`}</div>
                <div className="text-white/56">
                  {`Today in Beijing is ${currentDate}. Reschedule actions are only available on the real current-day board.`}
                </div>
              </div>
              <button
                type="button"
                onClick={() => router.replace("/")}
                className="inline-flex items-center justify-center rounded-full bg-[#d5ff63] px-4 py-2 text-sm font-semibold text-[#151811] transition hover:bg-[#c2f24a]"
              >
                Back to Today
              </button>
            </div>
          </div>
        </SectionCard>
      ) : null}

      <SectionCard
        eyebrow={isHistorical ? "Viewed Date" : "Today"}
        title={isHistorical ? "Historical Board" : "Today Board"}
        className="overflow-hidden"
      >
        <div className="rounded-[24px] bg-[#151811] p-3 text-white shadow-[0_22px_56px_rgba(18,22,16,0.24)] sm:p-4">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
            <div className="rounded-[18px] border border-white/10 bg-white/6 px-4 py-3.5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[10px] uppercase tracking-[0.26em] text-white/42">Training Identity</div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-white/10 bg-white/8 px-2.5 py-1 text-[11px] font-semibold text-white/76">
                      {today}
                    </span>
                    <span className="rounded-full border border-[#d5ff63]/20 bg-[#d5ff63]/12 px-2.5 py-1 text-[11px] font-semibold text-[#dffb95]">
                      {todayBrief.isRestDay ? "Rest Day" : `Day ${todayBrief.calendarSlot}`}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap items-end gap-x-3 gap-y-2">
                    <span className="font-display text-[28px] leading-none text-[#d5ff63] sm:text-[34px]">
                      {todayBrief.calendarLabel}
                    </span>
                    <span className="break-words text-sm font-semibold text-white/86 sm:text-base">
                      {todayBrief.workoutPrescription.title}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-[18px] border border-white/10 bg-white/5 px-3.5 py-3">
                <div className="text-[10px] uppercase tracking-[0.24em] text-white/42">Meal Split</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {todayBrief.mealPrescription.meals.map((meal) => (
                    <div
                      key={meal.label}
                      className="rounded-full border border-white/10 bg-black/10 px-3 py-1.5 text-xs text-white/78"
                    >
                      <span className="text-white/58">{meal.label}</span>
                      <span className="ml-2 font-semibold text-white">{meal.sharePercent}%</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-[18px] border border-white/10 bg-white/5 px-3.5 py-3">
                <div className="text-[10px] uppercase tracking-[0.24em] text-white/42">Macro Targets</div>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {[
                    { label: "C", value: `${todayBrief.mealPrescription.macros.carbsG}g` },
                    { label: "P", value: `${todayBrief.mealPrescription.macros.proteinG}g` },
                    { label: "F", value: `${todayBrief.mealPrescription.macros.fatsG}g` },
                  ].map((item) => (
                    <div
                      key={item.label}
                      className="rounded-[14px] border border-white/10 bg-black/10 px-2 py-2.5 text-center"
                    >
                      <div className="text-[10px] uppercase tracking-[0.2em] text-white/42">{item.label}</div>
                      <div className="mt-1 text-sm font-semibold text-white">{item.value}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </SectionCard>

      {!isHistorical ? (
        <SectionCard eyebrow="Reschedule" title="训练日调整">
          {activeReschedule ? (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
              <div className="rounded-[24px] border border-black/10 bg-white/82 p-4">
                <div className="text-[11px] uppercase tracking-[0.22em] text-black/42">Manage</div>
                <h3 className="mt-1 text-lg font-semibold text-[#151811]">已设置的顺延</h3>
                <div className="mt-3 rounded-[18px] border border-black/10 bg-[#faf7ef] px-4 py-3 text-sm leading-6 text-[#151811]">
                  <div>原训练日：{activeReschedule.sourceDate}</div>
                  <div>当前目标日：{activeReschedule.targetDate}</div>
                  <div>计划标签：{activeReschedule.sourceLabel}</div>
                </div>
                <p className="mt-3 text-sm leading-6 text-black/54">
                  {activeReschedule.targetDate === today
                    ? "这条训练已经被提到今天执行。你可以继续改到别的日期，或者直接取消这次顺延。"
                    : "这条训练已经改期。你可以修改目标日期，或者直接取消这次顺延。"}
                </p>
                <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                  <input
                    type="date"
                    min={shiftIsoDate(activeReschedule.sourceDate, 1)}
                    value={postponeDate}
                    onChange={(event) => setPostponeDate(event.target.value)}
                    className="w-full rounded-[16px] border border-black/10 bg-[#faf7ef] px-3 py-3 text-sm text-[#151811] outline-none"
                  />
                  <button
                    type="button"
                    disabled={isRescheduling || !postponeDate || postponeDate <= activeReschedule.sourceDate}
                    onClick={() => updateTrainingReschedule(activeReschedule.id, postponeDate)}
                    className="rounded-full bg-[#151811] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#23271d] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isRescheduling ? "处理中..." : "改到该日期"}
                  </button>
                </div>
                <button
                  type="button"
                  disabled={isRescheduling}
                  onClick={() => cancelTrainingReschedule(activeReschedule.id)}
                  className="mt-3 rounded-full border border-[#d6b9ac] bg-[#fff1ec] px-5 py-3 text-sm font-semibold text-[#8a3524] transition hover:bg-[#ffe5dc] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isRescheduling ? "处理中..." : "取消顺延"}
                </button>
              </div>

              <div className="rounded-[24px] border border-black/10 bg-white/82 p-4">
                <div className="text-[11px] uppercase tracking-[0.22em] text-black/42">Notice</div>
                <h3 className="mt-1 text-lg font-semibold text-[#151811]">使用说明</h3>
                <div className="mt-3 space-y-2 text-sm leading-6 text-black/58">
                  <p>一条训练日同一时间只能存在一条有效顺延记录。</p>
                  <p>如果目标日期已经有训练记录，或者该训练已经完成，就不能再改期或取消。</p>
                  <p>调整后首页和历史页会按新的执行日期显示。</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-[24px] border border-black/10 bg-white/82 p-4">
                <div className="text-[11px] uppercase tracking-[0.22em] text-black/42">Today To Future</div>
                <h3 className="mt-1 text-lg font-semibold text-[#151811]">顺延今天的训练</h3>
                <p className="mt-2 text-sm leading-6 text-black/54">
                  {todayBrief.rescheduledFromDate
                    ? `今天执行的是从 ${todayBrief.rescheduledFromDate} 调整过来的训练，当前日期不能再继续顺延。`
                    : "把今天原定的训练调整到之后的某一天，今天会按恢复日处理。"}
                </p>
                <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                  <input
                    type="date"
                    min={shiftIsoDate(today, 1)}
                    value={postponeDate}
                    onChange={(event) => setPostponeDate(event.target.value)}
                    className="w-full rounded-[16px] border border-black/10 bg-[#faf7ef] px-3 py-3 text-sm text-[#151811] outline-none"
                  />
                  <button
                    type="button"
                    disabled={isRescheduling || !postponeDate}
                    onClick={() => submitTrainingReschedule(today, postponeDate)}
                    className="rounded-full bg-[#151811] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#23271d] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isRescheduling ? "处理中..." : "确认顺延"}
                  </button>
                </div>
              </div>

              <div className="rounded-[24px] border border-black/10 bg-white/82 p-4">
                <div className="text-[11px] uppercase tracking-[0.22em] text-black/42">Past To Today</div>
                <h3 className="mt-1 text-lg font-semibold text-[#151811]">把漏训提到今天</h3>
                <p className="mt-2 text-sm leading-6 text-black/54">
                  {missedTrainingEntries.length
                    ? "从过去未完成的训练日里选一天，直接放到今天执行。"
                    : "当前没有可提到今天执行的漏训日。"}
                </p>
                <div className="mt-4 flex flex-col gap-3">
                  <select
                    value={selectedMissedDate}
                    onChange={(event) => setSelectedMissedDate(event.target.value)}
                    disabled={isRescheduling || !missedTrainingEntries.length}
                    className="w-full rounded-[16px] border border-black/10 bg-[#faf7ef] px-3 py-3 text-sm text-[#151811] outline-none disabled:opacity-60"
                  >
                    <option value="">选择一个漏训日</option>
                    {missedTrainingEntries.map((entry) => (
                      <option key={entry.date} value={entry.date}>
                        {entry.date} - {entry.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={isRescheduling || !selectedMissedDate}
                    onClick={() => submitTrainingReschedule(selectedMissedDate, today)}
                    className="rounded-full bg-[#d5ff63] px-5 py-3 text-sm font-semibold text-[#151811] transition hover:bg-[#c2f24a] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isRescheduling ? "处理中..." : "提到今天"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </SectionCard>
      ) : null}
      <SectionCard
        eyebrow="Execution"
        title="Today's plan and log"
        description="Submit your report from four blocks: training, meals, recovery, and summary."
      >
        <div className="space-y-4">
          {feedback ? (
            <div
              aria-live="polite"
              className={`rounded-[20px] border px-4 py-3 text-sm font-medium shadow-[0_12px_28px_rgba(25,21,14,0.08)] ${feedbackClass}`}
            >
              {feedback.message}
            </div>
          ) : null}

          {existingReport && !existingReport.completed ? (
            <div className="rounded-[20px] border border-[#e5d6ae] bg-[#fff6df] px-4 py-3 text-sm leading-6 text-[#5a4620]">
              Draft exists for today. Keep adding meals, recovery data, or workout details. Only Complete Report will
              generate the final review and next-day decision.
            </div>
          ) : null}

          {todayBrief.rescheduledFromDate || todayBrief.rescheduledToDate ? (
            <div className="rounded-[20px] border border-[#d9d0b9] bg-[#faf4e3] px-4 py-3 text-sm leading-6 text-[#5a4620]">
              {todayBrief.rescheduledFromDate && todayBrief.rescheduledFromDate !== today
                ? `当前执行的是 ${todayBrief.rescheduledFromDate} 的训练内容，实际记录日期仍然记在今天。`
                : todayBrief.rescheduledToDate
                  ? `这一天原定训练已顺延到 ${todayBrief.rescheduledToDate}，当前页面按恢复日处理。`
                  : `该训练原定日期为 ${todayBrief.scheduledDate}。`}
            </div>
          ) : null}

          <div className="rounded-[30px] bg-[#151811] p-4 text-white shadow-[0_24px_60px_rgba(18,22,16,0.16)] sm:p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <div className="text-[11px] uppercase tracking-[0.28em] text-white/42">Daily Report Flow</div>
                <h3 className="mt-2 text-xl font-semibold text-white">一次只专注一个区块，减少来回滚动</h3>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-white/62">
                  先记动作，再补餐次，最后补充恢复与备注。底部操作区会一直保留保存和提交入口。
                </p>
              </div>
              <div className="rounded-full border border-white/10 bg-white/8 px-3 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-white/74">
                {actionSummary}
              </div>
            </div>

            <div className="mt-4 grid gap-3 lg:grid-cols-3">
              {[
                {
                  key: "training" as const,
                  label: "Step 1",
                  title: "动作执行",
                  summary: trainingSummary,
                  status: todayBrief.isRestDay
                    ? "Rest day"
                    : loggedExerciseCount >= exerciseTargetCount && exerciseTargetCount > 0
                      ? "Ready"
                      : loggedExerciseCount > 0
                        ? "In progress"
                        : "Pending",
                },
                {
                  key: "nutrition" as const,
                  label: "Step 2",
                  title: "餐次记录",
                  summary: nutritionSummary,
                  status: hasReadyNutrition ? "Computed" : filledMealCount > 0 ? "In progress" : "Pending",
                },
                {
                  key: "recovery" as const,
                  label: "Step 3",
                  title: "恢复与备注",
                  summary: recoverySummary,
                  status: recoverySignalsTouched ? "Updated" : "Baseline",
                },
              ].map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setActiveFlowStep(item.key)}
                  className={`rounded-[22px] border px-4 py-4 text-left transition ${
                    activeFlowStep === item.key ? "border-[#d5ff63]/45 bg-[#d5ff63] text-[#151811]" : "border-white/10 bg-white/6 text-white"
                  }`}
                >
                  <div className={`text-[10px] uppercase tracking-[0.24em] ${activeFlowStep === item.key ? "text-[#151811]/56" : "text-white/42"}`}>
                    {item.label}
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <div className="text-lg font-semibold">{item.title}</div>
                    <span
                      className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${
                        activeFlowStep === item.key ? "bg-[#151811] text-white/78" : "bg-white/10 text-white/72"
                      }`}
                    >
                      {item.status}
                    </span>
                  </div>
                  <div className={`mt-2 text-sm leading-6 ${activeFlowStep === item.key ? "text-[#151811]/72" : "text-white/62"}`}>
                    {item.summary}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <ReportFlowCard
            step="Step 1"
            title="动作执行"
            summary={trainingSummary}
            status={
              todayBrief.isRestDay
                ? "Rest day"
                : loggedExerciseCount >= exerciseTargetCount && exerciseTargetCount > 0
                  ? "Ready"
                  : loggedExerciseCount > 0
                    ? "In progress"
                    : "Pending"
            }
            tone={
              activeFlowStep === "training"
                ? "active"
                : todayBrief.isRestDay || (loggedExerciseCount >= exerciseTargetCount && exerciseTargetCount > 0)
                  ? "ready"
                  : "pending"
            }
            active={activeFlowStep === "training"}
            onSelect={() => setActiveFlowStep("training")}
          >
            <div className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-[11px] uppercase tracking-[0.28em] text-black/42">Workout Execution</div>
                <h3 className="mt-1 text-lg font-semibold text-[#151811]">动作执行</h3>
              </div>
              <div className="w-fit rounded-full bg-[#d5ff63] px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-[#151811]">
                {todayBrief.calendarLabel}
              </div>
            </div>

            <div className="mt-2 text-sm leading-6 text-black/54">
              {todayBrief.isRestDay
                ? "Today is a rest day. No exercise execution input is required."
                : "Fill each exercise with actual completion data for today's report."}
            </div>

            {todayBrief.workoutPrescription.exercises.length ? (
              <div className="rounded-[26px] border border-black/10 bg-[linear-gradient(135deg,#fffdf7_0%,#f3eddc_100%)] p-4 shadow-[0_16px_40px_rgba(25,21,14,0.08)] sm:p-5">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.24em] text-black/42">Today&apos;s Prescription</div>
                    <h4 className="mt-2 text-xl font-semibold text-[#151811]">今日动作速览</h4>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-black/58">
                      先快速确认今天每个动作的目标组次、建议重量和休息时间，再跳到下方录入真实执行。
                    </p>
                  </div>
                  <div className="rounded-full border border-black/10 bg-white px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-[#151811]">
                    {todayBrief.workoutPrescription.title}
                  </div>
                </div>

                {todayBrief.workoutPrescription.warmup.length ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {todayBrief.workoutPrescription.warmup.map((item) => (
                      <span
                        key={item}
                        className="rounded-full border border-black/10 bg-white/78 px-3 py-1.5 text-xs text-black/58"
                      >
                        热身 · {item}
                      </span>
                    ))}
                  </div>
                ) : null}

                <div className="mt-4 grid gap-3 xl:grid-cols-2">
                  {todayBrief.workoutPrescription.exercises.map((prescription, index) => {
                    const draftExercise = reportDraft.exerciseResults[index];
                    const isRecorded = (draftExercise?.actualSets ?? 0) > 0;
                    const isSkipped = draftExercise?.performed === false;
                    const statusLabel = isRecorded ? `已记录 ${draftExercise.actualSets} 组` : isSkipped ? "未开始" : "待填写";
                    const statusClass = isRecorded
                      ? "border-[#b5d56b] bg-[#eff8d4] text-[#314015]"
                      : isSkipped
                        ? "border-black/10 bg-white text-black/48"
                        : "border-[#e5d6ae] bg-[#fff6df] text-[#6a541f]";

                    return (
                      <button
                        key={`${prescription.name}-${index}`}
                        type="button"
                        onClick={() =>
                          document.getElementById(`exercise-card-${index}`)?.scrollIntoView({
                            behavior: "smooth",
                            block: "center",
                          })
                        }
                        className="group rounded-[22px] border border-black/10 bg-white/88 p-4 text-left transition hover:-translate-y-0.5 hover:border-black/18 hover:shadow-[0_18px_38px_rgba(25,21,14,0.08)]"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-[10px] uppercase tracking-[0.24em] text-black/38">Action {index + 1}</div>
                            <div className="mt-2 text-base font-semibold text-[#151811]">{prescription.name}</div>
                            <div className="mt-1 text-sm text-black/52">{prescription.focus}</div>
                          </div>
                          <span
                            className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${statusClass}`}
                          >
                            {statusLabel}
                          </span>
                        </div>

                        <div className="mt-4 flex flex-wrap gap-2">
                          <span className="rounded-full bg-[#151811] px-3 py-1.5 text-xs font-semibold text-white">
                            {prescription.sets} 组 x {prescription.reps}
                          </span>
                          <span className="rounded-full border border-black/10 bg-[#f7f3e8] px-3 py-1.5 text-xs text-[#151811]">
                            {formatSuggestedWeightLabel(prescription.suggestedWeightKg)}
                          </span>
                          <span className="rounded-full border border-black/10 bg-[#f7f3e8] px-3 py-1.5 text-xs text-[#151811]">
                            {formatRestLabel(prescription.restSeconds)}
                          </span>
                        </div>

                        {prescription.cues.length ? (
                          <div className="mt-4 flex flex-wrap gap-2">
                            {prescription.cues.slice(0, 2).map((cue) => (
                              <span
                                key={`${prescription.name}-${cue}`}
                                className="rounded-full border border-black/10 bg-white px-3 py-1.5 text-xs text-black/54"
                              >
                                {cue}
                              </span>
                            ))}
                          </div>
                        ) : null}

                        <div className="mt-4 text-xs font-medium text-black/44 transition group-hover:text-black/60">
                          {isRecorded
                            ? `当前填写：${draftExercise.actualSets} 组，${draftExercise.actualReps || prescription.reps}`
                            : "点击跳到下方执行录入"}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            <div className="flex items-center justify-between gap-3">
              <div className="text-[11px] uppercase tracking-[0.24em] text-black/42">Execution Entry</div>
              <div className="text-xs text-black/48">按速览顺序填写下方实际执行结果</div>
            </div>

            <div className="mt-4 space-y-3">
              {todayBrief.workoutPrescription.exercises.length ? (
                reportDraft.exerciseResults.map((exercise, index) => (
                  <article
                    key={exercise.exerciseName}
                    id={`exercise-card-${index}`}
                    className="rounded-[20px] border border-black/10 bg-[#faf7ef] p-4"
                  >
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-[#151811]">{exercise.exerciseName}</div>
                        <div className="mt-1 text-xs text-black/52">
                          目标 {exercise.targetSets} x {exercise.targetReps}
                        </div>
                      </div>
                      <label className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-3 py-2 text-xs font-semibold text-[#151811]">
                        <input
                          type="checkbox"
                          checked={exercise.performed !== false}
                          onChange={(event) =>
                            updateExercise(index, {
                              performed: event.target.checked,
                              actualSets: event.target.checked ? exercise.actualSets || exercise.targetSets : 0,
                              topSetWeightKg: event.target.checked
                                ? exercise.topSetWeightKg ?? todayBrief.workoutPrescription.exercises[index]?.suggestedWeightKg
                                : undefined,
                            })
                          }
                          className="h-4 w-4 accent-[#151811]"
                        />
                        已执行
                      </label>
                    </div>

                    <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                      <label className="block rounded-[16px] border border-black/10 bg-white px-3 py-3">
                        <span className="text-[11px] uppercase tracking-[0.2em] text-black/42">实际组数</span>
                        <input
                          type="number"
                          min="0"
                          value={exercise.actualSets}
                          onChange={(event) => updateExercise(index, { actualSets: Number(event.target.value) })}
                          className="mt-2 w-full bg-transparent text-lg font-semibold text-[#151811] outline-none"
                        />
                      </label>
                      <label className="block rounded-[16px] border border-black/10 bg-white px-3 py-3">
                        <span className="text-[11px] uppercase tracking-[0.2em] text-black/42">实际次数</span>
                        <input
                          value={exercise.actualReps}
                          onChange={(event) => updateExercise(index, { actualReps: event.target.value })}
                          className="mt-2 w-full bg-transparent text-lg font-semibold text-[#151811] outline-none"
                        />
                      </label>
                      <label className="block rounded-[16px] border border-black/10 bg-white px-3 py-3">
                        <span className="text-[11px] uppercase tracking-[0.2em] text-black/42">顶组重量 kg</span>
                        <input
                          type="number"
                          step="0.5"
                          min="0"
                          value={exercise.topSetWeightKg ?? ""}
                          onChange={(event) =>
                            updateExercise(index, {
                              topSetWeightKg: event.target.value ? Number(event.target.value) : undefined,
                            })
                          }
                          className="mt-2 w-full bg-transparent text-lg font-semibold text-[#151811] outline-none"
                          placeholder={String(todayBrief.workoutPrescription.exercises[index]?.suggestedWeightKg ?? "")}
                        />
                      </label>
                      <label className="block rounded-[16px] border border-black/10 bg-white px-3 py-3">
                        <span className="text-[11px] uppercase tracking-[0.2em] text-black/42">RPE</span>
                        <input
                          type="number"
                          min="1"
                          max="10"
                          step="0.1"
                          value={exercise.rpe}
                          onChange={(event) => updateExercise(index, { rpe: Number(event.target.value) })}
                          className="mt-2 w-full bg-transparent text-lg font-semibold text-[#151811] outline-none"
                        />
                      </label>
                      <label className="flex items-center gap-3 rounded-[16px] border border-black/10 bg-white px-3 py-3 text-sm text-[#151811]">
                        <input
                          type="checkbox"
                          checked={exercise.droppedSets}
                          onChange={(event) => updateExercise(index, { droppedSets: event.target.checked })}
                          className="h-4 w-4 accent-[#151811]"
                        />
                        有掉组 / 明显掉速
                      </label>
                    </div>

                    <label className="mt-3 block rounded-[16px] border border-black/10 bg-white px-3 py-3">
                      <span className="text-[11px] uppercase tracking-[0.2em] text-black/42">动作备注</span>
                      <textarea
                        rows={2}
                        value={exercise.notes ?? ""}
                        onChange={(event) => updateExercise(index, { notes: event.target.value })}
                        className="mt-2 w-full resize-none bg-transparent text-sm leading-6 text-[#151811] outline-none"
                        placeholder="Example: last two sets slowed down, shoulder discomfort, swapped equipment version."
                      />
                    </label>
                  </article>
                ))
              ) : (
                <div className="rounded-[20px] border border-black/10 bg-[#faf7ef] px-4 py-4 text-sm leading-6 text-black/60">
                  Today is mapped to a rest day. Prioritize light activity, mobility, and recovery nutrition.
                </div>
              )}
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setActiveFlowStep("nutrition")}
                className="rounded-full border border-black/10 bg-[#f7f3e8] px-4 py-2.5 text-sm font-semibold text-[#151811] transition hover:bg-[#efe8d4]"
              >
                下一步：餐次记录
              </button>
            </div>
          </div>
          </ReportFlowCard>

          <ReportFlowCard
            step="Step 2"
            title="餐次记录"
            summary={nutritionSummary}
            status={hasReadyNutrition ? "Computed" : filledMealCount > 0 ? "In progress" : "Pending"}
            tone={activeFlowStep === "nutrition" ? "active" : hasReadyNutrition ? "ready" : "pending"}
            active={activeFlowStep === "nutrition"}
            onSelect={() => setActiveFlowStep("nutrition")}
          >
            <div className="space-y-4">
            <div className="text-[11px] uppercase tracking-[0.22em] text-black/42">Meal Execution</div>
            <h3 className="mt-1 text-lg font-semibold text-[#151811]">餐次执行</h3>
            <div className="mt-4 flex flex-wrap gap-2">
              {POST_WORKOUT_SOURCE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => updatePostWorkoutSource(option.value)}
                  className={`rounded-full px-3 py-2 text-xs font-semibold transition ${
                    reportDraft.mealLog.postWorkoutSource === option.value
                      ? "bg-[#151811] text-white"
                      : "border border-black/10 bg-[#f7f3e8] text-[#151811]"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <div className="mt-4 rounded-[20px] border border-black/10 bg-[#faf7ef] px-4 py-4">
              <div className="text-[11px] uppercase tracking-[0.22em] text-black/42">Nutrition Preview</div>
              {hasReadyNutrition && existingReport?.nutritionTotals && existingReport.nutritionGap ? (
                <>
                  <div className="mt-2 text-sm font-semibold text-[#151811]">
                    {formatNutritionSummary(
                      existingReport.nutritionTotals.calories,
                      existingReport.nutritionTotals.proteinG,
                      existingReport.nutritionTotals.carbsG,
                      existingReport.nutritionTotals.fatsG,
                    )}
                  </div>
                  <div className="mt-2 grid gap-2 text-xs text-black/58 sm:grid-cols-2">
                    <div>热量差值 {formatGapValue(existingReport.nutritionGap.calories, "kcal")}</div>
                    <div>蛋白差值 {formatGapValue(existingReport.nutritionGap.proteinG, "g")}</div>
                    <div>碳水差值 {formatGapValue(existingReport.nutritionGap.carbsG, "g")}</div>
                    <div>脂肪差值 {formatGapValue(existingReport.nutritionGap.fatsG, "g")}</div>
                  </div>
                </>
              ) : (
                <>
                  <div className="mt-2 text-sm font-semibold text-[#151811]">待 AI 计算</div>
                  <div className="mt-2 text-xs leading-5 text-black/58">{nutritionPendingMessage}</div>
                </>
              )}
              {!mealLogDirty && existingReport?.nutritionWarnings?.length ? (
                <div className="mt-3 space-y-1 text-[11px] leading-5 text-[#8a5a1f]">
                  {existingReport.nutritionWarnings.map((warning) => (
                    <div key={warning}>{warning}</div>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="mt-4 grid gap-3">
              {MEAL_SLOTS.map((field) => {
                const isMirroredPostWorkout =
                  field.key === "postWorkout" && previewMealLog.postWorkoutSource !== "dedicated";
                const linkedMeal =
                  previewMealLog.postWorkoutSource === "lunch"
                    ? previewMealLog.lunch
                    : previewMealLog.postWorkoutSource === "dinner"
                      ? previewMealLog.dinner
                      : previewMealLog.postWorkout;
                const currentEntry = isMirroredPostWorkout ? linkedMeal : previewMealLog[field.key];
                const isLinkedSlot =
                  (field.key === "lunch" && previewMealLog.postWorkoutSource === "lunch") ||
                  (field.key === "dinner" && previewMealLog.postWorkoutSource === "dinner");
                const effectiveRinseOil =
                  currentEntry.rinseOil === true ||
                  (currentEntry.rinseOil == null && detectRinseOilFromText(currentEntry.content));

                return (
                  <label key={field.key} className="block rounded-[20px] border border-black/10 bg-[#faf7ef] px-4 py-4">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[11px] uppercase tracking-[0.22em] text-black/42">{field.label}</span>
                      <div className="flex flex-wrap gap-2">
                        {isLinkedSlot ? (
                          <span className="rounded-full bg-[#d5ff63] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#151811]">
                            Post-workout
                          </span>
                        ) : null}
                        {isMirroredPostWorkout ? (
                          <span className="rounded-full bg-[#151811] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-white/74">
                            跟随
                            {previewMealLog.postWorkoutSource === "lunch"
                              ? mealSlotLabels.lunch
                              : mealSlotLabels.dinner}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <input
                      value={currentEntry.content}
                      onChange={(event) =>
                        updateMeal(field.key, {
                          content: event.target.value,
                          adherence: event.target.value.trim() ? "on_plan" : "missed",
                          deviationNote: "",
                        })
                      }
                      disabled={isMirroredPostWorkout}
                      className="mt-3 w-full rounded-[14px] border border-black/10 bg-white px-3 py-2.5 text-sm leading-6 outline-none disabled:opacity-50"
                      placeholder={`输入${field.label}，例如：鸡排饭 100g鸡排 250g米饭 1勺蛋白粉30g（空格或逗号分隔都可）`}
                    />

                    <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                      <label className="block rounded-[14px] border border-black/10 bg-white px-3 py-3">
                        <span className="text-[10px] uppercase tracking-[0.2em] text-black/42">Cooking Method</span>
                        <select
                          value={currentEntry.cookingMethod ?? ""}
                          onChange={(event) =>
                            updateMeal(field.key, {
                              cookingMethod: (event.target.value || undefined) as MealCookingMethod | undefined,
                            })
                          }
                          disabled={isMirroredPostWorkout}
                          className="mt-2 w-full bg-transparent text-sm font-medium text-[#151811] outline-none disabled:opacity-50"
                        >
                          <option value="">自动推断</option>
                          {COOKING_METHOD_OPTIONS.map((option) => (
                            <option key={`${field.key}-${option.value}`} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="flex items-center gap-3 rounded-[14px] border border-black/10 bg-white px-3 py-3 text-sm text-[#151811]">
                        <input
                          type="checkbox"
                          checked={effectiveRinseOil}
                          onChange={(event) => updateMeal(field.key, { rinseOil: event.target.checked })}
                          disabled={isMirroredPostWorkout}
                          className="h-4 w-4 accent-[#151811] disabled:opacity-50"
                        />
                        <div>
                          <div className="text-[10px] uppercase tracking-[0.2em] text-black/42">Rinse Oil</div>
                          <div className="mt-1 text-sm font-medium text-[#151811]">涮油 / 过水去油</div>
                        </div>
                      </label>
                    </div>

                    {currentEntry.content.trim() ? (
                      <div className="mt-3 rounded-[16px] border border-black/10 bg-white px-3 py-3">
                        <div className="text-[10px] uppercase tracking-[0.2em] text-black/42">Parsed Nutrition</div>
                        {currentEntry.cookingMethod || effectiveRinseOil ? (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {currentEntry.cookingMethod ? (
                              <span className="rounded-full bg-[#eef3e2] px-2 py-1 text-[10px] text-[#44512a]">
                                {mealCookingMethodLabels[currentEntry.cookingMethod]}
                              </span>
                            ) : null}
                            {effectiveRinseOil ? (
                              <span className="rounded-full bg-[#fff1c7] px-2 py-1 text-[10px] text-[#6d5620]">涮油</span>
                            ) : null}
                          </div>
                        ) : null}
                        {hasReadyNutrition && currentEntry.nutritionEstimate ? (
                          <>
                            <div className="mt-2 text-sm font-medium text-[#151811]">
                              {formatNutritionSummary(
                                currentEntry.nutritionEstimate.calories,
                                currentEntry.nutritionEstimate.proteinG,
                                currentEntry.nutritionEstimate.carbsG,
                                currentEntry.nutritionEstimate.fatsG,
                              )}
                            </div>
                            {currentEntry.parsedItems?.length ? (
                              <div className="mt-2 flex flex-wrap gap-2">
                                {currentEntry.parsedItems.map((item) => (
                                  <span
                                    key={`${field.key}-${item.name}-${item.sourceText}`}
                                    className="rounded-full bg-[#f1ebd9] px-2 py-1 text-[10px] text-black/62"
                                  >
                                    {item.name}
                                    {item.grams ? ` ${item.grams}g` : item.milliliters ? ` ${item.milliliters}ml` : ""}
                                  </span>
                                ))}
                              </div>
                            ) : null}
                            {currentEntry.analysisWarnings?.length ? (
                              <div className="mt-2 space-y-1 text-[11px] leading-5 text-[#8a5a1f]">
                                {currentEntry.analysisWarnings.map((warning) => (
                                  <div key={`${field.key}-${warning}`}>{warning}</div>
                                ))}
                              </div>
                            ) : null}
                          </>
                        ) : (
                          <>
                            <div className="mt-2 text-sm font-medium text-[#151811]">待 AI 计算</div>
                            <div className="mt-2 text-[11px] leading-5 text-[#8a5a1f]">{nutritionPendingMessage}</div>
                          </>
                        )}
                      </div>
                    ) : null}
                  </label>
                );
              })}
            </div>
            <div className="flex flex-wrap justify-between gap-3">
              <button
                type="button"
                onClick={() => setActiveFlowStep("training")}
                className="rounded-full border border-black/10 bg-white px-4 py-2.5 text-sm font-semibold text-[#151811] transition hover:bg-black/5"
              >
                返回：动作执行
              </button>
              <button
                type="button"
                onClick={() => setActiveFlowStep("recovery")}
                className="rounded-full border border-black/10 bg-[#f7f3e8] px-4 py-2.5 text-sm font-semibold text-[#151811] transition hover:bg-[#efe8d4]"
              >
                下一步：恢复与备注
              </button>
            </div>
          </div>
          </ReportFlowCard>

          <ReportFlowCard
            step="Step 3"
            title="恢复与备注"
            summary={recoverySummary}
            status={recoverySignalsTouched ? "Updated" : "Baseline"}
            tone={activeFlowStep === "recovery" ? "active" : recoverySignalsTouched ? "ready" : "pending"}
            active={activeFlowStep === "recovery"}
            onSelect={() => setActiveFlowStep("recovery")}
          >
            <div className="space-y-4">
          <div className="rounded-[26px] border border-black/10 bg-white/82 p-4 sm:p-5">
            <div className="text-[11px] uppercase tracking-[0.22em] text-black/42">Recovery Signals</div>
            <h3 className="mt-1 text-lg font-semibold text-[#151811]">恢复指标</h3>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <label className="block rounded-[16px] border border-black/10 bg-[#faf7ef] px-3 py-3">
                <span className="text-[11px] uppercase tracking-[0.2em] text-black/42">体重 kg</span>
                <input
                  type="number"
                  step="0.1"
                  value={reportDraft.bodyWeightKg}
                  onChange={(event) =>
                    setReportDraft((current) => ({ ...current, bodyWeightKg: Number(event.target.value) }))
                  }
                  className="mt-2 w-full bg-transparent text-lg font-semibold text-[#151811] outline-none"
                />
              </label>
              <label className="block rounded-[16px] border border-black/10 bg-[#faf7ef] px-3 py-3">
                <span className="text-[11px] uppercase tracking-[0.2em] text-black/42">睡眠 h</span>
                <input
                  type="number"
                  step="0.5"
                  value={reportDraft.sleepHours}
                  onChange={(event) =>
                    setReportDraft((current) => ({ ...current, sleepHours: Number(event.target.value) }))
                  }
                  className="mt-2 w-full bg-transparent text-lg font-semibold text-[#151811] outline-none"
                />
              </label>
              <label className="block rounded-[16px] border border-black/10 bg-[#faf7ef] px-3 py-3">
                <span className="text-[11px] uppercase tracking-[0.2em] text-black/42">疲劳 1-10</span>
                <input
                  type="number"
                  min="1"
                  max="10"
                  step="1"
                  value={reportDraft.fatigue}
                  onChange={(event) => setReportDraft((current) => ({ ...current, fatigue: Number(event.target.value) }))}
                  className="mt-2 w-full bg-transparent text-lg font-semibold text-[#151811] outline-none"
                />
              </label>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="block rounded-[16px] border border-black/10 bg-[#faf7ef] px-3 py-3">
                <span className="text-[11px] uppercase tracking-[0.2em] text-black/42">Pain / discomfort</span>
                <textarea
                  rows={3}
                  value={reportDraft.painNotes}
                  onChange={(event) => setReportDraft((current) => ({ ...current, painNotes: event.target.value }))}
                  className="mt-2 w-full resize-none bg-transparent text-sm leading-6 text-[#151811] outline-none"
                  placeholder="Example: mild right shoulder discomfort; squat depth felt fine."
                />
              </label>
              <label className="block rounded-[16px] border border-black/10 bg-[#faf7ef] px-3 py-3">
                <span className="text-[11px] uppercase tracking-[0.2em] text-black/42">恢复备注</span>
                <textarea
                  rows={3}
                  value={reportDraft.recoveryNote}
                  onChange={(event) => setReportDraft((current) => ({ ...current, recoveryNote: event.target.value }))}
                  className="mt-2 w-full resize-none bg-transparent text-sm leading-6 text-[#151811] outline-none"
                  placeholder="Example: felt sleepy in the afternoon; mobility work helped."
                />
              </label>
            </div>
          </div>

          <div className="rounded-[26px] border border-black/10 bg-white/82 p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-[0.22em] text-black/42">Summary Note</div>
                <h3 className="mt-1 text-lg font-semibold text-[#151811]">总结备注</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowAdvanced((current) => !current)}
                className="rounded-full border border-black/10 bg-[#f7f3e8] px-3 py-2 text-xs font-semibold text-[#151811]"
              >
                {showAdvanced ? "收起提示" : "展开提示"}
              </button>
            </div>

            {showAdvanced ? (
              <div className="mt-3 rounded-[18px] border border-black/10 bg-[#faf7ef] px-4 py-3 text-sm leading-6 text-black/58">
                这里补充今天最重要的上下文，比如临时换动作、状态异常、时间错位、训练节奏和你认为明天需要记住的事。
              </div>
            ) : null}

            <textarea
              value={reportDraft.trainingReportText}
              onChange={(event) => updateTrainingReport(event.target.value)}
              rows={5}
              className="mt-4 w-full rounded-[18px] border border-black/10 bg-[#faf7ef] px-4 py-3 text-sm leading-7 outline-none"
              placeholder="Add today's key notes, e.g. movement change, schedule shift, or recovery context."
            />

            <div className="mt-4 flex justify-start">
              <button
                type="button"
                onClick={() => setActiveFlowStep("nutrition")}
                className="rounded-full border border-black/10 bg-white px-4 py-2.5 text-sm font-semibold text-[#151811] transition hover:bg-black/5"
              >
                返回：餐次记录
              </button>
            </div>

            <button
              type="button"
              onClick={handleSubmitReport}
              disabled={isSubmitting}
              className="hidden"
            >
              {submissionMode === "completed" ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#151811]/25 border-t-[#151811]" />
                  <span>提交中...</span>
                </>
              ) : (
                "提交今日汇报"
              )}
            </button>
          </div>
            </div>
          </ReportFlowCard>

          <div className="sticky bottom-[calc(5.75rem+env(safe-area-inset-bottom))] z-30">
            <div className="rounded-[26px] border border-black/10 bg-[rgba(255,252,245,0.95)] p-4 shadow-[0_22px_50px_rgba(18,22,16,0.18)] backdrop-blur">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.24em] text-black/42">Submit Zone</div>
                  <p className="mt-2 text-sm leading-6 text-black/58">
                    {actionSummary}。可以先存草稿，等晚上补齐后再提交正式点评。
                  </p>
                </div>

                <div className="grid gap-2 sm:grid-cols-2 lg:min-w-[22rem]">
                  <button
                    type="button"
                    onClick={handleSaveDraft}
                    disabled={isSubmitting}
                    className="flex items-center justify-center gap-2 rounded-full border border-black/10 bg-[#f7f3e8] px-5 py-3.5 text-sm font-semibold text-[#151811] transition hover:bg-[#efe8d4] disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {submissionMode === "draft" ? (
                      <>
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#151811]/25 border-t-[#151811]" />
                        <span>Saving draft...</span>
                      </>
                    ) : (
                      "Save Draft"
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={handleSubmitReport}
                    disabled={isSubmitting}
                    className="flex items-center justify-center gap-2 rounded-full bg-[#d5ff63] px-5 py-3.5 text-sm font-semibold text-[#151811] transition hover:bg-[#c2f24a] disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {submissionMode === "completed" ? (
                      <>
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#151811]/25 border-t-[#151811]" />
                        <span>提交中...</span>
                      </>
                    ) : (
                      "提交今日汇报"
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        eyebrow="Support"
        title="Coach Q&A"
        description="日报主流程完成后，再来这里追问训练理论、替代动作或饮食策略会更顺手。"
      >
        <div className="space-y-4">
          <div className="hidden rounded-[26px] bg-[#151811] p-5 text-white shadow-[0_24px_60px_rgba(18,22,16,0.22)]">
            <div className="text-[11px] uppercase tracking-[0.28em] text-white/42">Context</div>
            <div className="mt-3 rounded-[20px] border border-white/10 bg-white/6 px-4 py-4">
              <div className="text-[10px] uppercase tracking-[0.24em] text-white/42">当前计划摘要</div>
              <p className="mt-2 text-sm leading-7 text-white/78">{coachReply.contextSummary ?? snapshot.plan.goal}</p>
            </div>
            <div className="mt-3 rounded-[20px] border border-white/10 bg-white/6 px-4 py-4">
              <div className="text-[10px] uppercase tracking-[0.24em] text-white/42">角色原则</div>
              <div className="mt-3 flex flex-wrap gap-2">
                {snapshot.persona.corePrinciples.map((item) => (
                  <span key={item} className="rounded-full border border-white/10 bg-white/8 px-3 py-1.5 text-xs text-white/70">
                    {item}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div
              className={`rounded-[26px] border p-5 shadow-[0_14px_36px_rgba(25,21,14,0.08)] ${
                coachReply.source === "review"
                  ? "border-[#cddfa0] bg-[#f4f9e6]"
                  : coachReply.source === "draft"
                    ? "border-[#e5d6ae] bg-[#fff6df]"
                  : coachReply.source === "error"
                    ? "border-[#e6b5a8] bg-[#fff1ec]"
                    : "border-black/10 bg-white/82"
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.28em] text-black/42">Answer</div>
                  <h3 className="mt-1 text-lg font-semibold text-[#151811]">{coachReply.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-black/52">
                    Ask for training theory, recovery logic, substitutions, meal strategy, or how to read your recent
                    trend.
                  </p>
                </div>
                <div className="rounded-full bg-[#151811] px-3 py-1.5 text-[10px] uppercase tracking-[0.22em] text-white/74">
                  {coachReply.source === "review"
                    ? "Today Review"
                    : coachReply.source === "draft"
                      ? "Draft Saved"
                      : "Coach Reply"}
                </div>
              </div>

              <div className="mt-4 rounded-[20px] border border-black/8 bg-white/70 px-4 py-4">
                <pre className="whitespace-pre-wrap text-sm leading-7 text-[#151811]">{coachReply.content}</pre>
              </div>

              {coachReply.basis.length ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  {coachReply.basis.map((basis) => (
                    <span key={`${basis.type}-${basis.label}`} className="rounded-full bg-[#f1ebd9] px-3 py-1.5 text-xs text-black/58">
                      {basis.type} · {basis.label}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="rounded-[26px] border border-black/10 bg-[#faf7ef] p-4">
              <div className="text-[11px] uppercase tracking-[0.28em] text-black/42">Ask Coach</div>
              <textarea
                value={coachInput}
                onChange={(event) => setCoachInput(event.target.value)}
                rows={4}
                className="mt-3 w-full resize-none rounded-[20px] border border-black/10 bg-white px-4 py-3 text-sm leading-7 outline-none"
                placeholder="For example: why lower carbs on rest day, or how to replace a painful movement."
              />
              <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs leading-6 text-black/48">
                  Ask theory, recovery, substitutions, and nutrition strategy here.
                </p>
                <button
                  type="button"
                  onClick={sendCoachMessage}
                  disabled={isAsking}
                  className="inline-flex items-center justify-center rounded-full bg-[#d5ff63] px-5 py-3 text-sm font-semibold text-[#151811] transition hover:bg-[#c2f24a] disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {isAsking ? "Thinking..." : "Send question"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}


