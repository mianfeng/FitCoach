"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { SectionCard } from "@/components/section-card";
import { buildMealLogForSubmit, createEmptyMealLog, mealAdherenceLabels, mealSlotLabels } from "@/lib/session-report";
import type { ChatMessage, DashboardSnapshot, DailyBrief, ExerciseResult, MealLog, SessionReport } from "@/lib/types";

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
  completed: true;
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
  source: "coach" | "review" | "error";
};

type StoredReportState = {
  feedback: FeedbackState;
  review?: Pick<CoachReplyState, "title" | "content" | "source">;
};

type SessionReportResponse = {
  report: SessionReport;
  review: string;
};

type CoachChatResponse = {
  answer: string;
  basis: ChatMessage["basis"];
  contextSummary: string;
};

const REPORT_FEEDBACK_KEY = "fitcoach:report-feedback";

const POST_WORKOUT_SOURCE_OPTIONS: Array<{ value: MealLog["postWorkoutSource"]; label: string }> = [
  { value: "dedicated", label: "独立练后餐" },
  { value: "lunch", label: "午餐同时是练后餐" },
  { value: "dinner", label: "晚餐同时是练后餐" },
];

const MEAL_SLOTS: Array<{ key: keyof Omit<MealLog, "postWorkoutSource">; label: string }> = [
  { key: "breakfast", label: "早餐" },
  { key: "lunch", label: "午餐" },
  { key: "dinner", label: "晚餐" },
  { key: "preWorkout", label: "练前餐" },
  { key: "postWorkout", label: "练后餐" },
];

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
      existingReport?.exerciseResults ??
      (brief.isRestDay
        ? []
        : brief.workoutPrescription.exercises.map(
            (exercise) =>
              ({
                exerciseName: exercise.name,
                performed: true,
                targetSets: exercise.sets,
                targetReps: exercise.reps,
                actualSets: exercise.sets,
                actualReps: exercise.reps,
                topSetWeightKg: exercise.suggestedWeightKg,
                rpe: 8,
                droppedSets: false,
                notes: "",
              }) satisfies ExerciseResult,
          )),
    mealLog: existingReport?.mealLog ?? createEmptyMealLog(),
    trainingReportText: existingReport?.trainingReportText ?? "",
    bodyWeightKg: existingReport?.bodyWeightKg ?? snapshot.profile.currentWeightKg,
    sleepHours: existingReport?.sleepHours ?? snapshot.profile.sleepTargetHours,
    fatigue: existingReport?.fatigue ?? 5,
    painNotes: existingReport?.painNotes ?? "",
    recoveryNote: existingReport?.recoveryNote ?? "",
    completed: true,
  };
}

async function postJson<T>(url: string, payload: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Request failed" }));
    throw new Error(error.error ?? "Request failed");
  }

  return (await response.json()) as T;
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

  const latestAssistant = [...snapshot.chatMessages].reverse().find((message) => message.role === "assistant");
  if (latestAssistant) {
    return {
      title: "最近一次教练回答",
      content: latestAssistant.content,
      basis: latestAssistant.basis,
      contextSummary: snapshot.plan.goal,
      source: "coach",
    };
  }

  return {
    title: "教练问答",
    content: "这里可以问训练理论、饮食策略、恢复安排。提交今日汇报后，这里也会自动显示当天点评。",
    basis: [],
    contextSummary: snapshot.persona.mission,
    source: "coach",
  };
}

interface HomeDashboardProps {
  snapshot: DashboardSnapshot;
  today: string;
  todayBrief: DailyBrief;
  isHistorical?: boolean;
  historyMissingSnapshot?: boolean;
}

