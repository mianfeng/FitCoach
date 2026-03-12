"use client";

import { useMemo, useState, useTransition } from "react";

import { SectionCard } from "@/components/section-card";
import { regenerateLinearPlan } from "@/lib/plan-generator";
import type { DayCode, PlanCalendarEntry, PlanSetupInput, SessionReport } from "@/lib/types";
import { formatDateLabel, uid } from "@/lib/utils";

interface PlanEditorProps {
  initialData: PlanSetupInput;
  recentReports: SessionReport[];
  today: string;
  storageMode: "mock" | "supabase";
}

const durationPresets = [4, 8, 12];

function groupByWeek(calendarEntries: PlanCalendarEntry[]) {
  const buckets = new Map<number, PlanCalendarEntry[]>();
  for (const entry of calendarEntries) {
    const current = buckets.get(entry.week) ?? [];
    current.push(entry);
    buckets.set(entry.week, current);
  }
  return Array.from(buckets.entries()).sort((left, right) => left[0] - right[0]);
}

function getCalendarStatus(entry: PlanCalendarEntry, reportDates: Set<string>, today: string) {
  if (entry.date === today) {
    return "today";
  }
  if (reportDates.has(entry.date)) {
    return "done";
  }
  return "pending";
}

function getCalendarClass(status: "today" | "done" | "pending", isRest: boolean) {
  if (status === "today") {
    return "border-[#151811] bg-[#d5ff63] text-[#151811] shadow-[0_16px_28px_rgba(213,255,99,0.28)]";
  }
  if (status === "done") {
    return "border-[#aac95a]/50 bg-[#eef6d2] text-[#151811]";
  }
  if (isRest) {
    return "border-black/8 bg-[#ece8de] text-black/52";
  }
  return "border-black/10 bg-white text-[#151811]";
}

