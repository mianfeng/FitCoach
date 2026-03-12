"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { SectionCard } from "@/components/section-card";
import type { ChatMessage, DailyBrief, DashboardSnapshot, ExerciseResult, SessionReport } from "@/lib/types";

type ReportDraft = Omit<SessionReport, "id" | "createdAt" | "summary" | "performedDay"> & {
  performedDay?: SessionReport["performedDay"];
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

function buildReportDraft(brief: DailyBrief, bodyWeightKg: number, sleepHours: number): ReportDraft {
  return {
    date: brief.date,
    performedDay: brief.scheduledDay,
    exerciseResults: brief.workoutPrescription.exercises.map(
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
    ),
    bodyWeightKg,
    sleepHours,
    dietAdherence: 4,
    fatigue: 5,
    painNotes: "",
    recoveryNote: "",
    completed: !brief.isRestDay,
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

function buildInitialCoachReply(snapshot: DashboardSnapshot): CoachReplyState {
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
    content: "这里可以问训练原理、饮食策略、恢复安排。提交今日汇报后，这里也会自动显示今日点评。",
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
  const [coachInput, setCoachInput] = useState("训练日和休息日的碳水安排差多少更合理？");
  const [coachReply, setCoachReply] = useState<CoachReplyState>(() => buildInitialCoachReply(snapshot));
  const [reportDraft, setReportDraft] = useState(() =>
    buildReportDraft(todayBrief, snapshot.profile.currentWeightKg, snapshot.profile.sleepTargetHours),
  );

  useEffect(() => {
    setReportDraft(buildReportDraft(todayBrief, snapshot.profile.currentWeightKg, snapshot.profile.sleepTargetHours));
    setShowAdvanced(false);
  }, [today, todayBrief, snapshot.profile.currentWeightKg, snapshot.profile.sleepTargetHours]);

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
  }, [today, todayBrief.id, snapshot.plan.goal]);

  const isRestDay = todayBrief.isRestDay;
  const todayPlanLabel = todayBrief.calendarLabel;

  function updateExercise(index: number, patch: Partial<ExerciseResult>) {
    setReportDraft((current) => {
      const nextResults = current.exerciseResults.map((item, itemIndex) => {
        if (itemIndex !== index) {
          return item;
        }

        const next = { ...item, ...patch };
        if (patch.performed === false) {
          next.actualSets = 0;
          next.actualReps = "0";
          next.topSetWeightKg = undefined;
        }
        return next;
      });

      return {
        ...current,
        exerciseResults: nextResults,
        completed: nextResults.every((item) => item.performed !== false),
      };
    });
  }

  function updateStatusNote(value: string) {
    setReportDraft((current) => ({
      ...current,
      painNotes: value,
      recoveryNote: value,
    }));
  }

  function addExercise() {
    setReportDraft((current) => ({
      ...current,
      completed: false,
      exerciseResults: [
        ...current.exerciseResults,
        {
          exerciseName: "新增动作",
          performed: false,
          targetSets: 1,
          targetReps: "10",
          actualSets: 0,
          actualReps: "0",
          rpe: 8,
          droppedSets: false,
          notes: "",
        },
      ],
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
    if (isRestDay || !todayBrief.scheduledDay) {
      return;
    }

    setIsSubmitting(true);
    setFeedback({ tone: "info", message: "正在保存今日汇报..." });

    try {
      const normalizedResults = reportDraft.exerciseResults
        .map((exercise) => ({
          ...exercise,
          performed: exercise.performed !== false,
        }))
        .filter((exercise) => exercise.exerciseName.trim().length > 0);

      const payload: ReportDraft = {
        ...reportDraft,
        date: today,
        performedDay: todayBrief.scheduledDay,
        exerciseResults: normalizedResults,
        completed: normalizedResults.every((item) => item.performed !== false),
      };

      const data = await postJson<SessionReportResponse>("/api/session-report", payload);
      const successFeedback = { tone: "success", message: "今日汇报已保存，教练点评已更新。" } satisfies FeedbackState;
      const reviewCard = {
        title: `${todayPlanLabel} 今日点评`,
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
      setFeedback({ tone: "success", message: "今日汇报已保存，正在同步点评与看板..." });
      router.refresh();
    } catch (error) {
      setFeedback({
        tone: "error",
        message: error instanceof Error ? error.message : "汇报失败，请稍后重试。",
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
          title={`补报 ${todayPlanLabel}`}
          description={
            historyMissingSnapshot
              ? "该日期缺少历史计划快照，当前先按正式计划日历回推展示。"
              : "你正在查看历史日期的正式计划，可以直接补充当天汇报。"
          }
          className="bg-[rgba(249,247,235,0.96)]"
        >
          <div className="rounded-[20px] border border-black/10 bg-[#151811] px-4 py-3 text-sm text-white/78">
            当前日期：{today} {isRestDay ? "· 休息日" : ""}
          </div>
        </SectionCard>
      ) : null}

      <SectionCard eyebrow="Today" title="Today Board" className="overflow-hidden">
        <div className="rounded-[30px] bg-[#151811] p-4 text-white shadow-[0_28px_80px_rgba(18,22,16,0.28)] sm:p-5">
          <div className="rounded-[22px] border border-white/10 bg-white/6 p-4">
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-[0.28em] text-white/42">Training Day</div>
                <div className="mt-3 space-y-2">
                  <span className="block font-display text-[38px] leading-none text-[#d5ff63] sm:text-[52px]">
                    {todayPlanLabel}
                  </span>
                  <div className="space-y-1">
                    <div className="break-words text-lg font-semibold text-white sm:text-2xl">
                      {todayBrief.workoutPrescription.title}
                    </div>
                    <div className="text-xs leading-5 text-white/58 sm:text-sm">
                      {isRestDay
                        ? "休息日饮食与恢复计划"
                        : `${todayBrief.calendarSlot} 日训练 · ${todayBrief.mealPrescription.dayType === "rest" ? "休息日饮食" : "训练日饮食"}`}
                    </div>
                  </div>
                </div>
              </div>
              <div className="inline-flex w-fit items-center rounded-full border border-white/10 bg-white/6 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-white/76">
                {isRestDay ? "Rest Day" : `Day ${todayBrief.calendarSlot}`}
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
        title="今日计划与汇报"
        description={isRestDay ? "今天是休息日，页面只展示恢复与饮食，不开放训练汇报。" : "按该日期的正式计划训练并回填，不再跟顺延队列混用。"}
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
                <div className="text-[11px] uppercase tracking-[0.28em] text-black/42">Workout</div>
                <h3 className="mt-1 text-lg font-semibold text-[#151811]">{todayBrief.workoutPrescription.title}</h3>
              </div>
              <div className="w-fit rounded-full bg-[#d5ff63] px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-[#151811]">
                {isRestDay ? "Rest Day" : todayPlanLabel}
              </div>
            </div>

            <div className="mt-4 overflow-hidden rounded-[18px] border border-black/8 bg-[#faf7ef]">
              {todayBrief.workoutPrescription.exercises.length ? (
                todayBrief.workoutPrescription.exercises.map((exercise) => (
                  <article
                    key={exercise.name}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-black/8 px-3 py-3 last:border-b-0"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-[#151811]">{exercise.name}</div>
                      <div className="truncate text-[11px] text-black/50">{exercise.focus}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-black/58">
                        {exercise.sets} x {exercise.reps}
                      </div>
                      <div className="mt-1 text-sm font-semibold text-[#151811]">
                        {exercise.suggestedWeightKg ? `${exercise.suggestedWeightKg}kg` : "自重"}
                      </div>
                    </div>
                  </article>
                ))
              ) : (
                <div className="px-4 py-4 text-sm leading-6 text-black/60">
                  今天对应休息日，建议完成轻量活动、拉伸和休息日饮食，不安排训练动作。
                </div>
              )}
            </div>
          </div>

          {isRestDay ? (
            <div className="rounded-[26px] border border-black/10 bg-white/82 p-5">
              <div className="rounded-[20px] border border-[#ddd2bb] bg-[#f7f2e5] px-4 py-4 text-sm leading-6 text-[#3b3428]">
                休息日不开放训练汇报。你可以在明天对应的训练日再提交动作完成情况。
              </div>
            </div>
          ) : (
            <div className="rounded-[26px] border border-black/10 bg-white/82 p-4 sm:p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-[11px] uppercase tracking-[0.22em] text-black/42">Exercise Report</div>
                <button
                  type="button"
                  onClick={addExercise}
                  className="w-fit rounded-full border border-black/12 bg-[#151811] px-4 py-2 text-sm font-semibold text-white"
                >
                  新增动作
                </button>
              </div>

              <div className="mt-4 space-y-3">
                {reportDraft.exerciseResults.map((exercise, index) => (
                  <article
                    key={`${exercise.exerciseName}-${index}`}
                    className={`rounded-[20px] px-3 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)] ${
                      exercise.performed === false ? "bg-[#eee7d6]" : "bg-[#f7f3e8]"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={exercise.performed !== false}
                        onChange={(event) => updateExercise(index, { performed: event.target.checked })}
                        className="mt-1 h-4 w-4 shrink-0 accent-[#151811]"
                      />
                      <input
                        value={exercise.exerciseName}
                        onChange={(event) => updateExercise(index, { exerciseName: event.target.value })}
                        className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-[#151811] outline-none"
                      />
                    </div>

                    <div className="mt-3 grid grid-cols-3 gap-2">
                      <label className="rounded-[16px] border border-black/10 bg-white px-2.5 py-2.5">
                        <span className="text-[10px] uppercase tracking-[0.18em] text-black/42">重量</span>
                        <input
                          type="number"
                          step="0.5"
                          value={exercise.topSetWeightKg ?? ""}
                          onChange={(event) =>
                            updateExercise(index, {
                              topSetWeightKg: event.target.value ? Number(event.target.value) : undefined,
                            })
                          }
                          disabled={exercise.performed === false}
                          className="mt-1 w-full bg-transparent text-center text-sm font-semibold outline-none disabled:opacity-40"
                          placeholder="kg"
                        />
                      </label>
                      <label className="rounded-[16px] border border-black/10 bg-white px-2.5 py-2.5">
                        <span className="text-[10px] uppercase tracking-[0.18em] text-black/42">组数</span>
                        <input
                          type="number"
                          min="0"
                          value={exercise.actualSets}
                          onChange={(event) => updateExercise(index, { actualSets: Number(event.target.value) })}
                          disabled={exercise.performed === false}
                          className="mt-1 w-full bg-transparent text-center text-sm font-semibold outline-none disabled:opacity-40"
                          placeholder="组"
                        />
                      </label>
                      <label className="rounded-[16px] border border-black/10 bg-white px-2.5 py-2.5">
                        <span className="text-[10px] uppercase tracking-[0.18em] text-black/42">次数</span>
                        <input
                          value={exercise.actualReps}
                          onChange={(event) => updateExercise(index, { actualReps: event.target.value })}
                          disabled={exercise.performed === false}
                          className="mt-1 w-full bg-transparent text-center text-sm font-semibold outline-none disabled:opacity-40"
                          placeholder="次"
                        />
                      </label>
                    </div>
                  </article>
                ))}
              </div>

              <div className="mt-3">
                <textarea
                  value={reportDraft.recoveryNote ?? reportDraft.painNotes ?? ""}
                  onChange={(event) => updateStatusNote(event.target.value)}
                  rows={3}
                  className="w-full rounded-[18px] border border-black/10 bg-white px-4 py-3 text-sm leading-7 outline-none"
                  placeholder="描述今天的状态、是否新增动作、哪里不舒服、饮食执行情况。"
                />
              </div>

              <div className="mt-3 rounded-[20px] border border-black/10 bg-[#f7f3e8] p-3">
                <button
                  type="button"
                  onClick={() => setShowAdvanced((current) => !current)}
                  className="flex w-full items-center justify-between text-left"
                >
                  <span className="text-[11px] uppercase tracking-[0.24em] text-black/42">高级字段</span>
                  <span className="text-xs font-semibold text-[#151811]">{showAdvanced ? "收起" : "展开"}</span>
                </button>
                {showAdvanced ? (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <label className="block rounded-[16px] border border-black/10 bg-white px-3 py-3">
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
                    <label className="block rounded-[16px] border border-black/10 bg-white px-3 py-3">
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
                  </div>
                ) : null}
              </div>

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
          )}
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
                  理论解释、恢复策略、动作替换走这里；今天练后点评也会在同一块统一展示。
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
