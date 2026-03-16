"use client";

import { useMemo, useState, useTransition } from "react";

import { SectionCard } from "@/components/section-card";
import {
  isStructuredSessionReport,
  mealAdherenceLabels,
  mealCookingMethodLabels,
  mealSlotLabels,
  normalizeMealLog,
  resolvePostWorkoutEntry,
} from "@/lib/session-report";
import type {
  DashboardSnapshot,
  ExerciseTemplate,
  MealLogEntry,
  PlanCalendarEntry,
  SessionReport,
  WeeklyPhase,
  WorkoutTemplate,
} from "@/lib/types";
import { roundToIncrement } from "@/lib/utils";

interface HistoryViewProps {
  snapshot: DashboardSnapshot;
}

type WeightTrendPoint = {
  date: string;
  weightKg: number;
};

type WeeklyLinearOverviewRow = {
  week: number;
  schedule: string;
  phaseText: string;
  mainAItems: string[];
  mainBItems: string[];
};

function toWeightLabel(value: number) {
  return `${Math.round(value * 10) / 10} kg`;
}

function toSignedWeightDelta(value: number) {
  const rounded = Math.round(value * 10) / 10;
  return `${rounded > 0 ? "+" : ""}${rounded} kg`;
}

function toDateLabel(date: string) {
  return date.length >= 10 ? date.slice(5) : date;
}

function buildWeightTrend(reports: SessionReport[]) {
  const byDate = new Map<string, WeightTrendPoint>();
  for (const report of reports) {
    if (!Number.isFinite(report.bodyWeightKg)) {
      continue;
    }
    byDate.set(report.date, {
      date: report.date,
      weightKg: Number(report.bodyWeightKg),
    });
  }
  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
}

function isDeloadPhase(phase: WeeklyPhase) {
  return phase.label.includes("减载");
}

function getTemplateOrder(dayCode: WorkoutTemplate["dayCode"]) {
  if (dayCode === "A") {
    return 0;
  }
  if (dayCode === "B") {
    return 1;
  }
  return 2;
}

function pickMainExercises(template: WorkoutTemplate) {
  const primary = template.exercises.find((exercise) => exercise.category === "compound") ?? template.exercises[0];
  const secondary =
    template.exercises.find((exercise) => exercise.category === "compound" && exercise.id !== primary?.id) ??
    template.exercises.find((exercise) => exercise.id !== primary?.id);
  return { primary, secondary };
}

function estimateExerciseWeight(
  exercise: ExerciseTemplate | undefined,
  phase: WeeklyPhase,
  nonDeloadStepsBefore: number,
  defaultIncrementKg: number,
) {
  if (!exercise) {
    return "--";
  }
  if (exercise.usesBodyweight) {
    return "自重";
  }

  const increment = exercise.incrementKg > 0 ? exercise.incrementKg : defaultIncrementKg || 2.5;
  const isDeload = isDeloadPhase(phase);
  const percentage = exercise.percentageOf1RM ?? 1;

  if (exercise.oneRepMaxKg && exercise.progressionModel === "percentage") {
    const raw = exercise.oneRepMaxKg * phase.intensity * percentage;
    const adjusted = isDeload ? raw * 0.9 : raw;
    return `${roundToIncrement(adjusted, increment)}kg`;
  }

  const baseWeight =
    exercise.baseWeightKg ??
    (exercise.oneRepMaxKg ? roundToIncrement(exercise.oneRepMaxKg * 0.7 * percentage, increment) : undefined);

  if (baseWeight == null) {
    return "--";
  }

  const progressed = baseWeight + increment * nonDeloadStepsBefore;
  const adjusted = isDeload ? progressed * 0.8 : progressed;
  return `${roundToIncrement(adjusted, increment)}kg`;
}

