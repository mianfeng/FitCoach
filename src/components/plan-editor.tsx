"use client";

import { useState, useTransition } from "react";

import { SectionCard } from "@/components/section-card";
import type { PlanSetupInput } from "@/lib/types";

interface PlanEditorProps {
  initialData: PlanSetupInput;
  storageMode: "mock" | "supabase";
}

export function PlanEditor({ initialData, storageMode }: PlanEditorProps) {
  const [form, setForm] = useState(initialData);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function updateTemplateExercise(
    templateIndex: number,
    exerciseIndex: number,
    patch: Partial<PlanSetupInput["templates"][number]["exercises"][number]>,
  ) {
    setForm((current) => ({
      ...current,
      templates: current.templates.map((template, currentTemplateIndex) =>
        currentTemplateIndex === templateIndex
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

  function save() {
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
        setFeedback("长期计划已保存。");
      } catch (error) {
        setFeedback(error instanceof Error ? error.message : "保存失败");
      }
    });
  }

  async function importKnowledge() {
    startTransition(async () => {
      try {
        const response = await fetch("/api/knowledge/import", { method: "POST" });
        if (!response.ok) {
          const error = await response.json().catch(() => ({ error: "导入失败" }));
          throw new Error(error.error ?? "导入失败");
        }
        const result = (await response.json()) as { importedDocs: number; importedChunks: number };
        setFeedback(`知识库已刷新：${result.importedDocs} 份文档，${result.importedChunks} 个切块。`);
      } catch (error) {
        setFeedback(error instanceof Error ? error.message : "导入失败");
      }
    });
  }

  return (
    <div className="grid gap-5 pb-28">
      <SectionCard
        eyebrow="Plan Control"
        title="长期计划总控台"
        description="这里定义长期目标、角色和模板。每日处方只会读取这里的正式状态。"
        actions={
          <div className="rounded-full bg-[#151811] px-4 py-2 text-xs uppercase tracking-[0.28em] text-white/72">
            {storageMode}
          </div>
        }
      >
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block rounded-[22px] bg-white/78 p-4">
            <span className="text-xs uppercase tracking-[0.24em] text-black/42">Goal</span>
            <input
              value={form.plan.goal}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  plan: { ...current.plan, goal: event.target.value },
                }))
              }
              className="mt-2 w-full bg-transparent text-2xl font-semibold outline-none"
            />
          </label>
          <label className="block rounded-[22px] bg-white/78 p-4">
            <span className="text-xs uppercase tracking-[0.24em] text-black/42">Coach Persona</span>
            <input
              value={form.persona.name}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  persona: { ...current.persona, name: event.target.value },
                }))
              }
              className="mt-2 w-full bg-transparent text-2xl font-semibold outline-none"
            />
          </label>
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <label className="block rounded-[20px] bg-white/78 p-4">
            <span className="text-xs uppercase tracking-[0.24em] text-black/42">Current Weight</span>
            <input
              type="number"
              step="0.1"
              value={form.profile.currentWeightKg}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  profile: { ...current.profile, currentWeightKg: Number(event.target.value) },
                }))
              }
              className="mt-2 w-full bg-transparent text-xl font-semibold outline-none"
            />
          </label>
          <label className="block rounded-[20px] bg-white/78 p-4">
            <span className="text-xs uppercase tracking-[0.24em] text-black/42">Target Weight</span>
            <input
              type="number"
              step="0.1"
              value={form.profile.targetWeightKg}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  profile: { ...current.profile, targetWeightKg: Number(event.target.value) },
                }))
              }
              className="mt-2 w-full bg-transparent text-xl font-semibold outline-none"
            />
          </label>
          <label className="block rounded-[20px] bg-white/78 p-4">
            <span className="text-xs uppercase tracking-[0.24em] text-black/42">Sleep Target</span>
            <input
              type="number"
              step="0.5"
              value={form.profile.sleepTargetHours}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  profile: { ...current.profile, sleepTargetHours: Number(event.target.value) },
                }))
              }
              className="mt-2 w-full bg-transparent text-xl font-semibold outline-none"
            />
          </label>
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <label className="block rounded-[22px] bg-white/78 p-4">
            <span className="text-xs uppercase tracking-[0.24em] text-black/42">Voice</span>
            <input
              value={form.persona.voice}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  persona: { ...current.persona, voice: event.target.value },
                }))
              }
              className="mt-2 w-full bg-transparent text-base outline-none"
            />
          </label>
          <label className="block rounded-[22px] bg-white/78 p-4">
            <span className="text-xs uppercase tracking-[0.24em] text-black/42">Mission</span>
            <input
              value={form.persona.mission}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  persona: { ...current.persona, mission: event.target.value },
                }))
              }
              className="mt-2 w-full bg-transparent text-base outline-none"
            />
          </label>
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-4">
          <label className="block rounded-[20px] bg-[#151811] p-4 text-white">
            <span className="text-xs uppercase tracking-[0.24em] text-white/42">Train Carbs/kg</span>
            <input
              type="number"
              step="0.1"
              value={form.plan.mealStrategy.trainingCarbsPerKg}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  plan: {
                    ...current.plan,
                    mealStrategy: {
                      ...current.plan.mealStrategy,
                      trainingCarbsPerKg: Number(event.target.value),
                    },
                  },
                }))
              }
              className="mt-2 w-full bg-transparent text-xl font-semibold outline-none"
            />
          </label>
          <label className="block rounded-[20px] bg-[#151811] p-4 text-white">
            <span className="text-xs uppercase tracking-[0.24em] text-white/42">Rest Carbs/kg</span>
            <input
              type="number"
              step="0.1"
              value={form.plan.mealStrategy.restCarbsPerKg}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  plan: {
                    ...current.plan,
                    mealStrategy: {
                      ...current.plan.mealStrategy,
                      restCarbsPerKg: Number(event.target.value),
                    },
                  },
                }))
              }
              className="mt-2 w-full bg-transparent text-xl font-semibold outline-none"
            />
          </label>
          <label className="block rounded-[20px] bg-[#151811] p-4 text-white">
            <span className="text-xs uppercase tracking-[0.24em] text-white/42">Protein/kg</span>
            <input
              type="number"
              step="0.1"
              value={form.plan.mealStrategy.proteinPerKg}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  plan: {
                    ...current.plan,
                    mealStrategy: {
                      ...current.plan.mealStrategy,
                      proteinPerKg: Number(event.target.value),
                    },
                  },
                }))
              }
              className="mt-2 w-full bg-transparent text-xl font-semibold outline-none"
            />
          </label>
          <label className="block rounded-[20px] bg-[#151811] p-4 text-white">
            <span className="text-xs uppercase tracking-[0.24em] text-white/42">Fats/kg</span>
            <input
              type="number"
              step="0.1"
              value={form.plan.mealStrategy.fatsPerKg}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  plan: {
                    ...current.plan,
                    mealStrategy: {
                      ...current.plan.mealStrategy,
                      fatsPerKg: Number(event.target.value),
                    },
                  },
                }))
              }
              className="mt-2 w-full bg-transparent text-xl font-semibold outline-none"
            />
          </label>
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={save}
            disabled={isPending}
            className="rounded-full bg-[#d5ff63] px-5 py-3 text-sm font-semibold text-[#151811] transition hover:bg-[#c2f24a] disabled:opacity-60"
          >
            {isPending ? "保存中..." : "保存正式计划"}
          </button>
          <button
            type="button"
            onClick={importKnowledge}
            disabled={isPending}
            className="rounded-full border border-black/12 px-5 py-3 text-sm font-semibold text-[#151811] transition hover:bg-black/4 disabled:opacity-60"
          >
            刷新知识库
          </button>
          {feedback ? <p className="self-center text-sm text-black/56">{feedback}</p> : null}
        </div>
      </SectionCard>

      <SectionCard eyebrow="Templates" title="A / B / C 模板维护" description="v1 先允许维护关键重量、组次和推进幅度。">
        <div className="grid gap-4">
          {form.templates.map((template, templateIndex) => (
            <article key={template.id} className="rounded-[26px] border border-black/10 bg-white/80 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.28em] text-black/42">{template.dayCode}</p>
                  <h3 className="mt-2 text-2xl font-semibold text-[#151811]">{template.name}</h3>
                </div>
                <input
                  value={template.objective}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      templates: current.templates.map((item, index) =>
                        index === templateIndex ? { ...item, objective: event.target.value } : item,
                      ),
                    }))
                  }
                  className="min-w-[240px] rounded-full border border-black/10 bg-[#f4f0e3] px-4 py-2 text-sm outline-none"
                />
              </div>
              <div className="mt-4 space-y-3">
                {template.exercises.map((exercise, exerciseIndex) => (
                  <div
                    key={exercise.id}
                    className="grid gap-3 rounded-[20px] border border-black/10 bg-[#faf7ef] p-4 lg:grid-cols-[1.6fr_0.8fr_0.8fr_0.8fr]"
                  >
                    <div>
                      <div className="text-base font-semibold text-[#151811]">{exercise.name}</div>
                      <div className="text-sm text-black/54">{exercise.focus}</div>
                    </div>
                    <input
                      type="number"
                      step="0.5"
                      value={exercise.baseWeightKg ?? 0}
                      onChange={(event) =>
                        updateTemplateExercise(templateIndex, exerciseIndex, {
                          baseWeightKg: Number(event.target.value),
                        })
                      }
                      className="rounded-[16px] border border-black/10 bg-white px-3 py-2 text-sm outline-none"
                    />
                    <input
                      value={exercise.reps}
                      onChange={(event) =>
                        updateTemplateExercise(templateIndex, exerciseIndex, { reps: event.target.value })
                      }
                      className="rounded-[16px] border border-black/10 bg-white px-3 py-2 text-sm outline-none"
                    />
                    <input
                      type="number"
                      step="0.5"
                      value={exercise.incrementKg}
                      onChange={(event) =>
                        updateTemplateExercise(templateIndex, exerciseIndex, {
                          incrementKg: Number(event.target.value),
                        })
                      }
                      className="rounded-[16px] border border-black/10 bg-white px-3 py-2 text-sm outline-none"
                    />
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
