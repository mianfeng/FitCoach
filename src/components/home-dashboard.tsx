"use client";

import { useState, useTransition } from "react";

import { SectionCard } from "@/components/section-card";
import type { DashboardSnapshot, DailyBrief, ExerciseResult, SessionReport } from "@/lib/types";

type ReportDraft = Omit<SessionReport, "id" | "createdAt" | "summary">;

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
  todayBrief: DailyBrief;
}

export function HomeDashboard({ snapshot, today, todayBrief }: HomeDashboardProps) {
  const [, setReports] = useState(snapshot.recentReports);
  const [, setProposals] = useState(snapshot.proposals);
  const [, setSummaries] = useState(snapshot.summaries);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [reportDraft, setReportDraft] = useState(() =>
    buildReportDraft(todayBrief, snapshot.profile.currentWeightKg, snapshot.profile.sleepTargetHours),
  );
  const [isPending, startTransition] = useTransition();

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

  function handleSubmitReport() {
    startTransition(async () => {
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

        const data = await postJson<{
          report: SessionReport;
          proposals: DashboardSnapshot["proposals"];
          summaries: DashboardSnapshot["summaries"];
        }>("/api/session-report", payload);
        setReports((current) => [data.report, ...current].slice(0, 6));
        setProposals(data.proposals);
        setSummaries(data.summaries);
        setFeedback("已记录今日汇报。刷新后会按这次结果推进到下一训练日。");
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
                  <span className="font-display text-4xl leading-none text-[#d5ff63] sm:text-5xl">
                    {todayBrief.scheduledDay}
                  </span>
                  <div className="pb-1">
                    <div className="text-sm font-semibold text-white sm:text-base">{todayBrief.workoutPrescription.title}</div>
                    <div className="mt-1 text-xs text-white/58 sm:text-sm">
                      {todayBrief.mealPrescription.dayType === "rest" ? "休息日饮食" : "训练日饮食"}
                    </div>
                  </div>
                </div>
              </div>
              <div className="rounded-full border border-white/10 bg-white/6 px-3 py-1.5 text-[10px] uppercase tracking-[0.22em] text-white/72">
                {todayBrief.mealPrescription.dayType === "rest" ? "Rest" : "Training"}
              </div>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            {todayBrief.mealPrescription.meals.map((meal) => (
              <div key={meal.label} className="rounded-[18px] border border-white/10 bg-white/5 px-3 py-3">
                <div className="text-[10px] uppercase tracking-[0.22em] text-white/45">{meal.label}</div>
                <div className="mt-1 text-xl font-semibold text-white">{meal.sharePercent}%</div>
                <div className="mt-1 text-[11px] leading-4 text-white/58">{meal.examples.join(" / ")}</div>
              </div>
            ))}
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2">
            {[
              { label: "Carbs", value: `${todayBrief.mealPrescription.macros.carbsG}g` },
              { label: "Protein", value: `${todayBrief.mealPrescription.macros.proteinG}g` },
              { label: "Fats", value: `${todayBrief.mealPrescription.macros.fatsG}g` },
            ].map((item) => (
              <div key={item.label} className="rounded-[16px] border border-white/10 bg-black/10 px-3 py-3 text-center">
                <div className="text-[10px] uppercase tracking-[0.22em] text-white/45">{item.label}</div>
                <div className="mt-1 text-sm font-semibold text-white sm:text-base">{item.value}</div>
              </div>
            ))}
          </div>
        </div>
      </SectionCard>

      <SectionCard eyebrow="Execution" title="今日计划与汇报" description="没有单独的生成步骤，直接按今天的模板训练并回填。">
        <div className="space-y-4">
          <div className="rounded-[26px] border border-black/10 bg-white/82 p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-[0.28em] text-black/42">Workout</div>
                <h3 className="mt-1 text-lg font-semibold text-[#151811]">{todayBrief.workoutPrescription.title}</h3>
              </div>
              <div className="rounded-full bg-[#d5ff63] px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-[#151811]">
                Day {todayBrief.scheduledDay}
              </div>
            </div>

            <div className="mt-4 overflow-hidden rounded-[18px] border border-black/8 bg-[#faf7ef]">
              {todayBrief.workoutPrescription.exercises.map((exercise) => (
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
              ))}
            </div>
          </div>

          <div className="rounded-[26px] border border-black/10 bg-white/82 p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="text-[11px] uppercase tracking-[0.22em] text-black/42">Exercise Report</div>
              <button
                type="button"
                onClick={addExercise}
                className="rounded-full border border-black/12 bg-[#151811] px-3 py-1.5 text-xs font-semibold text-white"
              >
                新增动作
              </button>
            </div>

            <div className="mt-3 grid grid-cols-[minmax(0,1fr)_72px_72px_72px] gap-2 border-b border-black/8 pb-2 text-[11px] uppercase tracking-[0.22em] text-black/42">
              <div>Exercise</div>
              <div className="text-center">Weight</div>
              <div className="text-center">Sets</div>
              <div className="text-center">Reps</div>
            </div>

            <div className="mt-2 space-y-2">
              {reportDraft.exerciseResults.map((exercise, index) => (
                <article
                  key={`${exercise.exerciseName}-${index}`}
                  className={`grid grid-cols-[minmax(0,1fr)_72px_72px_72px] items-center gap-2 rounded-[18px] px-3 py-3 ${
                    exercise.performed === false ? "bg-[#ece8de]" : "bg-[#f7f3e8]"
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <input
                      type="checkbox"
                      checked={exercise.performed !== false}
                      onChange={(event) => updateExercise(index, { performed: event.target.checked })}
                      className="h-4 w-4 accent-[#151811]"
                    />
                    <input
                      value={exercise.exerciseName}
                      onChange={(event) => updateExercise(index, { exerciseName: event.target.value })}
                      className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-[#151811] outline-none"
                    />
                  </div>
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
                    className="rounded-[14px] border border-black/10 bg-white px-2 py-2 text-center text-sm outline-none disabled:opacity-40"
                    placeholder="kg"
                  />
                  <input
                    type="number"
                    min="0"
                    value={exercise.actualSets}
                    onChange={(event) => updateExercise(index, { actualSets: Number(event.target.value) })}
                    disabled={exercise.performed === false}
                    className="rounded-[14px] border border-black/10 bg-white px-2 py-2 text-center text-sm outline-none disabled:opacity-40"
                    placeholder="组"
                  />
                  <input
                    value={exercise.actualReps}
                    onChange={(event) => updateExercise(index, { actualReps: event.target.value })}
                    disabled={exercise.performed === false}
                    className="rounded-[14px] border border-black/10 bg-white px-2 py-2 text-center text-sm outline-none disabled:opacity-40"
                    placeholder="次"
                  />
                </article>
              ))}
            </div>

            <div className="mt-3">
              <textarea
                value={reportDraft.recoveryNote ?? reportDraft.painNotes ?? ""}
                onChange={(event) => updateStatusNote(event.target.value)}
                rows={3}
                className="w-full rounded-[18px] border border-black/10 bg-white px-4 py-3 text-sm outline-none"
                placeholder="描述今天的状态、是否新增动作、哪里不舒服、饮食执行情况。"
              />
            </div>

            <div className="rounded-[20px] border border-black/10 bg-[#f7f3e8] p-3">
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
              disabled={isPending}
              className="mt-4 w-full rounded-full bg-[#d5ff63] px-5 py-3.5 text-sm font-semibold text-[#151811] transition hover:bg-[#c2f24a] disabled:opacity-60"
            >
              {isPending ? "提交中..." : "提交今日汇报"}
            </button>

            {feedback ? <p className="mt-3 text-sm text-black/56">{feedback}</p> : null}
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
