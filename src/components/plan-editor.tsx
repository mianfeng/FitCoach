"use client";

import { useState, useTransition } from "react";

import { SectionCard } from "@/components/section-card";
import { regenerateLinearPlan } from "@/lib/plan-generator";
import type { DayCode, PlanSetupInput } from "@/lib/types";
import { formatDateLabel, uid } from "@/lib/utils";

interface PlanEditorProps {
  initialData: PlanSetupInput;
  storageMode: "mock" | "supabase";
}

const durationPresets = [4, 8, 12];

function groupByWeek(calendarEntries: PlanSetupInput["plan"]["calendarEntries"]) {
  const buckets = new Map<number, PlanSetupInput["plan"]["calendarEntries"]>();
  for (const entry of calendarEntries) {
    const current = buckets.get(entry.week) ?? [];
    current.push(entry);
    buckets.set(entry.week, current);
  }
  return Array.from(buckets.entries());
}

export function PlanEditor({ initialData, storageMode }: PlanEditorProps) {
  const [form, setForm] = useState(initialData);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [needsRegeneration, setNeedsRegeneration] = useState(false);
  const [isPending, startTransition] = useTransition();

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

  function generatePlan() {
    const invalidExercise = form.templates
      .flatMap((template) => template.exercises.map((exercise) => ({ dayCode: template.dayCode, exercise })))
      .find(({ exercise }) => !exercise.name.trim() || !exercise.oneRepMaxKg || exercise.oneRepMaxKg <= 0);

    if (invalidExercise) {
      setFeedback(`请先补全 ${invalidExercise.dayCode} 日模板中的动作名称和 1RM。`);
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
        description="计划先按日期展开，再由 Today 页按正式计划读取训练模板。"
        actions={
          <div className="rounded-full bg-[#151811] px-4 py-2 text-xs uppercase tracking-[0.28em] text-white/72">
            {storageMode}
          </div>
        }
      >
        <div className="grid gap-3 lg:grid-cols-3">
          {[
            { label: "Current", value: `${form.profile.currentWeightKg}kg` },
            { label: "Target", value: `${form.profile.targetWeightKg}kg` },
            { label: "Intensity", value: `${form.plan.startingIntensityPct}%` },
          ].map((item) => (
            <div key={item.label} className="rounded-[22px] border border-black/10 bg-[#151811] px-4 py-4 text-white">
              <div className="text-[11px] uppercase tracking-[0.28em] text-white/42">{item.label}</div>
              <div className="mt-2 text-2xl font-semibold">{item.value}</div>
            </div>
          ))}
        </div>

        <div className="mt-5 space-y-4">
          {groupByWeek(form.plan.calendarEntries).map(([week, entries]) => (
            <article key={week} className="rounded-[24px] border border-black/10 bg-white/82 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.28em] text-black/42">Week {week}</div>
                  <div className="mt-1 text-lg font-semibold text-[#151811]">W{week} 日历</div>
                </div>
                <div className="rounded-full bg-black/5 px-3 py-1.5 text-xs text-black/56">3练1休</div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
                {entries.map((entry) => (
                  <div
                    key={entry.date}
                    className={`rounded-[18px] border px-3 py-3 ${
                      entry.slot === "rest"
                        ? "border-black/8 bg-[#ece8de] text-black/52"
                        : "border-[#cde96e]/40 bg-[#f4f9dc] text-[#151811]"
                    }`}
                  >
                    <div className="text-[11px] uppercase tracking-[0.2em]">{formatDateLabel(entry.date)}</div>
                    <div className="mt-2 text-sm font-semibold">{entry.label}</div>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      </SectionCard>

      <SectionCard
        eyebrow="Control"
        title="长期计划总控台"
        description="在这里输入当前体重、目标、起始强度和计划周期，然后重新生成整段线性计划。"
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
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
        </div>

        <div className="mt-4 rounded-[24px] border border-black/10 bg-[#151811] p-4 text-white">
          <div className="text-[11px] uppercase tracking-[0.28em] text-white/42">计划周期</div>
          <div className="mt-3 flex flex-wrap gap-2">
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
                className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                  form.plan.durationWeeks === weeks ? "bg-[#d5ff63] text-[#151811]" : "bg-white/8 text-white/74"
                }`}
              >
                {weeks} 周
              </button>
            ))}
            <label className="inline-flex items-center gap-2 rounded-full bg-white/8 px-4 py-2 text-sm text-white/74">
              自定义
              <input
                type="number"
                min="1"
                max="52"
                value={form.plan.durationWeeks}
                onChange={(event) =>
                  updateForm((current) => ({
                    ...current,
                    plan: { ...current.plan, durationWeeks: Number(event.target.value) },
                  }))
                }
                className="w-16 bg-transparent text-right font-semibold text-white outline-none"
              />
            </label>
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
        description="这里只维护动作名称和最大重量(1RM)。组次、休息和推进规则由线性计划自动生成。"
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
                  <div
                    key={exercise.id}
                    className="grid gap-3 rounded-[20px] border border-black/10 bg-[#faf7ef] p-4 md:grid-cols-[1.4fr_0.8fr]"
                  >
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
                    <label className="block">
                      <span className="text-[11px] uppercase tracking-[0.2em] text-black/42">最大重量 1RM</span>
                      <input
                        type="number"
                        step="0.5"
                        min="0"
                        value={exercise.oneRepMaxKg ?? ""}
                        onChange={(event) =>
                          updateTemplateExercise(template.dayCode, exerciseIndex, {
                            oneRepMaxKg: event.target.value ? Number(event.target.value) : undefined,
                          })
                        }
                        className="mt-2 w-full rounded-[16px] border border-black/10 bg-white px-3 py-3 text-sm font-semibold outline-none"
                        placeholder="kg"
                      />
                    </label>
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