function buildWeekSchedule(calendarEntries: PlanCalendarEntry[], week: number) {
  const ordered = calendarEntries
    .filter((entry) => entry.week === week)
    .sort((left, right) => left.dayIndex - right.dayIndex)
    .map((entry) => (entry.slot === "rest" ? "休" : entry.slot));

  const unique: string[] = [];
  for (const label of ordered) {
    if (!unique.includes(label)) {
      unique.push(label);
    }
  }
  return unique.join(" / ");
}

function buildWeeklyLinearRows(snapshot: DashboardSnapshot): WeeklyLinearOverviewRow[] {
  const templates = [...snapshot.templates].sort((left, right) => getTemplateOrder(left.dayCode) - getTemplateOrder(right.dayCode));
  const phases = [...snapshot.plan.progressionRule.weeklyPhases].sort((left, right) => left.week - right.week);

  return phases.map((phase) => {
    const nonDeloadStepsBefore = phases.filter((item) => item.week < phase.week && !isDeloadPhase(item)).length;
    const phaseText = `${phase.label} / ${(phase.intensity * 100).toFixed(1)}% / ${phase.repStyle}`;

    const mainAItems = templates.map((template) => {
      const { primary } = pickMainExercises(template);
      const fallbackIncrement = primary ? (snapshot.plan.progressionRule.defaultIncrementsKg[primary.category] ?? 2.5) : 2.5;
      return `${template.dayCode} ${primary?.name ?? "—"}: ${estimateExerciseWeight(primary, phase, nonDeloadStepsBefore, fallbackIncrement)}`;
    });

    const mainBItems = templates.map((template) => {
      const { secondary } = pickMainExercises(template);
      const fallbackIncrement = secondary ? (snapshot.plan.progressionRule.defaultIncrementsKg[secondary.category] ?? 2.5) : 2.5;
      return `${template.dayCode} ${secondary?.name ?? "—"}: ${estimateExerciseWeight(secondary, phase, nonDeloadStepsBefore, fallbackIncrement)}`;
    });

    return {
      week: phase.week,
      schedule: buildWeekSchedule(snapshot.plan.calendarEntries, phase.week),
      phaseText,
      mainAItems,
      mainBItems,
    };
  });
}

function summarizeMealLog(report: SessionReport) {
  const mealLog = normalizeMealLog(report.mealLog);
  if (!mealLog) {
    return [];
  }

  const postWorkoutLine =
    mealLog.postWorkoutSource === "lunch"
      ? `训练后餐：午餐 (${mealLog.lunch.content || "未填写"})`
      : mealLog.postWorkoutSource === "dinner"
        ? `训练后餐：晚餐 (${mealLog.dinner.content || "未填写"})`
        : `训练后餐：${resolvePostWorkoutEntry(mealLog).content || "未填写"}`;

  return [
    `早餐：${mealLog.breakfast.content || "未填写"}`,
    `午餐：${mealLog.lunch.content || "未填写"}`,
    `晚餐：${mealLog.dinner.content || "未填写"}`,
    `训练前餐：${mealLog.preWorkout.content || "未填写"}`,
    postWorkoutLine,
  ];
}

function formatNutritionLine(report: Pick<SessionReport, "nutritionTotals">) {
  if (!report.nutritionTotals) {
    return null;
  }

  return `${report.nutritionTotals.calories} kcal / 蛋白 ${report.nutritionTotals.proteinG} g / 碳水 ${report.nutritionTotals.carbsG} g / 脂肪 ${report.nutritionTotals.fatsG} g`;
}

function formatMealEstimate(entry: MealLogEntry) {
  if (!entry.nutritionEstimate) {
    return null;
  }

  return `${entry.nutritionEstimate.calories} kcal / P ${entry.nutritionEstimate.proteinG} / C ${entry.nutritionEstimate.carbsG} / F ${entry.nutritionEstimate.fatsG}`;
}