export function HomeDashboard({
  snapshot,
  today,
  todayBrief,
  isHistorical = false,
  historyMissingSnapshot = false,
}: HomeDashboardProps) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAsking, startAskTransition] = useTransition();
  const existingReport = snapshot.recentReports.find((item) => item.date === today);
  const [coachInput, setCoachInput] = useState("");
  const [coachReply, setCoachReply] = useState<CoachReplyState>(() => buildInitialCoachReply(snapshot, existingReport));
  const [reportDraft, setReportDraft] = useState(() => buildReportDraft(todayBrief, snapshot, today, existingReport));

  useEffect(() => {
    const report = snapshot.recentReports.find((item) => item.date === today);
    setReportDraft(buildReportDraft(todayBrief, snapshot, today, report));
    setCoachReply(buildInitialCoachReply(snapshot, report));
    setShowAdvanced(false);
  }, [snapshot, today, todayBrief]);

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
        if (parsed.review) {
          setCoachReply({
            title: parsed.review.title,
            content: parsed.review.content,
            basis: [],
            contextSummary: snapshot.plan.goal,
            source: parsed.review.source,
          });
        }
      } else {
        setFeedback(parsed);
      }
    } finally {
      window.sessionStorage.removeItem(REPORT_FEEDBACK_KEY);
    }
  }, [snapshot.plan.goal, today, todayBrief.id]);

  function updateMeal(
    field: keyof Omit<MealLog, "postWorkoutSource">,
    patch: Partial<MealLog[keyof Omit<MealLog, "postWorkoutSource">]>,
  ) {
    setReportDraft((current) => ({
      ...current,
      mealLog: {
        ...current.mealLog,
        [field]: {
          ...current.mealLog[field],
          ...patch,
        },
      },
    }));
  }

  function updatePostWorkoutSource(source: MealLog["postWorkoutSource"]) {
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
          title: "教练回答失败",
          content: error instanceof Error ? error.message : "问答失败，请稍后重试。",
          basis: [],
          contextSummary: snapshot.plan.goal,
          source: "error",
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
        message: "今日记录已保存，点评已更新。",
      } satisfies FeedbackState;
      const reviewCard = {
        title: `${todayBrief.calendarLabel} 今日点评`,
        content: data.review,
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
      setFeedback({ tone: "success", message: "今日记录已保存，正在同步最新数据..." });
      router.refresh();
    } catch (error) {
      setFeedback({
        tone: "error",
        message: error instanceof Error ? error.message : "提交失败，请稍后重试。",
      });
    } finally {
      setIsSubmitting(false);
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
          title={`补报 ${todayBrief.calendarLabel}`}
          description={
            historyMissingSnapshot
              ? "该日期缺少历史计划快照，当前先按正式计划日历回推展示。"
              : "你正在查看历史日期的正式计划，可以直接补充当天汇报。"
          }
          className="bg-[rgba(249,247,235,0.96)]"
        >
          <div className="rounded-[20px] border border-black/10 bg-[#151811] px-4 py-3 text-sm text-white/78">
            当前日期：{today} {todayBrief.isRestDay ? "· 休息日" : ""}
          </div>
        </SectionCard>
      ) : null}

      <SectionCard eyebrow="Today" title="Today Board" className="overflow-hidden">
        <div className="rounded-[30px] bg-[#151811] p-4 text-white shadow-[0_28px_80px_rgba(18,22,16,0.28)] sm:p-5">
          <div className="rounded-[22px] border border-white/10 bg-white/6 p-4">
            <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-[0.28em] text-white/42">Training Day</div>
                <div className="mt-3 space-y-2">
                  <span className="block font-display text-[38px] leading-none text-[#d5ff63] sm:text-[52px]">
                    {todayBrief.calendarLabel}
                  </span>
                  <div className="space-y-1">
                    <div className="break-words text-lg font-semibold text-white sm:text-2xl">
                      {todayBrief.workoutPrescription.title}
                    </div>
                    <div className="text-xs leading-5 text-white/58 sm:text-sm">
                      {todayBrief.isRestDay
                        ? "休息日饮食与恢复计划"
                        : `${todayBrief.calendarSlot} 日训练 · ${
                            todayBrief.mealPrescription.dayType === "rest" ? "休息日饮食" : "训练日饮食"
                          }`}
                    </div>
                  </div>
                </div>
              </div>
              <div className="inline-flex w-fit items-center rounded-full border border-white/10 bg-white/6 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-white/76">
                {todayBrief.isRestDay ? "Rest Day" : `Day ${todayBrief.calendarSlot}`}
              </div>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            {todayBrief.mealPrescription.meals.map((meal) => (
              <div key={meal.label} className="rounded-[18px] border border-white/10 bg-white/5 px-3 py-3">
                <div className="text-[10px] uppercase tracking-[0.22em] text-white/45">{meal.label}</div>
                <div className="mt-1 text-lg font-semibold text-white sm:text-xl">{meal.sharePercent}%</div>
                <div className="mt-1 text-[11px] leading-5 text-white/58">{meal.examples.join(" / ")}</div>
              </div>
            ))}
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2">
            {[
              { label: "Carbs", value: `${todayBrief.mealPrescription.macros.carbsG}g` },
              { label: "Protein", value: `${todayBrief.mealPrescription.macros.proteinG}g` },
              { label: "Fats", value: `${todayBrief.mealPrescription.macros.fatsG}g` },
            ].map((item) => (
              <div key={item.label} className="rounded-[16px] border border-white/10 bg-black/10 px-2.5 py-3 text-center">
                <div className="text-[10px] uppercase tracking-[0.2em] text-white/45">{item.label}</div>
                <div className="mt-1 text-sm font-semibold text-white">{item.value}</div>
              </div>
            ))}
          </div>
        </div>
      </SectionCard>

      <SectionCard
        eyebrow="Execution"
        title="今日计划与记录"
        description="按动作、餐次、恢复和总结四块提交日报。训练日必须记录动作执行，点评会直接给出明天怎么做。"
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

          <div className="rounded-[26px] border border-black/10 bg-white/82 p-4 sm:p-5">
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
                ? "今天是休息日，不需要填写动作执行，直接补餐次、恢复和总结即可。"
                : "按处方逐个回填实际完成情况，动作完成度会直接进入点评和次日建议。"}
            </div>

            <div className="mt-4 space-y-3">
              {todayBrief.workoutPrescription.exercises.length ? (
                reportDraft.exerciseResults.map((exercise, index) => (
                  <article
                    key={exercise.exerciseName}
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
                        placeholder="比如：最后两组速度掉得快、肩前侧顶、改成了器械版本。"
                      />
                    </label>
                  </article>
                ))
              ) : (
                <div className="rounded-[20px] border border-black/10 bg-[#faf7ef] px-4 py-4 text-sm leading-6 text-black/60">
                  今天对应休息日，建议完成轻量活动、拉伸和休息日饮食，不安排训练动作。
                </div>
              )}
            </div>
          </div>

          <div className="rounded-[26px] border border-black/10 bg-white/82 p-4 sm:p-5">
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

            <div className="mt-4 grid gap-3">
              {MEAL_SLOTS.map((field) => {
                const isMirroredPostWorkout =
                  field.key === "postWorkout" && reportDraft.mealLog.postWorkoutSource !== "dedicated";
                const linkedMeal =
                  reportDraft.mealLog.postWorkoutSource === "lunch"
                    ? reportDraft.mealLog.lunch
                    : reportDraft.mealLog.postWorkoutSource === "dinner"
                      ? reportDraft.mealLog.dinner
                      : reportDraft.mealLog.postWorkout;
                const currentEntry = isMirroredPostWorkout ? linkedMeal : reportDraft.mealLog[field.key];
                const isLinkedSlot =
                  (field.key === "lunch" && reportDraft.mealLog.postWorkoutSource === "lunch") ||
                  (field.key === "dinner" && reportDraft.mealLog.postWorkoutSource === "dinner");

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
                            {reportDraft.mealLog.postWorkoutSource === "lunch"
                              ? mealSlotLabels.lunch
                              : mealSlotLabels.dinner}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      {(["on_plan", "adjusted", "missed"] as const).map((status) => (
                        <button
                          key={status}
                          type="button"
                          disabled={isMirroredPostWorkout}
                          onClick={() => updateMeal(field.key, { adherence: status })}
                          className={`rounded-full px-3 py-2 text-xs font-semibold transition ${
                            currentEntry.adherence === status
                              ? "bg-[#151811] text-white"
                              : "border border-black/10 bg-white text-[#151811]"
                          } ${isMirroredPostWorkout ? "cursor-not-allowed opacity-60" : ""}`}
                        >
                          {mealAdherenceLabels[status]}
                        </button>
                      ))}
                    </div>

                    <textarea
                      value={currentEntry.content}
                      onChange={(event) => updateMeal(field.key, { content: event.target.value })}
                      rows={2}
                      disabled={isMirroredPostWorkout}
                      className="mt-3 w-full resize-none bg-transparent text-sm leading-7 outline-none disabled:opacity-50"
                      placeholder={`输入${field.label}内容，如食物、份量、饮品。`}
                    />

                    <textarea
                      value={currentEntry.deviationNote ?? ""}
                      onChange={(event) => updateMeal(field.key, { deviationNote: event.target.value })}
                      rows={2}
                      disabled={isMirroredPostWorkout}
                      className="mt-3 w-full resize-none rounded-[16px] border border-black/10 bg-white px-3 py-3 text-sm leading-6 outline-none disabled:opacity-50"
                      placeholder="如果有调整或缺失，写下原因，比如临时换餐、时间错位、没吃到。"
                    />
                  </label>
                );
              })}
            </div>
          </div>

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
                <span className="text-[11px] uppercase tracking-[0.2em] text-black/42">疼痛 / 不适</span>
                <textarea
                  rows={3}
                  value={reportDraft.painNotes}
                  onChange={(event) => setReportDraft((current) => ({ ...current, painNotes: event.target.value }))}
                  className="mt-2 w-full resize-none bg-transparent text-sm leading-6 text-[#151811] outline-none"
                  placeholder="例如：右肩前束有顶感，深蹲膝盖没问题。"
                />
              </label>
              <label className="block rounded-[16px] border border-black/10 bg-[#faf7ef] px-3 py-3">
                <span className="text-[11px] uppercase tracking-[0.2em] text-black/42">恢复备注</span>
                <textarea
                  rows={3}
                  value={reportDraft.recoveryNote}
                  onChange={(event) => setReportDraft((current) => ({ ...current, recoveryNote: event.target.value }))}
                  className="mt-2 w-full resize-none bg-transparent text-sm leading-6 text-[#151811] outline-none"
                  placeholder="例如：下午很困、拉伸后状态好一点、今天步数偏高。"
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
              placeholder="自由补充今天最重要的上下文，例如：卧推最后两组明显变慢，午饭晚了 90 分钟，晚上恢复一般。"
            />

            <button
              type="button"
              onClick={handleSubmitReport}
              disabled={isSubmitting}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-[#d5ff63] px-5 py-3.5 text-sm font-semibold text-[#151811] transition hover:bg-[#c2f24a] disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isSubmitting ? (
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
      </SectionCard>

      <SectionCard
        eyebrow="Coach"
        title="教练问答"
        description="理论问题和今日点评都集中在这里。提交今日汇报后，回答区会自动刷新成当天点评。"
      >
        <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="rounded-[26px] bg-[#151811] p-5 text-white shadow-[0_24px_60px_rgba(18,22,16,0.22)]">
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
                  : coachReply.source === "error"
                    ? "border-[#e6b5a8] bg-[#fff1ec]"
                    : "border-black/10 bg-white/82"
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.28em] text-black/42">Answer</div>
                  <h3 className="mt-1 text-lg font-semibold text-[#151811]">{coachReply.title}</h3>
                </div>
                <div className="rounded-full bg-[#151811] px-3 py-1.5 text-[10px] uppercase tracking-[0.22em] text-white/74">
                  {coachReply.source === "review" ? "Today Review" : "Coach Reply"}
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
                placeholder="例如：休息日碳水为什么要更低？今天肩膀有点顶，推举该怎么替换？"
              />
              <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs leading-6 text-black/48">
                  理论解释、恢复策略、动作替换走这里；练后点评也会在同一块统一显示。
                </p>
                <button
                  type="button"
                  onClick={sendCoachMessage}
                  disabled={isAsking}
                  className="inline-flex items-center justify-center rounded-full bg-[#d5ff63] px-5 py-3 text-sm font-semibold text-[#151811] transition hover:bg-[#c2f24a] disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {isAsking ? "思考中..." : "发送问题"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
