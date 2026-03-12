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
  const [proposals, setProposals] = useState(snapshot.proposals);
  const [summaries, setSummaries] = useState(snapshot.summaries);
  const [question, setQuestion] = useState(snapshot.recentBrief?.userQuestion ?? "今天怎么练怎么吃");
  const [constraints, setConstraints] = useState(snapshot.recentBrief?.optionalConstraints ?? "");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [reportDraft, setReportDraft] = useState(() =>
    buildReportDraft(snapshot.recentBrief, snapshot.profile.currentWeightKg),
  );
  const [isPending, startTransition] = useTransition();

  const nextDay = brief?.scheduledDay ?? snapshot.plan.progressionRule.daySequence[0];
  const currentPhase =
    snapshot.plan.progressionRule.weeklyPhases[Math.min(snapshot.plan.progressionRule.weeklyPhases.length - 1, 0)];

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
        const data = await postJson<{ report: SessionReport; proposals: DashboardSnapshot["proposals"]; summaries: DashboardSnapshot["summaries"] }>(
          "/api/session-report",
          reportDraft,
        );
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
    <div className="pb-28">
      <section className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-[36px] border border-black/10 bg-[#151811] px-6 py-8 text-white shadow-[0_34px_100px_rgba(15,18,13,0.42)]">
          <p className="text-[11px] uppercase tracking-[0.38em] text-white/48">Daily Prescription</p>
          <div className="mt-4 flex flex-wrap items-end justify-between gap-5">
            <div>
              <h1 className="font-display text-5xl uppercase leading-none tracking-[0.04em] sm:text-6xl">
                Train The Day
              </h1>
              <p className="mt-4 max-w-xl text-sm leading-6 text-white/68">
                长期计划只负责方向，今天该做什么由这张处方卡决定。顺序固定 A/B/C 顺延，重复提问默认复用今天的快照。
              </p>
            </div>
            <div className="rounded-[24px] border border-white/10 bg-white/6 px-4 py-4 text-sm">
              <div className="text-white/54">当前目标</div>
              <div className="mt-1 text-lg font-semibold">{snapshot.plan.goal}</div>
              <div className="mt-4 text-white/54">下一训练日</div>
              <div className="mt-1 text-4xl font-display text-[#d5ff63]">{nextDay}</div>
            </div>
          </div>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "Current", value: `${snapshot.profile.currentWeightKg}kg` },
              { label: "Target", value: `${snapshot.profile.targetWeightKg}kg` },
              { label: "Recovery", value: snapshot.plan.manualOverrides?.recoveryMode ?? "standard" },
              { label: "Phase", value: currentPhase.label },
            ].map((item) => (
              <div key={item.label} className="rounded-[20px] border border-white/10 bg-white/4 px-4 py-3">
                <div className="text-[11px] uppercase tracking-[0.28em] text-white/45">{item.label}</div>
                <div className="mt-2 text-lg font-medium text-white">{item.value}</div>
              </div>
            ))}
          </div>
        </div>

        <SectionCard
          eyebrow="Trigger"
          title="生成今日处方"
          description="先问，再生成，再执行。这样每天的建议会落成固定快照，而不是在聊天里漂移。"
        >
          <div className="space-y-4">
            <label className="block">
              <span className="text-sm font-medium text-black/66">今天想问什么</span>
              <textarea
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                rows={3}
                className="mt-2 w-full rounded-[20px] border border-black/10 bg-white/80 px-4 py-3 text-sm outline-none transition focus:border-black/30"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-black/66">额外约束</span>
              <input
                value={constraints}
                onChange={(event) => setConstraints(event.target.value)}
                placeholder="例如：今天只练 60 分钟 / 晚饭后训练 / 状态一般"
                className="mt-2 w-full rounded-[18px] border border-black/10 bg-white/80 px-4 py-3 text-sm outline-none transition focus:border-black/30"
              />
            </label>
            <button
              type="button"
              onClick={handleGenerate}
              disabled={isPending}
              className="w-full rounded-full bg-[#151811] px-5 py-3 text-sm font-semibold text-white transition hover:bg-black disabled:opacity-60"
            >
              {isPending ? "处理中..." : "生成今天怎么练怎么吃"}
            </button>
            {feedback ? <p className="text-sm text-black/56">{feedback}</p> : null}
          </div>
        </SectionCard>
      </section>

      <section className="mt-5 grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <SectionCard
          eyebrow="Workout"
          title={brief?.workoutPrescription.title ?? "等待今日处方"}
          description={brief?.workoutPrescription.objective ?? "输入你的问题后生成。"}
        >
          {brief ? (
            <div className="space-y-5">
              <div className="flex flex-wrap gap-2">
                {brief.reasoningSummary.map((item) => (
                  <span key={item} className="rounded-full bg-[#151811] px-3 py-1.5 text-xs text-white/80">
                    {item}
                  </span>
                ))}
              </div>
              <div className="grid gap-3">
                {brief.workoutPrescription.exercises.length ? (
                  brief.workoutPrescription.exercises.map((exercise) => (
                    <article
                      key={exercise.name}
                      className="rounded-[24px] border border-black/10 bg-white/80 p-4 shadow-[0_12px_28px_rgba(26,24,20,0.05)]"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h3 className="text-lg font-semibold text-[#151811]">{exercise.name}</h3>
                          <p className="mt-1 text-sm text-black/55">{exercise.focus}</p>
                        </div>
                        <div className="rounded-[18px] bg-[#d5ff63] px-3 py-2 text-right">
                          <div className="text-[11px] uppercase tracking-[0.28em] text-black/48">Load</div>
                          <div className="text-base font-semibold">
                            {exercise.suggestedWeightKg ? `${exercise.suggestedWeightKg}kg` : "自重"}
                          </div>
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2 text-xs text-black/62">
                        <span className="rounded-full bg-black/5 px-3 py-1.5">
                          {exercise.sets} x {exercise.reps}
                        </span>
                        <span className="rounded-full bg-black/5 px-3 py-1.5">{exercise.restSeconds}s rest</span>
                      </div>
                      <p className="mt-3 text-sm leading-6 text-black/66">{exercise.reasoning}</p>
                    </article>
                  ))
                ) : (
                  <div className="rounded-[24px] border border-dashed border-black/14 bg-white/75 p-4 text-sm text-black/60">
                    今天按恢复日处理，训练顺位不消耗，下一次继续这一天。
                  </div>
                )}
              </div>
              <div className="rounded-[22px] bg-[#f2eedf] p-4 text-sm text-black/68">
                <div className="font-medium text-[#151811]">热身与提醒</div>
                <ul className="mt-3 space-y-2">
                  {brief.workoutPrescription.warmup.concat(brief.workoutPrescription.caution).map((item) => (
                    <li key={item}>• {item}</li>
                  ))}
                </ul>
              </div>
            </div>
          ) : (
            <div className="rounded-[24px] border border-dashed border-black/14 bg-white/70 p-5 text-sm text-black/55">
              还没有生成今天的处方。先在上方输入“今天怎么练怎么吃”。
            </div>
          )}
        </SectionCard>

        <div className="space-y-5">
          <SectionCard eyebrow="Nutrition" title="训练日饮食卡" description="宏量目标和分餐比例会跟着计划和恢复模式走。">
            {brief ? (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: "Carbs", value: brief.mealPrescription.macros.carbsG },
                    { label: "Protein", value: brief.mealPrescription.macros.proteinG },
                    { label: "Fats", value: brief.mealPrescription.macros.fatsG },
                  ].map((item) => (
                    <div key={item.label} className="rounded-[20px] bg-[#151811] px-4 py-4 text-white">
                      <div className="text-[11px] uppercase tracking-[0.28em] text-white/45">{item.label}</div>
                      <div className="mt-2 text-2xl font-semibold">{item.value}g</div>
                    </div>
                  ))}
                </div>
                <div className="grid gap-3">
                  {brief.mealPrescription.meals.map((meal) => (
                    <div key={meal.label} className="rounded-[20px] border border-black/10 bg-white/76 p-4">
                      <div className="flex items-center justify-between">
                        <div className="text-base font-semibold text-[#151811]">{meal.label}</div>
                        <div className="text-sm text-black/55">{meal.sharePercent}%</div>
                      </div>
                      <p className="mt-2 text-sm text-black/62">{meal.examples.join(" / ")}</p>
                    </div>
                  ))}
                </div>
                <div className="rounded-[22px] bg-[#f2eedf] p-4 text-sm text-black/68">
                  {brief.mealPrescription.guidance.map((item) => (
                    <p key={item} className="mb-2 last:mb-0">
                      • {item}
                    </p>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-sm text-black/55">生成处方后会同步输出饮食卡。</div>
            )}
          </SectionCard>

          <SectionCard eyebrow="Memory" title="最近信号" description="日报和提案会沉淀为短期记忆，供后续问答与处方复用。">
            <div className="space-y-3">
              {summaries.length ? (
                summaries.map((summary) => (
                  <article key={summary.id} className="rounded-[20px] border border-black/10 bg-white/78 p-4">
                    <div className="text-xs uppercase tracking-[0.28em] text-black/40">{summary.date}</div>
                    <p className="mt-2 text-sm font-medium text-[#151811]">{summary.summary}</p>
                    <p className="mt-2 text-xs text-black/52">{summary.signals.join(" / ")}</p>
                  </article>
                ))
              ) : (
                <p className="text-sm text-black/55">还没有任何汇报，第一条日报会从这里开始积累。</p>
              )}
            </div>
          </SectionCard>
        </div>
      </section>

      <section className="mt-5 grid gap-5 lg:grid-cols-[1.05fr_0.95fr]">
        <SectionCard eyebrow="Report" title="训练与饮食汇报" description="执行后立刻回填，系统会更新短期记忆并生成可能的调整提案。">
          {brief ? (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="block rounded-[20px] bg-white/75 p-4">
                  <span className="text-xs uppercase tracking-[0.24em] text-black/40">Body Weight</span>
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
                <label className="block rounded-[20px] bg-white/75 p-4">
                  <span className="text-xs uppercase tracking-[0.24em] text-black/40">Sleep</span>
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
                <label className="block rounded-[20px] bg-white/75 p-4">
                  <span className="text-xs uppercase tracking-[0.24em] text-black/40">Fatigue</span>
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
              </div>
              <div className="space-y-3">
                {reportDraft.exerciseResults.map((exercise, index) => (
                  <article key={exercise.exerciseName} className="rounded-[22px] border border-black/10 bg-white/80 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-base font-semibold text-[#151811]">{exercise.exerciseName}</div>
                        <div className="text-xs text-black/46">
                          目标 {exercise.targetSets} x {exercise.targetReps}
                        </div>
                      </div>
                      <label className="inline-flex items-center gap-2 text-sm text-black/56">
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
                  className="rounded-[18px] border border-black/10 bg-white/80 px-4 py-3 text-sm outline-none"
                  placeholder="疼痛或异常"
                />
                <input
                  value={reportDraft.recoveryNote ?? ""}
                  onChange={(event) => setReportDraft((current) => ({ ...current, recoveryNote: event.target.value }))}
                  className="rounded-[18px] border border-black/10 bg-white/80 px-4 py-3 text-sm outline-none"
                  placeholder="恢复备注"
                />
              </div>
              <button
                type="button"
                onClick={handleSubmitReport}
                disabled={isPending || !brief}
                className="w-full rounded-full bg-[#d5ff63] px-5 py-3 text-sm font-semibold text-[#151811] transition hover:bg-[#c2f24a] disabled:opacity-60"
              >
                {isPending ? "提交中..." : "提交今日汇报"}
              </button>
            </div>
          ) : (
            <div className="text-sm text-black/55">先生成今日处方，再回填执行结果。</div>
          )}
        </SectionCard>

        <SectionCard eyebrow="Adjustments" title="待确认提案" description="AI 只生成提案，不会自动改写正式长期计划。">
          <div className="space-y-3">
            {proposals.length ? (
              proposals.map((proposal) => (
                <article key={proposal.id} className="rounded-[22px] border border-black/10 bg-white/80 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xs uppercase tracking-[0.24em] text-black/42">{proposal.scope}</div>
                      <div className="mt-1 text-base font-semibold text-[#151811]">{proposal.triggerReason}</div>
                    </div>
                    <span className="rounded-full bg-[#151811] px-3 py-1 text-xs uppercase tracking-[0.24em] text-white/72">
                      {proposal.status}
                    </span>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-black/62">{proposal.rationale}</p>
                </article>
              ))
            ) : (
              <p className="text-sm text-black/55">当前没有触发新的调整提案。</p>
            )}
          </div>
        </SectionCard>
      </section>
    </div>
  );
}