function renderStructuredReportBody(report: SessionReport) {
  const mealLog = normalizeMealLog(report.mealLog);

  return (
    <div className="mt-3 space-y-3">
      {!report.completed ? (
        <div className="rounded-[18px] border border-[#e5d6ae] bg-[#fff6df] px-4 py-3 text-sm leading-6 text-[#5a4620]">
          这是一条草稿记录，只保留当天已填的动作、餐次和恢复信息；正式点评、次日决策和记忆摘要会在完成日报后生成。
        </div>
      ) : null}

      <p className="text-sm text-black/62">
        体重 {report.bodyWeightKg}kg / 睡眠 {report.sleepHours}h / 疲劳 {report.fatigue}/10
      </p>

      {report.exerciseResults?.length ? (
        <div className="rounded-[18px] border border-black/8 bg-[#faf7ef] px-4 py-3">
          <div className="text-[10px] uppercase tracking-[0.2em] text-black/42">Exercise Execution</div>
          <div className="mt-3 space-y-2">
            {report.exerciseResults.map((exercise) => (
              <div
                key={`${report.id}-${exercise.exerciseName}`}
                className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-black/8 pb-2 last:border-b-0 last:pb-0"
              >
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-[#151811]">{exercise.exerciseName}</div>
                  <div className="text-xs text-black/52">
                    {exercise.performed === false ? "未执行" : `实际 ${exercise.actualSets} x ${exercise.actualReps}`}
                  </div>
                  {exercise.notes ? <div className="mt-1 text-xs text-black/48">{exercise.notes}</div> : null}
                </div>
                <div className="text-right text-xs text-black/58">
                  <div>{exercise.topSetWeightKg ? `${exercise.topSetWeightKg}kg` : "自重 / 未填"}</div>
                  <div>RPE {exercise.rpe}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {mealLog ? (
        <div className="rounded-[18px] border border-black/8 bg-[#faf7ef] px-4 py-3">
          <div className="text-[10px] uppercase tracking-[0.2em] text-black/42">Meal Execution</div>

          {report.nutritionTotals ? (
            <div className="mt-3 rounded-[14px] border border-black/10 bg-white px-3 py-3">
              <div className="text-[10px] uppercase tracking-[0.2em] text-black/42">Nutrition Totals</div>
              <div className="mt-2 text-sm font-semibold text-[#151811]">{formatNutritionLine(report)}</div>
              {report.nutritionWarnings?.length ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {report.nutritionWarnings.map((warning) => (
                    <span
                      key={`${report.id}-${warning}`}
                      className="rounded-full border border-[#e5d6ae] bg-[#fff6df] px-2.5 py-1 text-[10px] text-[#5a4620]"
                    >
                      {warning}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          ) : report.nutritionComputation?.status === "pending" ? (
            <div className="mt-3 rounded-[14px] border border-[#e5d6ae] bg-[#fff6df] px-3 py-3 text-sm text-[#5a4620]">
              <div className="text-[10px] uppercase tracking-[0.2em] text-black/42">Nutrition Totals</div>
              <div className="mt-2">营养待 AI 计算</div>
              {report.nutritionWarnings?.length ? (
                <div className="mt-2 space-y-1 text-[11px] leading-5">
                  {report.nutritionWarnings.map((warning) => (
                    <div key={`${report.id}-${warning}`}>{warning}</div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {(["breakfast", "lunch", "dinner", "preWorkout", "postWorkout"] as const).map((slot) => {
              const entry = slot === "postWorkout" ? resolvePostWorkoutEntry(mealLog) : mealLog[slot];
              return (
                <div key={slot} className="rounded-[14px] border border-black/10 bg-white px-3 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-[#151811]">{mealSlotLabels[slot]}</span>
                    <span className="rounded-full bg-[#f1ebd9] px-2 py-1 text-[10px] text-black/58">
                      {mealAdherenceLabels[entry.adherence]}
                    </span>
                  </div>

                  <div className="mt-2 text-sm leading-6 text-black/62">{entry.content || "未填写"}</div>
                  {entry.cookingMethod || entry.rinseOil ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {entry.cookingMethod ? (
                        <span className="rounded-full bg-[#eef3e2] px-2 py-1 text-[10px] text-[#44512a]">
                          {mealCookingMethodLabels[entry.cookingMethod]}
                        </span>
                      ) : null}
                      {entry.rinseOil ? (
                        <span className="rounded-full bg-[#fff1c7] px-2 py-1 text-[10px] text-[#6d5620]">涮油</span>
                      ) : null}
                    </div>
                  ) : null}
                  {entry.nutritionEstimate ? (
                    <div className="mt-2 text-xs font-medium text-[#151811]">{formatMealEstimate(entry)}</div>
                  ) : null}

                  {entry.parsedItems?.length ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {entry.parsedItems.map((item) => (
                        <span
                          key={`${slot}-${item.name}-${item.sourceText}`}
                          className="rounded-full bg-[#f1ebd9] px-2 py-1 text-[10px] text-black/62"
                        >
                          {item.name}
                          {item.grams ? ` ${item.grams}g` : item.milliliters ? ` ${item.milliliters}ml` : ""}
                        </span>
                      ))}
                    </div>
                  ) : null}

                  {entry.analysisWarnings?.length ? (
                    <div className="mt-2 space-y-1 text-[11px] leading-5 text-[#8a5a1f]">
                      {entry.analysisWarnings.map((warning) => (
                        <div key={`${slot}-${warning}`}>{warning}</div>
                      ))}
                    </div>
                  ) : null}

                  {entry.deviationNote ? <div className="mt-1 text-xs text-black/48">{entry.deviationNote}</div> : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {report.nextDayDecision ? (
        <div className="rounded-[18px] border border-[#cddfa0] bg-[#f4f9e6] px-4 py-3">
          <div className="text-[10px] uppercase tracking-[0.2em] text-black/42">Next-Day Decision</div>
          <div className="mt-2 space-y-1 text-sm leading-6 text-[#151811]">
            <div>训练准备度：{report.nextDayDecision.trainingReadiness}</div>
            <div>饮食重点：{report.nextDayDecision.nutritionFocus}</div>
            <div>恢复重点：{report.nextDayDecision.recoveryFocus}</div>
            <div>优先事项：{report.nextDayDecision.priorityNotes.join(" / ")}</div>
          </div>
        </div>
      ) : null}

      {report.dailyReviewMarkdown ? (
        <div className="rounded-[18px] border border-[#cddfa0] bg-[#f4f9e6] px-4 py-3">
          <div className="text-[10px] uppercase tracking-[0.2em] text-black/42">Daily Review</div>
          <pre className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[#151811]">{report.dailyReviewMarkdown}</pre>
        </div>
      ) : null}
    </div>
  );
}

function renderReportBody(report: SessionReport) {
  if (isStructuredSessionReport(report)) {
    return renderStructuredReportBody(report);
  }

  if (report.mealLog || report.trainingReportText || report.dailyReviewMarkdown) {
    const mealLines = summarizeMealLog(report);

    return (
      <div className="mt-3 space-y-3">
        {!report.completed ? (
          <div className="rounded-[18px] border border-[#e5d6ae] bg-[#fff6df] px-4 py-3 text-sm leading-6 text-[#5a4620]">
            这条历史记录仍是草稿，尚未生成正式点评。
          </div>
        ) : null}
        <p className="text-sm text-black/62">
          体重 {report.bodyWeightKg}kg / 睡眠 {report.sleepHours}h / 疲劳 {report.fatigue}/10
        </p>
        {report.trainingReportText ? (
          <div className="rounded-[18px] border border-black/8 bg-[#faf7ef] px-4 py-3 text-sm leading-6 text-black/64">
            {report.trainingReportText}
          </div>
        ) : null}
        {mealLines.length ? (
          <div className="rounded-[18px] border border-black/8 bg-[#faf7ef] px-4 py-3 text-sm leading-6 text-black/64">
            {mealLines.map((line) => (
              <div key={line}>{line}</div>
            ))}
          </div>
        ) : null}
        {report.dailyReviewMarkdown ? (
          <div className="rounded-[18px] border border-[#cddfa0] bg-[#f4f9e6] px-4 py-3">
            <div className="text-[10px] uppercase tracking-[0.2em] text-black/42">Daily Review</div>
            <pre className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[#151811]">{report.dailyReviewMarkdown}</pre>
          </div>
        ) : null}
      </div>
    );
  }

  const exerciseSummary = (report.exerciseResults ?? [])
    .map((item) => `${item.exerciseName} ${item.topSetWeightKg ?? "-"}kg`)
    .join(" / ");

  return (
    <div className="mt-3 space-y-2">
      <p className="text-sm text-black/62">
        体重 {report.bodyWeightKg}kg / 睡眠 {report.sleepHours}h / 饮食达标 {report.dietAdherence ?? "-"} / 5
      </p>
      <p className="text-sm leading-6 text-black/56">{exerciseSummary || "无动作明细"}</p>
    </div>
  );
}

export function HistoryView({ snapshot }: HistoryViewProps) {
  const weeklyLinearRows = useMemo(() => buildWeeklyLinearRows(snapshot), [snapshot]);
  const weightTrend = useMemo(() => buildWeightTrend(snapshot.recentReports), [snapshot.recentReports]);
  const weightChart = useMemo(() => {
    if (!weightTrend.length) {
      return null;
    }

    const width = 660;
    const height = 240;
    const padding = { top: 20, right: 24, bottom: 46, left: 54 };
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;
    const minWeight = Math.min(...weightTrend.map((item) => item.weightKg));
    const maxWeight = Math.max(...weightTrend.map((item) => item.weightKg));
    const rangePad = Math.max((maxWeight - minWeight) * 0.2, 0.4);
    const displayMin = Math.max(0, Math.floor((minWeight - rangePad) * 10) / 10);
    const displayMax = Math.ceil((maxWeight + rangePad) * 10) / 10;
    const range = Math.max(displayMax - displayMin, 0.1);
    const stepX = weightTrend.length > 1 ? plotWidth / (weightTrend.length - 1) : 0;

    const points = weightTrend.map((item, index) => {
      const x = padding.left + stepX * index;
      const y = padding.top + ((displayMax - item.weightKg) / range) * plotHeight;
      return { ...item, x, y };
    });

    const path = points
      .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
      .join(" ");

    return { width, height, padding, displayMin, displayMax, points, path };
  }, [weightTrend]);

  const [proposals, setProposals] = useState(snapshot.proposals);
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);

  function approve(id: string) {
    startTransition(async () => {
      try {
        const response = await fetch(`/api/plan-adjustments/${id}/approve`, { method: "POST" });
        if (!response.ok) {
          const error = await response.json().catch(() => ({ error: "批准失败" }));
          throw new Error(error.error ?? "批准失败");
        }
        const data = (await response.json()) as { proposal: (typeof proposals)[number] };
        setProposals((current) => current.map((item) => (item.id === id ? data.proposal : item)));
        setFeedback("提案已批准并写回正式计划。");
      } catch (error) {
        setFeedback(error instanceof Error ? error.message : "批准失败");
      }
    });
  }

  return (
    <div className="grid gap-5 pb-28 xl:grid-cols-[1fr_1fr]">
      <SectionCard
        eyebrow="Reports"
        title="最近训练与饮食汇报"
        description="这里保存你最近的执行痕迹，是后续问答和处方的历史依据。"
      >
        <div className="space-y-3">
          {snapshot.recentReports.length ? (
            snapshot.recentReports.map((report) => (
              <article key={report.id} className="rounded-[22px] border border-black/10 bg-white/80 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs uppercase tracking-[0.24em] text-black/42">{report.date}</div>
                    <div className="mt-1 text-lg font-semibold text-[#151811]">
                      {report.performedDay === "rest" ? "休息日" : `${report.performedDay} 日`}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {!report.completed ? (
                      <div className="rounded-full bg-[#fff1c7] px-3 py-1 text-xs uppercase tracking-[0.24em] text-[#6d5620]">
                        Draft
                      </div>
                    ) : null}
                    <div className="rounded-full bg-[#151811] px-3 py-1 text-xs uppercase tracking-[0.24em] text-white/70">
                      Fatigue {report.fatigue}
                    </div>
                  </div>
                </div>
                {renderReportBody(report)}
              </article>
            ))
          ) : (
            <p className="text-sm text-black/55">还没有历史汇报，首页提交第一条之后这里会开始累积。</p>
          )}
        </div>
      </SectionCard>

      <div className="space-y-5">
        <SectionCard
          eyebrow="Program"
          title="线性计划总览（按周）"
          description="按周查看当前正式计划，不展开到每天；每行给出周结构、主项重量和阶段强度。"
        >
          {weeklyLinearRows.length ? (
            <div className="overflow-x-auto rounded-[22px] border border-black/12 bg-[#10130f]">
              <table className="min-w-[920px] w-full border-collapse text-sm text-white/84">
                <thead>
                  <tr className="border-b border-white/10 text-left text-[11px] uppercase tracking-[0.2em] text-white/44">
                    <th className="px-4 py-3">Week</th>
                    <th className="px-4 py-3">训练安排</th>
                    <th className="px-4 py-3">主项 A (kg)</th>
                    <th className="px-4 py-3">主项 B (kg)</th>
                    <th className="px-4 py-3">阶段</th>
                  </tr>
                </thead>
                <tbody>
                  {weeklyLinearRows.map((row) => (
                    <tr key={row.week} className="border-b border-white/8 align-top last:border-b-0">
                      <td className="px-4 py-3 text-base font-semibold text-white">W{row.week}</td>
                      <td className="px-4 py-3 text-white/76">{row.schedule}</td>
                      <td className="px-4 py-3">
                        <div className="space-y-1.5">
                          {row.mainAItems.map((item) => (
                            <div key={`a-${row.week}-${item}`} className="text-[13px] leading-5 text-white/80">
                              {item}
                            </div>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="space-y-1.5">
                          {row.mainBItems.map((item) => (
                            <div key={`b-${row.week}-${item}`} className="text-[13px] leading-5 text-white/80">
                              {item}
                            </div>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-white/78">{row.phaseText}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-black/55">暂无可展示的周计划数据。</p>
          )}
        </SectionCard>

        <SectionCard eyebrow="Weight" title="体重记录折线图" description="按日期展示最近汇报中的体重变化趋势。">
          {!weightTrend.length ? (
            <p className="text-sm text-black/55">还没有可用体重记录。</p>
          ) : (
            <div className="rounded-[22px] border border-black/10 bg-white/80 p-4">
              {weightTrend.length >= 2 && weightChart ? (
                <>
                  <svg viewBox={`0 0 ${weightChart.width} ${weightChart.height}`} className="h-56 w-full">
                    {Array.from({ length: 5 }).map((_, index) => {
                      const ratio = index / 4;
                      const y =
                        weightChart.padding.top +
                        ratio * (weightChart.height - weightChart.padding.top - weightChart.padding.bottom);
                      const value = weightChart.displayMax - (weightChart.displayMax - weightChart.displayMin) * ratio;
                      return (
                        <g key={index}>
                          <line
                            x1={weightChart.padding.left}
                            y1={y}
                            x2={weightChart.width - weightChart.padding.right}
                            y2={y}
                            stroke="rgba(21,24,17,0.12)"
                            strokeWidth="1"
                          />
                          <text
                            x={weightChart.padding.left - 8}
                            y={y + 4}
                            textAnchor="end"
                            className="fill-black/45 text-[10px]"
                          >
                            {value.toFixed(1)}
                          </text>
                        </g>
                      );
                    })}
                    <path d={weightChart.path} fill="none" stroke="#151811" strokeWidth="2.8" strokeLinecap="round" />
                    {weightChart.points.map((point) => (
                      <g key={point.date}>
                        <circle cx={point.x} cy={point.y} r="4.5" fill="#d5ff63" stroke="#151811" strokeWidth="1.5" />
                        <text x={point.x} y={weightChart.height - 20} textAnchor="middle" className="fill-black/55 text-[10px]">
                          {toDateLabel(point.date)}
                        </text>
                      </g>
                    ))}
                  </svg>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-black/62">
                    <span className="rounded-full bg-[#f1ebd9] px-2.5 py-1">
                      起点 {toWeightLabel(weightTrend[0].weightKg)}
                    </span>
                    <span className="rounded-full bg-[#f1ebd9] px-2.5 py-1">
                      最新 {toWeightLabel(weightTrend[weightTrend.length - 1].weightKg)}
                    </span>
                    <span className="rounded-full bg-[#151811] px-2.5 py-1 text-white/80">
                      变化 {toSignedWeightDelta(weightTrend[weightTrend.length - 1].weightKg - weightTrend[0].weightKg)}
                    </span>
                  </div>
                </>
              ) : (
                <div className="text-sm text-black/58">
                  目前只有 1 条体重记录：{weightTrend[0].date} {toWeightLabel(weightTrend[0].weightKg)}。
                </div>
              )}
            </div>
          )}
        </SectionCard>

        <SectionCard eyebrow="Summaries" title="记忆摘要" description="系统会从汇报中提炼出每天最重要的信号。">
          <div className="space-y-3">
            {snapshot.summaries.length ? (
              snapshot.summaries.map((summary) => (
                <article key={summary.id} className="rounded-[22px] border border-black/10 bg-white/80 p-4">
                  <div className="text-xs uppercase tracking-[0.24em] text-black/42">{summary.date}</div>
                  <p className="mt-2 text-sm font-medium text-[#151811]">{summary.summary}</p>
                  <p className="mt-2 text-xs text-black/50">{summary.signals.join(" / ")}</p>
                </article>
              ))
            ) : (
              <p className="text-sm text-black/55">还没有记忆摘要。</p>
            )}
          </div>
        </SectionCard>

        <SectionCard eyebrow="Approval" title="计划调整提案" description="所有对正式计划的修改都需要在这里批准。">
          <div className="space-y-3">
            {proposals.length ? (
              proposals.map((proposal) => (
                <article key={proposal.id} className="rounded-[22px] border border-black/10 bg-white/80 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xs uppercase tracking-[0.24em] text-black/42">{proposal.scope}</div>
                      <div className="mt-1 text-base font-semibold text-[#151811]">{proposal.triggerReason}</div>
                    </div>
                    <div className="rounded-full bg-[#f2eedf] px-3 py-1 text-xs uppercase tracking-[0.24em] text-black/60">
                      {proposal.status}
                    </div>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-black/60">{proposal.rationale}</p>
                  {proposal.status === "pending" ? (
                    <button
                      type="button"
                      onClick={() => approve(proposal.id)}
                      disabled={isPending}
                      className="mt-4 rounded-full bg-[#d5ff63] px-4 py-2 text-sm font-semibold text-[#151811] transition hover:bg-[#c2f24a] disabled:opacity-60"
                    >
                      批准并写回计划
                    </button>
                  ) : null}
                </article>
              ))
            ) : (
              <p className="text-sm text-black/55">当前没有待确认提案。</p>
            )}
            {feedback ? <p className="text-sm text-black/56">{feedback}</p> : null}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