export function PlanEditor({ initialData, recentReports, today, storageMode }: PlanEditorProps) {
  const [form, setForm] = useState(initialData);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [needsRegeneration, setNeedsRegeneration] = useState(false);
  const [selectedWeek, setSelectedWeek] = useState(initialData.plan.calendarEntries[0]?.week ?? 1);
  const [isPending, startTransition] = useTransition();

  const reportDates = useMemo(() => new Set(recentReports.map((report) => report.date)), [recentReports]);
  const groupedWeeks = useMemo(() => groupByWeek(form.plan.calendarEntries), [form.plan.calendarEntries]);
  const visibleWeek = groupedWeeks.find(([week]) => week === selectedWeek) ?? groupedWeeks[0];

  function updateForm(mutator: (current: PlanSetupInput) => PlanSetupInput) {
    setForm((current) => mutator(current));
    setNeedsRegeneration(true);
  }

  function updateTemplateExercise(
    dayCode: DayCode,
    exerciseIndex: number,
    patch: Partial<PlanSetupInput["templates"][number]["exercises"][number]>,
  ) {
    updateForm((current) => ({
      ...current,
      templates: current.templates.map((template) =>
        template.dayCode === dayCode
          ? {
              ...template,
              exercises: template.exercises.map((exercise, currentExerciseIndex) =>
                currentExerciseIndex === exerciseIndex ? { ...exercise, ...patch } : exercise,
              ),
            }
          : template,
      ),
    }));
  }

  function addExercise(dayCode: DayCode) {
    updateForm((current) => ({
      ...current,
      templates: current.templates.map((template) =>
        template.dayCode === dayCode
          ? {
              ...template,
              exercises: [
                ...template.exercises,
                {
                  id: uid(`${dayCode.toLowerCase()}-exercise`),
                  name: "",
                  category: "compound",
                  focus: "",
                  sets: 4,
                  reps: "8",
                  restSeconds: 90,
                  cues: [],
                  oneRepMaxKg: undefined,
                  usesBodyweight: false,
                  progressionModel: "percentage",
                  percentageOf1RM: 1,
                  incrementKg: 2.5,
                  substitutions: [],
                  phaseAdaptive: true,
                },
              ],
            }
          : template,
      ),
    }));
  }

  function removeExercise(dayCode: DayCode, exerciseIndex: number) {
    updateForm((current) => ({
      ...current,
      templates: current.templates.map((template) =>
        template.dayCode === dayCode
          ? {
              ...template,
              exercises: template.exercises.filter((_, currentExerciseIndex) => currentExerciseIndex !== exerciseIndex),
            }
          : template,
      ),
    }));
  }

  function generatePlan() {
    const invalidExercise = form.templates
      .flatMap((template) => template.exercises.map((exercise) => ({ dayCode: template.dayCode, exercise })))
      .find(
        ({ exercise }) =>
          !exercise.name.trim() || (!exercise.usesBodyweight && (!exercise.oneRepMaxKg || exercise.oneRepMaxKg <= 0)),
      );

    if (invalidExercise) {
      setFeedback(`请先补全 ${invalidExercise.dayCode} 日模板中的动作名称和 1RM，或勾选自重。`);
      return;
    }

    const generated = regenerateLinearPlan({
      ...form,
      profile: {
        ...form.profile,
        updatedAt: new Date().toISOString(),
      },
      plan: {
        ...form.plan,
        goal: `${form.profile.currentWeightKg}kg -> ${form.profile.targetWeightKg}kg Lean Bulk`,
      },
    });

    setForm(generated);
    setSelectedWeek(generated.plan.calendarEntries[0]?.week ?? 1);
    setNeedsRegeneration(false);
    setFeedback("线性计划已生成，顶部训练日历已更新。");
  }

  function save() {
    if (needsRegeneration) {
      setFeedback("你修改了总控台或模板，请先点击“生成线性计划”再保存。");
      return;
    }

    startTransition(async () => {
      try {
        const response = await fetch("/api/plan/setup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        });
        if (!response.ok) {
          const error = await response.json().catch(() => ({ error: "保存失败" }));
          throw new Error(error.error ?? "保存失败");
        }
        setFeedback("长期计划和训练日历已保存。");
      } catch (error) {
        setFeedback(error instanceof Error ? error.message : "保存失败");
      }
    });
  }

  return (
    <div className="grid gap-5 pb-28">
      <SectionCard
        eyebrow="Calendar"
        title="训练日历表"
        description="按周查看正式计划。绿色代表已完成，亮色代表当日，浅色代表未完成。"
        actions={
          <div className="rounded-full bg-[#151811] px-4 py-2 text-xs uppercase tracking-[0.28em] text-white/72">
            {storageMode}
          </div>
        }
      >
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Current", value: `${form.profile.currentWeightKg}kg` },
            { label: "Target", value: `${form.profile.targetWeightKg}kg` },
            { label: "Intensity", value: `${form.plan.startingIntensityPct}%` },
          ].map((item) => (
            <div key={item.label} className="rounded-[22px] border border-black/10 bg-[#151811] px-4 py-4 text-white">
              <div className="text-[11px] uppercase tracking-[0.28em] text-white/42">{item.label}</div>
              <div className="mt-2 text-xl font-semibold sm:text-2xl">{item.value}</div>
            </div>
          ))}
        </div>

        <div className="mt-5 rounded-[24px] border border-black/10 bg-white/82 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-[11px] uppercase tracking-[0.28em] text-black/42">Week Selector</div>
              <div className="mt-1 text-lg font-semibold text-[#151811]">选择查看 WEEK</div>
            </div>
            <label className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-[#f4f0e3] px-4 py-2 text-sm text-[#151811]">
              <span>Week</span>
              <select
                value={visibleWeek?.[0] ?? selectedWeek}
                onChange={(event) => setSelectedWeek(Number(event.target.value))}
                className="bg-transparent font-semibold outline-none"
              >
                {groupedWeeks.map(([week]) => (
                  <option key={week} value={week}>
                    WEEK {week}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-[#eef6d2] px-3 py-1.5 text-[#151811]">已完成</span>
            <span className="rounded-full bg-[#d5ff63] px-3 py-1.5 text-[#151811]">当日</span>
            <span className="rounded-full bg-[#f4f0e3] px-3 py-1.5 text-[#151811]">未完成</span>
          </div>

          {visibleWeek ? (
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
              {visibleWeek[1].map((entry) => {
                const status = getCalendarStatus(entry, reportDates, today);
                return (
                  <div
                    key={entry.date}
                    className={`rounded-[18px] border px-3 py-3 ${getCalendarClass(status, entry.slot === "rest")}`}
                  >
                    <div className="text-[11px] uppercase tracking-[0.2em]">{formatDateLabel(entry.date)}</div>
                    <div className="mt-2 text-sm font-semibold">{entry.label}</div>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      </SectionCard>

      <SectionCard
        eyebrow="Control"
        title="长期计划总控台"
        description="这里输入当前状态、目标和周期，然后重新生成整段线性计划。"
      >
        <div className="grid gap-4 md:grid-cols-3">
          <label className="block rounded-[22px] bg-white/82 p-4">
            <span className="text-xs uppercase tracking-[0.24em] text-black/42">当前体重</span>
            <input
              type="number"
              step="0.1"
              value={form.profile.currentWeightKg}
              onChange={(event) =>
                updateForm((current) => ({
                  ...current,
                  profile: { ...current.profile, currentWeightKg: Number(event.target.value) },
                }))
              }
              className="mt-2 w-full bg-transparent text-2xl font-semibold outline-none"
            />
          </label>
          <label className="block rounded-[22px] bg-white/82 p-4">
            <span className="text-xs uppercase tracking-[0.24em] text-black/42">目标体重</span>
            <input
              type="number"
              step="0.1"
              value={form.profile.targetWeightKg}
              onChange={(event) =>
                updateForm((current) => ({
                  ...current,
                  profile: { ...current.profile, targetWeightKg: Number(event.target.value) },
                }))
              }
              className="mt-2 w-full bg-transparent text-2xl font-semibold outline-none"
            />
          </label>
          <label className="block rounded-[22px] bg-white/82 p-4">
            <span className="text-xs uppercase tracking-[0.24em] text-black/42">起始强度 %</span>
            <input
              type="number"
              step="1"
              min="45"
              max="90"
              value={form.plan.startingIntensityPct}
              onChange={(event) =>
                updateForm((current) => ({
                  ...current,
                  plan: { ...current.plan, startingIntensityPct: Number(event.target.value) },
                }))
              }
              className="mt-2 w-full bg-transparent text-2xl font-semibold outline-none"
            />
          </label>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <label className="block rounded-[22px] bg-white/82 p-4">
            <span className="text-xs uppercase tracking-[0.24em] text-black/42">开始日期</span>
            <input
              type="date"
              value={form.plan.startDate}
              onChange={(event) =>
                updateForm((current) => ({
                  ...current,
                  plan: { ...current.plan, startDate: event.target.value },
                }))
              }
              className="mt-2 w-full bg-transparent text-lg font-semibold outline-none"
            />
          </label>
          <div className="rounded-[22px] bg-[#151811] p-4 text-white md:col-span-2">
            <div className="text-xs uppercase tracking-[0.24em] text-white/42">计划周期</div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {durationPresets.map((weeks) => (
                <button
                  key={weeks}
                  type="button"
                  onClick={() =>
                    updateForm((current) => ({
                      ...current,
                      plan: { ...current.plan, durationWeeks: weeks },
                    }))
                  }
                  className={`rounded-[16px] px-4 py-3 text-sm font-semibold transition ${
                    form.plan.durationWeeks === weeks ? "bg-[#d5ff63] text-[#151811]" : "bg-white/8 text-white/74"
                  }`}
                >
                  {weeks} 周
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={generatePlan}
            className="rounded-full bg-[#d5ff63] px-5 py-3 text-sm font-semibold text-[#151811] transition hover:bg-[#c2f24a]"
          >
            生成线性计划
          </button>
          <button
            type="button"
            onClick={save}
            disabled={isPending}
            className="rounded-full border border-black/12 px-5 py-3 text-sm font-semibold text-[#151811] transition hover:bg-black/4 disabled:opacity-60"
          >
            {isPending ? "保存中..." : "保存正式计划"}
          </button>
          {feedback ? <p className="self-center text-sm text-black/56">{feedback}</p> : null}
        </div>
      </SectionCard>

      <SectionCard
        eyebrow="Templates"
        title="A / B / C 模板"
        description="可新增、删除动作。每个动作只维护名称和重量类型。"
      >
        <div className="grid gap-4">
          {form.templates.map((template) => (
            <article key={template.id} className="rounded-[26px] border border-black/10 bg-white/82 p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.28em] text-black/42">{template.dayCode}</p>
                  <h3 className="mt-2 text-2xl font-semibold text-[#151811]">{template.name}</h3>
                </div>
                <button
                  type="button"
                  onClick={() => addExercise(template.dayCode)}
                  className="rounded-full bg-[#151811] px-4 py-2 text-sm font-semibold text-white"
                >
                  新增动作
                </button>
              </div>

              <div className="mt-4 space-y-3">
                {template.exercises.map((exercise, exerciseIndex) => (
                  <div key={exercise.id} className="rounded-[20px] border border-black/10 bg-[#faf7ef] p-4">
                    <div className="grid gap-3 md:grid-cols-[1.25fr_0.95fr_auto]">
                      <label className="block">
                        <span className="text-[11px] uppercase tracking-[0.2em] text-black/42">动作名</span>
                        <input
                          value={exercise.name}
                          onChange={(event) =>
                            updateTemplateExercise(template.dayCode, exerciseIndex, { name: event.target.value })
                          }
                          className="mt-2 w-full rounded-[16px] border border-black/10 bg-white px-3 py-3 text-sm font-semibold outline-none"
                          placeholder="输入动作名称"
                        />
                      </label>

                      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                        <label className="block">
                          <span className="text-[11px] uppercase tracking-[0.2em] text-black/42">最大重量 / 自重</span>
                          <input
                            type="number"
                            step="0.5"
                            min="0"
                            value={exercise.usesBodyweight ? "" : (exercise.oneRepMaxKg ?? "")}
                            onChange={(event) =>
                              updateTemplateExercise(template.dayCode, exerciseIndex, {
                                oneRepMaxKg: event.target.value ? Number(event.target.value) : undefined,
                              })
                            }
                            disabled={exercise.usesBodyweight}
                            className="mt-2 w-full rounded-[16px] border border-black/10 bg-white px-3 py-3 text-sm font-semibold outline-none disabled:opacity-40"
                            placeholder="kg"
                          />
                        </label>
                        <label className="mt-7 inline-flex items-center justify-center gap-2 rounded-[16px] border border-black/10 bg-white px-3 py-3 text-sm font-medium text-[#151811]">
                          <input
                            type="checkbox"
                            checked={exercise.usesBodyweight ?? false}
                            onChange={(event) =>
                              updateTemplateExercise(template.dayCode, exerciseIndex, {
                                usesBodyweight: event.target.checked,
                                oneRepMaxKg: event.target.checked ? undefined : exercise.oneRepMaxKg,
                              })
                            }
                            className="h-4 w-4 accent-[#151811]"
                          />
                          自重
                        </label>
                      </div>

                      <button
                        type="button"
                        onClick={() => removeExercise(template.dayCode, exerciseIndex)}
                        className="rounded-[16px] border border-black/10 bg-white px-4 py-3 text-sm font-semibold text-[#151811] transition hover:bg-black/5"
                      >
                        删除
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}
