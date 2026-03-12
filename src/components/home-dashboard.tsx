"use client";

import { useState, useTransition } from "react";

import { SectionCard } from "@/components/section-card";
import type { DashboardSnapshot, DailyBrief, ExerciseResult, SessionReport } from "@/lib/types";

type ReportDraft = Omit<SessionReport, "id" | "createdAt" | "summary">;

function buildReportDraft(brief: DailyBrief | null, bodyWeightKg: number): ReportDraft {
  return {
    date: brief?.date ?? new Date().toISOString().slice(0, 10),
    performedDay: brief?.scheduledDay ?? "A",
    exerciseResults:
      brief?.workoutPrescription.exercises.map(
        (exercise) =>
          ({
            exerciseName: exercise.name,
            targetSets: exercise.sets,
            targetReps: exercise.reps,
            actualSets: exercise.sets,
            actualReps: exercise.reps,
            topSetWeightKg: exercise.suggestedWeightKg,
            rpe: 8,
            droppedSets: false,
            notes: "",
          }) satisfies ExerciseResult,
      ) ?? [],
    bodyWeightKg,
    sleepHours: 7.5,
    dietAdherence: 4 as const,
    fatigue: 5,
    painNotes: "",
    recoveryNote: "",
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

interface HomeDashboardProps {
  snapshot: DashboardSnapshot;
  today: string;
}

export function HomeDashboard({ snapshot, today }: HomeDashboardProps) {
  const [brief, setBrief] = useState(snapshot.recentBrief);
  const [reports, setReports] = useState(snapshot.recentReports);
  const [, setProposals] = useState(snapshot.proposals);
  const [, setSummaries] = useState(snapshot.summaries);
  const [question, setQuestion] = useState(snapshot.recentBrief?.userQuestion ?? "今天怎么练怎么吃");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [reportDraft, setReportDraft] = useState(() =>
    buildReportDraft(snapshot.recentBrief, snapshot.profile.currentWeightKg),
  );
  const [isPending, startTransition] = useTransition();

  const nextDay = brief?.scheduledDay ?? snapshot.plan.progressionRule.daySequence[0];
  const currentPhase = snapshot.plan.progressionRule.weeklyPhases[0];

  function handleGenerate() {
    startTransition(async () => {
      try {
        const data = await postJson<{ brief: DailyBrief; reused: boolean }>("/api/daily-brief/generate", {
          date: today,
          userQuestion: question,
        });
        setBrief(data.brief);
        setReportDraft(buildReportDraft(data.brief, reports[0]?.bodyWeightKg ?? snapshot.profile.currentWeightKg));
        setFeedback(data.reused ? "已复用今天的处方快照。" : "已生成新的今日处方。");
      } catch (error) {
        setFeedback(error instanceof Error ? error.message : "生成失败");
      }
    });
  }

  function updateExercise(index: number, patch: Partial<ExerciseResult>) {
    setReportDraft((current) => ({
      ...current,
      exerciseResults: current.exerciseResults.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item,
      ),
    }));
  }

  function handleSubmitReport() {
    startTransition(async () => {
      try {
        const data = await postJson<{
          report: SessionReport;
          proposals: DashboardSnapshot["proposals"];
          summaries: DashboardSnapshot["summaries"];
        }>("/api/session-report", reportDraft);
        setReports((current) => [data.report, ...current].slice(0, 6));
        setProposals(data.proposals);
        setSummaries(data.summaries);
        setFeedback("已记录本次训练与饮食汇报。");
      } catch (error) {
        setFeedback(error instanceof Error ? error.message : "汇报失败");
      }
    });
  }

  return (
    <div className="grid gap-5 pb-28">
      <SectionCard eyebrow="Today" title="Today Board" className="overflow-hidden">
        <div className="rounded-[30px] bg-[#151811] p-4 text-white shadow-[0_28px_80px_rgba(18,22,16,0.28)] sm:p-5">
          <div className="rounded-[22px] border border-white/10 bg-white/6 p-4">
            <div className="flex items-end justify-between gap-3">
              <div>
                <div className="text-[10px] uppercase tracking-[0.28em] text-white/42">Training Day</div>
                <div className="mt-2 flex items-end gap-3">
                  <span className="font-display text-4xl leading-none text-[#d5ff63] sm:text-5xl">{nextDay}</span>
                  <div className="pb-1">
                    <div className="text-sm font-semibold text-white sm:text-base">
                      {brief?.workoutPrescription.title ?? `${nextDay} 日训练`}
                    </div>
                    <div className="mt-1 text-xs text-white/58 sm:text-sm">
                      {brief?.mealPrescription.dayType === "rest" ? "休息日饮食" : currentPhase.label}
                    </div>
                  </div>
                </div>
              </div>
              <div className="rounded-full border border-white/10 bg-white/6 px-3 py-1.5 text-[10px] uppercase tracking-[0.22em] text-white/72">
                {brief?.mealPrescription.dayType === "rest" ? "Rest" : "Training"}
              </div>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            {(brief?.mealPrescription.meals ?? []).map((meal) => (
              <div key={meal.label} className="rounded-[18px] border border-white/10 bg-white/5 px-3 py-3">
                <div className="text-[10px] uppercase tracking-[0.22em] text-white/45">{meal.label}</div>
                <div className="mt-1 text-xl font-semibold text-white">{meal.sharePercent}%</div>
                <div className="mt-1 text-[11px] leading-4 text-white/58">{meal.examples.join(" / ")}</div>
              </div>
            ))}
            {!brief?.mealPrescription.meals.length ? (
              <div className="col-span-2 rounded-[18px] border border-dashed border-white/12 bg-white/4 px-3 py-3 text-sm leading-6 text-white/60">
                先生成今天的处方，这里只保留训练日类别和分餐摄入建议。
              </div>
            ) : null}
          </div>

          {brief ? (
            <div className="mt-3 grid grid-cols-3 gap-2">
              {[
                { label: "Carbs", value: `${brief.mealPrescription.macros.carbsG}g` },
                { label: "Protein", value: `${brief.mealPrescription.macros.proteinG}g` },
                { label: "Fats", value: `${brief.mealPrescription.macros.fatsG}g` },
              ].map((item) => (
                <div key={item.label} className="rounded-[16px] border border-white/10 bg-black/10 px-3 py-3 text-center">
                  <div className="text-[10px] uppercase tracking-[0.22em] text-white/45">{item.label}</div>
                  <div className="mt-1 text-sm font-semibold text-white sm:text-base">{item.value}</div>
                </div>
              ))}
            </div>
          ) : null}

          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="block flex-1">
              <span className="text-[10px] uppercase tracking-[0.22em] text-white/45">Prompt</span>
              <textarea
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                rows={2}
                className="mt-2 w-full rounded-[20px] border border-white/10 bg-white/92 px-4 py-3 text-sm text-[#151811] outline-none transition focus:border-[#d5ff63]"
                placeholder="例如：今天怎么练怎么吃，晚上练，状态一般。"
              />
            </label>
            <button
              type="button"
              onClick={handleGenerate}
              disabled={isPending}
              className="rounded-full bg-[#d5ff63] px-5 py-3 text-sm font-semibold text-[#151811] transition hover:bg-[#c2f24a] disabled:opacity-60 sm:shrink-0"
            >
              {isPending ? "处理中..." : "生成今日处方"}
            </button>
          </div>

          {feedback ? <p className="mt-3 text-sm text-white/66">{feedback}</p> : null}
        </div>
      </SectionCard>

      <SectionCard eyebrow="Execution" title="今日计划与汇报" description="训练清单和动作回填放在同一栏。">
        {brief ? (
          <div className="space-y-4">
            <div className="rounded-[26px] border border-black/10 bg-white/82 p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.28em] text-black/42">Workout</div>
                  <h3 className="mt-1 text-lg font-semibold text-[#151811]">{brief.workoutPrescription.title}</h3>
                </div>
                <div className="rounded-full bg-[#d5ff63] px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-[#151811]">
                  Day {brief.scheduledDay}
                </div>
              </div>

              <div className="mt-4 overflow-hidden rounded-[18px] border border-black/8 bg-[#faf7ef]">
                {brief.workoutPrescription.exercises.length ? (
                  brief.workoutPrescription.exercises.map((exercise) => (
                    <article
                      key={exercise.name}
                      className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 border-b border-black/8 px-3 py-3 last:border-b-0"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-[#151811]">{exercise.name}</div>
                        <div className="truncate text-[11px] text-black/50">{exercise.focus}</div>
                      </div>
                      <div className="text-xs text-black/58">
                        {exercise.sets} x {exercise.reps}
                      </div>
                      <div className="text-sm font-semibold text-[#151811]">
                        {exercise.suggestedWeightKg ? `${exercise.suggestedWeightKg}kg` : "自重"}
                      </div>
                    </article>
                  ))
                ) : (
                  <div className="px-4 py-4 text-sm text-black/58">今天按恢复日处理，训练顺位不消耗，下次继续这一天。</div>
                )}
              </div>
            </div>

            <div className="rounded-[26px] border border-black/10 bg-white/82 p-5">
              <div className="grid grid-cols-[minmax(0,1fr)_72px_72px_72px] gap-2 border-b border-black/8 pb-2 text-[11px] uppercase tracking-[0.22em] text-black/42">
                <div>Exercise</div>
                <div className="text-center">Weight</div>
                <div className="text-center">Sets</div>
                <div className="text-center">Reps</div>
              </div>

              <div className="mt-2 space-y-2">
                {reportDraft.exerciseResults.map((exercise, index) => (
                  <article
                    key={exercise.exerciseName}
                    className="grid grid-cols-[minmax(0,1fr)_72px_72px_72px] items-center gap-2 rounded-[18px] bg-[#f7f3e8] px-3 py-3"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-[#151811]">{exercise.exerciseName}</div>
                      <div className="truncate text-[11px] text-black/46">
                        目标 {exercise.targetSets} x {exercise.targetReps}
                      </div>
                    </div>
                    <input
                      type="number"
                      step="0.5"
                      value={exercise.topSetWeightKg ?? 0}
                      onChange={(event) =>
                        updateExercise(index, { topSetWeightKg: Number(event.target.value) || undefined })
                      }
                      className="rounded-[14px] border border-black/10 bg-white px-2 py-2 text-center text-sm outline-none"
                      placeholder="kg"
                    />
                    <input
                      type="number"
                      min="0"
                      value={exercise.actualSets}
                      onChange={(event) => updateExercise(index, { actualSets: Number(event.target.value) })}
                      className="rounded-[14px] border border-black/10 bg-white px-2 py-2 text-center text-sm outline-none"
                      placeholder="组"
                    />
                    <input
                      value={exercise.actualReps}
                      onChange={(event) => updateExercise(index, { actualReps: event.target.value })}
                      className="rounded-[14px] border border-black/10 bg-white px-2 py-2 text-center text-sm outline-none"
                      placeholder="次"
                    />
                  </article>
                ))}
              </div>

              <div className="mt-3">
                <textarea
                  value={reportDraft.recoveryNote ?? reportDraft.painNotes ?? ""}
                  onChange={(event) =>
                    setReportDraft((current) => ({
                      ...current,
                      painNotes: event.target.value,
                      recoveryNote: event.target.value,
                    }))
                  }
                  rows={3}
                  className="w-full rounded-[18px] border border-black/10 bg-white px-4 py-3 text-sm outline-none"
                  placeholder="描述今天的状态、异常、恢复感受或饮食执行情况。"
                />
              </div>

              <button
                type="button"
                onClick={handleSubmitReport}
                disabled={isPending || !brief}
                className="mt-4 w-full rounded-full bg-[#d5ff63] px-5 py-3.5 text-sm font-semibold text-[#151811] transition hover:bg-[#c2f24a] disabled:opacity-60"
              >
                {isPending ? "提交中..." : "提交今日汇报"}
              </button>
            </div>
          </div>
        ) : (
          <div className="rounded-[24px] border border-dashed border-black/14 bg-white/70 p-5 text-sm text-black/55">
            还没有生成今天的计划。先在上面的提问栏输入“今天怎么练怎么吃”。
          </div>
        )}
      </SectionCard>
    </div>
  );
}
