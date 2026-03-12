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
  const [constraints, setConstraints] = useState(snapshot.recentBrief?.optionalConstraints ?? "");
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
          optionalConstraints: constraints || undefined,
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
      <SectionCard
        eyebrow="Ask"
        title="先提问，再生成今天的执行单"
        description="第一页只保留一个入口：问今天该怎么练、怎么吃。生成后当天内容会固定成一张快照。"
        className="overflow-hidden"
      >
        <div className="grid gap-5 lg:grid-cols-[0.92fr_1.08fr]">
          <div className="rounded-[30px] bg-[#151811] p-5 text-white shadow-[0_28px_80px_rgba(18,22,16,0.28)]">
            <p className="text-[11px] uppercase tracking-[0.36em] text-white/45">Today Board</p>
            <div className="mt-4 rounded-[24px] border border-white/10 bg-white/6 p-4">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.28em] text-white/42">Training Day</div>
                  <div className="mt-2 flex items-end gap-3">
                    <span className="font-display text-5xl leading-none text-[#d5ff63]">{nextDay}</span>
                    <div className="pb-1">
                      <div className="text-base font-semibold text-white">
                        {brief?.workoutPrescription.title ?? `${nextDay} 日训练`}
                      </div>
                      <div className="mt-1 text-sm text-white/58">
                        {brief?.mealPrescription.dayType === "rest" ? "休息日饮食" : currentPhase.label}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="rounded-full border border-white/10 bg-white/6 px-3 py-1.5 text-xs uppercase tracking-[0.22em] text-white/72">
                  {brief?.mealPrescription.dayType === "rest" ? "Rest" : "Training"}
                </div>
              </div>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {(brief?.mealPrescription.meals ?? []).map((meal) => (
                <div key={meal.label} className="rounded-[20px] border border-white/10 bg-white/5 px-4 py-4">
                  <div className="text-[11px] uppercase tracking-[0.24em] text-white/45">{meal.label}</div>
                  <div className="mt-2 text-2xl font-semibold text-white">{meal.sharePercent}%</div>
                  <div className="mt-2 text-xs leading-5 text-white/58">{meal.examples.join(" / ")}</div>
                </div>
              ))}
              {!brief?.mealPrescription.meals.length ? (
                <div className="rounded-[20px] border border-dashed border-white/12 bg-white/4 px-4 py-4 text-sm leading-6 text-white/60 sm:col-span-3">
                  先生成今天的处方，这里只保留训练日类别和分餐摄入建议。
                </div>
              ) : null}
            </div>
            {brief ? (
              <div className="mt-4 rounded-[22px] border border-white/10 bg-white/6 px-4 py-4">
                <div className="text-[11px] uppercase tracking-[0.24em] text-white/45">Macro Target</div>
                <div className="mt-3 grid grid-cols-3 gap-3 text-center">
                  {[
                    { label: "Carbs", value: `${brief.mealPrescription.macros.carbsG}g` },
                    { label: "Protein", value: `${brief.mealPrescription.macros.proteinG}g` },
                    { label: "Fats", value: `${brief.mealPrescription.macros.fatsG}g` },
                  ].map((item) => (
                    <div key={item.label} className="rounded-[18px] border border-white/10 bg-black/10 px-3 py-3">
                      <div className="text-[11px] uppercase tracking-[0.24em] text-white/45">{item.label}</div>
                      <div className="mt-2 text-lg font-semibold text-white">{item.value}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <div className="space-y-4">
            <label className="block">
              <span className="text-sm font-medium text-black/66">今天想问什么</span>
              <textarea
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                rows={4}
                className="mt-2 w-full rounded-[24px] border border-black/10 bg-white/82 px-4 py-4 text-sm outline-none transition focus:border-black/30"
                placeholder="例如：今天怎么练怎么吃，晚上练，状态一般。"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-black/66">额外约束</span>
              <input
                value={constraints}
                onChange={(event) => setConstraints(event.target.value)}
                placeholder="例如：只练 60 分钟 / 今天想恢复 / 晚饭后训练"
                className="mt-2 w-full rounded-[20px] border border-black/10 bg-white/82 px-4 py-3 text-sm outline-none transition focus:border-black/30"
              />
            </label>
            <button
              type="button"
              onClick={handleGenerate}
              disabled={isPending}
              className="w-full rounded-full bg-[#151811] px-5 py-3.5 text-sm font-semibold text-white transition hover:bg-black disabled:opacity-60"
            >
              {isPending ? "处理中..." : "生成今日提问结果"}
            </button>
            {feedback ? <p className="text-sm text-black/56">{feedback}</p> : null}
          </div>
        </div>
      </SectionCard>

      <SectionCard
        eyebrow="Execution"
        title="今日计划与汇报"
        description="训练处方和执行回填放在同一栏，避免页面来回跳。"
      >
        {brief ? (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {brief.reasoningSummary.map((item) => (
                <span key={item} className="rounded-full bg-[#151811] px-3 py-1.5 text-xs font-medium text-white/84">
                  {item}
                </span>
              ))}
            </div>

            <div className="rounded-[26px] border border-black/10 bg-white/82 p-5">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.28em] text-black/42">Workout</div>
                  <h3 className="mt-2 text-2xl font-semibold text-[#151811]">{brief.workoutPrescription.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-black/60">{brief.workoutPrescription.objective}</p>
                </div>
                <div className="rounded-[20px] bg-[#d5ff63] px-4 py-3 text-center">
                  <div className="text-[11px] uppercase tracking-[0.28em] text-black/45">Day</div>
                  <div className="mt-1 font-display text-4xl leading-none text-[#151811]">{brief.scheduledDay}</div>
                </div>
              </div>

              <div className="mt-5 space-y-3">
                {brief.workoutPrescription.exercises.length ? (
                  brief.workoutPrescription.exercises.map((exercise) => (
                    <article
                      key={exercise.name}
                      className="rounded-[20px] border border-black/8 bg-[#faf7ef] px-4 py-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-base font-semibold text-[#151811]">{exercise.name}</div>
                          <div className="mt-1 text-sm text-black/56">{exercise.focus}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-[11px] uppercase tracking-[0.24em] text-black/42">Load</div>
                          <div className="mt-1 text-base font-semibold text-[#151811]">
                            {exercise.suggestedWeightKg ? `${exercise.suggestedWeightKg}kg` : "自重"}
                          </div>
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2 text-xs text-black/58">
                        <span className="rounded-full bg-black/5 px-3 py-1.5">
                          {exercise.sets} x {exercise.reps}
                        </span>
                        <span className="rounded-full bg-black/5 px-3 py-1.5">{exercise.restSeconds}s rest</span>
                      </div>
                    </article>
                  ))
                ) : (
                  <div className="rounded-[20px] border border-dashed border-black/12 bg-[#faf7ef] px-4 py-4 text-sm text-black/58">
                    今天按恢复日处理，训练顺位不消耗，下次继续这一天。
                  </div>
                )}
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-4">
              <label className="block rounded-[22px] bg-white/80 p-4">
                <span className="text-[11px] uppercase tracking-[0.24em] text-black/40">Body Weight</span>
                <input
                  type="number"
                  step="0.1"
                  value={reportDraft.bodyWeightKg}
                  onChange={(event) =>
                    setReportDraft((current) => ({ ...current, bodyWeightKg: Number(event.target.value) }))
                  }
                  className="mt-2 w-full bg-transparent text-2xl font-semibold outline-none"
                />
              </label>
              <label className="block rounded-[22px] bg-white/80 p-4">
                <span className="text-[11px] uppercase tracking-[0.24em] text-black/40">Sleep</span>
                <input
                  type="number"
                  step="0.5"
                  value={reportDraft.sleepHours}
                  onChange={(event) =>
                    setReportDraft((current) => ({ ...current, sleepHours: Number(event.target.value) }))
                  }
                  className="mt-2 w-full bg-transparent text-2xl font-semibold outline-none"
                />
              </label>
              <label className="block rounded-[22px] bg-white/80 p-4">
                <span className="text-[11px] uppercase tracking-[0.24em] text-black/40">Fatigue</span>
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={reportDraft.fatigue}
                  onChange={(event) =>
                    setReportDraft((current) => ({ ...current, fatigue: Number(event.target.value) }))
                  }
                  className="mt-2 w-full bg-transparent text-2xl font-semibold outline-none"
                />
              </label>
              <label className="block rounded-[22px] bg-white/80 p-4">
                <span className="text-[11px] uppercase tracking-[0.24em] text-black/40">Diet</span>
                <input
                  type="number"
                  min="1"
                  max="5"
                  value={reportDraft.dietAdherence}
                  onChange={(event) =>
                    setReportDraft((current) => ({
                      ...current,
                      dietAdherence: Number(event.target.value) as ReportDraft["dietAdherence"],
                    }))
                  }
                  className="mt-2 w-full bg-transparent text-2xl font-semibold outline-none"
                />
              </label>
            </div>

            <div className="space-y-3">
              {reportDraft.exerciseResults.map((exercise, index) => (
                <article key={exercise.exerciseName} className="rounded-[22px] border border-black/10 bg-white/82 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-base font-semibold text-[#151811]">{exercise.exerciseName}</div>
                      <div className="text-xs text-black/46">
                        目标 {exercise.targetSets} x {exercise.targetReps}
                      </div>
                    </div>
                    <label className="inline-flex items-center gap-2 rounded-full bg-black/5 px-3 py-2 text-sm text-black/58">
                      <input
                        type="checkbox"
                        checked={exercise.droppedSets}
                        onChange={(event) => updateExercise(index, { droppedSets: event.target.checked })}
                      />
                      掉组
                    </label>
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    <input
                      type="number"
                      step="0.5"
                      value={exercise.topSetWeightKg ?? 0}
                      onChange={(event) =>
                        updateExercise(index, { topSetWeightKg: Number(event.target.value) || undefined })
                      }
                      className="rounded-[16px] border border-black/10 bg-[#f7f3e8] px-3 py-2 text-sm outline-none"
                      placeholder="实际重量 kg"
                    />
                    <input
                      value={exercise.actualReps}
                      onChange={(event) => updateExercise(index, { actualReps: event.target.value })}
                      className="rounded-[16px] border border-black/10 bg-[#f7f3e8] px-3 py-2 text-sm outline-none"
                      placeholder="实际次数"
                    />
                    <input
                      type="number"
                      min="1"
                      max="10"
                      step="0.1"
                      value={exercise.rpe}
                      onChange={(event) => updateExercise(index, { rpe: Number(event.target.value) })}
                      className="rounded-[16px] border border-black/10 bg-[#f7f3e8] px-3 py-2 text-sm outline-none"
                      placeholder="RPE"
                    />
                  </div>
                </article>
              ))}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <input
                value={reportDraft.painNotes ?? ""}
                onChange={(event) => setReportDraft((current) => ({ ...current, painNotes: event.target.value }))}
                className="rounded-[18px] border border-black/10 bg-white/82 px-4 py-3 text-sm outline-none"
                placeholder="疼痛或异常"
              />
              <input
                value={reportDraft.recoveryNote ?? ""}
                onChange={(event) => setReportDraft((current) => ({ ...current, recoveryNote: event.target.value }))}
                className="rounded-[18px] border border-black/10 bg-white/82 px-4 py-3 text-sm outline-none"
                placeholder="恢复备注"
              />
            </div>

            <button
              type="button"
              onClick={handleSubmitReport}
              disabled={isPending || !brief}
              className="w-full rounded-full bg-[#d5ff63] px-5 py-3.5 text-sm font-semibold text-[#151811] transition hover:bg-[#c2f24a] disabled:opacity-60"
            >
              {isPending ? "提交中..." : "提交今日汇报"}
            </button>
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
