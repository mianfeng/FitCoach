"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";

import { SectionCard } from "@/components/section-card";
import { regenerateLinearPlan } from "@/lib/plan-generator";
import type {
  DayCode,
  PlanCalendarEntry,
  PlanKind,
  PlanSetupInput,
  SessionReport,
  StopTrainingType,
  TrainingReschedule,
} from "@/lib/types";
import { formatDateLabel, uid } from "@/lib/utils";

interface PlanEditorProps {
  initialData: PlanSetupInput;
  recentReports: SessionReport[];
  trainingReschedules: TrainingReschedule[];
  today: string;
  storageMode: "mock" | "supabase";
}

const durationPresets = [4, 8, 12];
const DRAFT_STORAGE_KEY = "fitcoach:plan-draft:v2";
const stopTrainingTypeLabels: Record<StopTrainingType, string> = {
  recovery: "恢复型",
  life_admin: "事务型",
  weight_control: "体重控制型",
};

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
    return "border-[#95bf40]/60 bg-[#e6f3c2] text-[#151811]";
  }
  if (isRest) {
    return "border-[#cfc6b5] bg-[#e7e0d2] text-black/55";
  }
  return "border-[#e4d7a7] bg-[#fff5d6] text-[#151811]";
}

export function PlanEditor({ initialData, recentReports, trainingReschedules, today, storageMode }: PlanEditorProps) {
  const [form, setForm] = useState(initialData);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [needsRegeneration, setNeedsRegeneration] = useState(false);
  const [draftDirty, setDraftDirty] = useState(false);
  const [hydratedDraft, setHydratedDraft] = useState(false);
  const [selectedWeek, setSelectedWeek] = useState(
    initialData.plan.calendarEntries.find((entry) => entry.date === today)?.week ?? initialData.plan.calendarEntries[0]?.week ?? 1,
  );
  const [isPending, startTransition] = useTransition();

  const reportDates = useMemo(() => new Set(recentReports.map((report) => report.date)), [recentReports]);
  const rescheduleMarkers = useMemo(
    () => ({
      sourceDates: new Map(trainingReschedules.map((item) => [item.sourceDate, item])),
      targetDates: new Map(trainingReschedules.map((item) => [item.targetDate, item])),
    }),
    [trainingReschedules],
  );
  const groupedWeeks = useMemo(() => groupByWeek(form.plan.calendarEntries), [form.plan.calendarEntries]);
  const visibleWeek = groupedWeeks.find(([week]) => week === selectedWeek) ?? groupedWeeks[0];
  const isStopTraining = form.plan.kind === "stop_training";
  const stopTraining = form.plan.stopTraining;

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY);
      if (!raw) {
        setHydratedDraft(true);
        return;
      }

      const parsed = JSON.parse(raw) as {
        savedAt: string;
        needsRegeneration: boolean;
        draftDirty: boolean;
        data: PlanSetupInput;
      };
      const serverUpdatedAt = Date.parse(initialData.profile.updatedAt || "");
      const draftUpdatedAt = Date.parse(parsed.savedAt || "");
      if (Number.isFinite(draftUpdatedAt) && draftUpdatedAt >= serverUpdatedAt) {
        setForm(parsed.data);
        setNeedsRegeneration(parsed.needsRegeneration);
        setDraftDirty(parsed.draftDirty);
        setSelectedWeek(
          parsed.data.plan.calendarEntries.find((entry) => entry.date === today)?.week ??
            parsed.data.plan.calendarEntries[0]?.week ??
            1,
        );
        setFeedback("已恢复未保存的计划草稿。");
      } else {
        window.localStorage.removeItem(DRAFT_STORAGE_KEY);
      }
    } catch {
      window.localStorage.removeItem(DRAFT_STORAGE_KEY);
    } finally {
      setHydratedDraft(true);
    }
  }, [initialData.profile.updatedAt, today]);

  useEffect(() => {
    if (!hydratedDraft) {
      return;
    }

    if (!draftDirty) {
      window.localStorage.removeItem(DRAFT_STORAGE_KEY);
      return;
    }

    window.localStorage.setItem(
      DRAFT_STORAGE_KEY,
      JSON.stringify({
        savedAt: new Date().toISOString(),
        needsRegeneration,
        draftDirty,
        data: form,
      }),
    );
  }, [draftDirty, form, hydratedDraft, needsRegeneration]);

  function updateForm(mutator: (current: PlanSetupInput) => PlanSetupInput, options?: { needsRegeneration?: boolean }) {
    setForm((current) => mutator(current));
    setNeedsRegeneration(options?.needsRegeneration ?? true);
    setDraftDirty(true);
  }

  function updatePlanKind(kind: PlanKind) {
    updateForm(
      (current) => ({
        ...current,
        plan: {
          ...current.plan,
          kind,
          stopTraining:
            kind === "stop_training"
              ? current.plan.stopTraining ?? {
                  startDate: today,
                  endDate: today,
                  pauseType: "recovery",
                  note: "",
                }
              : undefined,
        },
      }),
      { needsRegeneration: kind === "formal_training" },
    );
  }

  function updateStopTrainingField<K extends keyof NonNullable<PlanSetupInput["plan"]["stopTraining"]>>(
    key: K,
    value: NonNullable<PlanSetupInput["plan"]["stopTraining"]>[K],
  ) {
    updateForm(
      (current) => ({
        ...current,
        plan: {
          ...current.plan,
          stopTraining: {
            startDate: current.plan.stopTraining?.startDate ?? today,
            endDate: current.plan.stopTraining?.endDate ?? today,
            pauseType: current.plan.stopTraining?.pauseType ?? "recovery",
            note: current.plan.stopTraining?.note ?? "",
            [key]: value,
          },
        },
      }),
      { needsRegeneration: false },
    );
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
    if (isStopTraining) {
      setFeedback("停训模式下不会生成 A/B/C 训练模板。");
      return;
    }

    const invalidExercise = form.templates
      .flatMap((template) => template.exercises.map((exercise) => ({ dayCode: template.dayCode, exercise })))
      .find(
        ({ exercise }) =>
          !exercise.name.trim() || (!exercise.usesBodyweight && (!exercise.oneRepMaxKg || exercise.oneRepMaxKg <= 0)),
      );

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
        goal: `${form.profile.currentWeightKg}kg -> ${form.profile.targetWeightKg}kg ${form.plan.phase}`,
      },
    });

    setForm(generated);
    setSelectedWeek(generated.plan.calendarEntries[0]?.week ?? 1);
    setNeedsRegeneration(false);
    setDraftDirty(true);
    setFeedback("正式训练日历已重新生成。");
  }

  function save() {
    if (isStopTraining && stopTraining && stopTraining.endDate < stopTraining.startDate) {
      setFeedback("停训结束日期不能早于开始日期。");
      return;
    }

    if (needsRegeneration) {
      setFeedback("保存前请先重新生成正式训练计划。");
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
          const error = await response.json().catch(() => ({ error: "保存计划失败" }));
          throw new Error(error.error ?? "保存计划失败");
        }
        const saved = (await response.json()) as PlanSetupInput;
        setForm(saved);
        setNeedsRegeneration(false);
        setDraftDirty(false);
        window.localStorage.removeItem(DRAFT_STORAGE_KEY);
        setFeedback(isStopTraining ? "停训计划已保存。" : "正式训练计划已保存。");
      } catch (error) {
        setFeedback(error instanceof Error ? error.message : "保存计划失败");
      }
    });
  }

  return (
    <div className="grid gap-5 pb-28">
      <SectionCard
        eyebrow="模式"
        title="计划类型"
        description="在正式训练计划和停训计划之间切换。切换到停训时，原有正式训练计划会被保留，便于后续恢复。"
        actions={
          <div className="rounded-full bg-[#151811] px-4 py-2 text-xs uppercase tracking-[0.28em] text-white/72">
            {storageMode}
          </div>
        }
      >
        <div className="mb-4 rounded-[20px] border border-black/10 bg-white/82 px-4 py-3 text-sm text-[#151811]">
          {draftDirty ? "当前有未保存的改动。" : "当前计划已保存并同步。"}
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => updatePlanKind("formal_training")}
            className={`rounded-[18px] px-4 py-4 text-left transition ${
              !isStopTraining ? "bg-[#151811] text-white" : "bg-white/82 text-[#151811]"
            }`}
          >
            <div className="text-xs uppercase tracking-[0.24em] opacity-70">模式</div>
            <div className="mt-2 text-lg font-semibold">正式训练计划</div>
            <p className="mt-2 text-sm leading-6 opacity-80">生成 A/B/C 力量训练处方、训练模板和训练日报流程。</p>
          </button>
          <button
            type="button"
            onClick={() => updatePlanKind("stop_training")}
            className={`rounded-[18px] px-4 py-4 text-left transition ${
              isStopTraining ? "bg-[#151811] text-white" : "bg-white/82 text-[#151811]"
            }`}
          >
            <div className="text-xs uppercase tracking-[0.24em] opacity-70">模式</div>
            <div className="mt-2 text-lg font-semibold">停训计划</div>
            <p className="mt-2 text-sm leading-6 opacity-80">暂停正式训练，并将 Today 页切换为恢复、轻活动和饮食指导模式。</p>
          </button>
        </div>
      </SectionCard>

      {!isStopTraining ? (
        <SectionCard
          eyebrow="日历"
          title="正式训练日历"
          description="按周查看当前正式训练安排，并可打开任意历史日期查看当天面板。"
        >
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "当前体重", value: `${form.profile.currentWeightKg}kg` },
              { label: "目标体重", value: `${form.profile.targetWeightKg}kg` },
              { label: "起始强度", value: `${form.plan.startingIntensityPct}%` },
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
                <div className="text-[11px] uppercase tracking-[0.28em] text-black/42">周选择</div>
                <div className="mt-1 text-lg font-semibold text-[#151811]">按周查看训练安排</div>
              </div>
              <label className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-[#f4f0e3] px-4 py-2 text-sm text-[#151811]">
                <span>周</span>
                <select
                  value={visibleWeek?.[0] ?? selectedWeek}
                  onChange={(event) => setSelectedWeek(Number(event.target.value))}
                  className="bg-transparent font-semibold outline-none"
                >
                  {groupedWeeks.map(([week]) => (
                    <option key={week} value={week}>
                      第 {week} 周
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="mt-4 flex flex-wrap gap-2 text-xs">
              <span className="rounded-full bg-[#dff0bd] px-3 py-1.5 text-[#151811]">已完成</span>
              <span className="rounded-full bg-[#d5ff63] px-3 py-1.5 text-[#151811]">当天</span>
              <span className="rounded-full bg-[#fff8e9] px-3 py-1.5 text-[#151811]">待完成</span>
              <span className="rounded-full bg-[#e4dfd2] px-3 py-1.5 text-[#151811]">休息日</span>
            </div>

            {visibleWeek ? (
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
                {visibleWeek[1].map((entry) => {
                  const status = getCalendarStatus(entry, reportDates, today);
                  const sourceReschedule = rescheduleMarkers.sourceDates.get(entry.date);
                  const targetReschedule = rescheduleMarkers.targetDates.get(entry.date);
                  const clickable = entry.date <= today;
                  const className = `rounded-[18px] border px-3 py-3 transition ${getCalendarClass(status, entry.slot === "rest")}`;
                  const cellBody = (
                    <>
                      <div className="text-[11px] uppercase tracking-[0.2em]">{formatDateLabel(entry.date)}</div>
                      <div className="mt-2 text-sm font-semibold">{entry.label}</div>
                      {sourceReschedule || targetReschedule ? (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {sourceReschedule ? (
                            <span className="rounded-full bg-black/10 px-2 py-1 text-[10px] font-medium text-[#151811]">
                              调出
                            </span>
                          ) : null}
                          {targetReschedule ? (
                            <span className="rounded-full bg-black/10 px-2 py-1 text-[10px] font-medium text-[#151811]">
                              调入
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                    </>
                  );

                  return clickable ? (
                    <Link key={entry.date} href={`/?date=${entry.date}`} className={className}>
                      {cellBody}
                    </Link>
                  ) : (
                    <div key={entry.date} className={className}>
                      {cellBody}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        </SectionCard>
      ) : (
        <SectionCard
          eyebrow="停训"
          title="停训周期"
          description="当前处于停训状态。Today 页将切换为恢复、轻活动和饮食管理模式。"
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-[22px] border border-black/10 bg-[#151811] px-4 py-4 text-white">
              <div className="text-[11px] uppercase tracking-[0.24em] text-white/42">周期</div>
              <div className="mt-2 text-lg font-semibold">
                {stopTraining?.startDate} {"->"} {stopTraining?.endDate}
              </div>
            </div>
            <div className="rounded-[22px] border border-black/10 bg-white/82 px-4 py-4 text-[#151811]">
              <div className="text-[11px] uppercase tracking-[0.24em] text-black/42">停训类型</div>
              <div className="mt-2 text-lg font-semibold">
                {stopTraining ? stopTrainingTypeLabels[stopTraining.pauseType] : "--"}
              </div>
            </div>
            <div className="rounded-[22px] border border-black/10 bg-white/82 px-4 py-4 text-[#151811]">
              <div className="text-[11px] uppercase tracking-[0.24em] text-black/42">恢复规则</div>
              <div className="mt-2 text-sm font-semibold">
                {stopTraining && stopTraining.startDate && stopTraining.endDate
                  ? "7 天以内优先接续原计划；超过 7 天优先重新生成正式训练计划。"
                  : "--"}
              </div>
            </div>
          </div>
        </SectionCard>
      )}

      <SectionCard
        eyebrow="配置"
        title={isStopTraining ? "停训计划配置" : "正式训练计划配置"}
        description={
          isStopTraining
            ? "设置停训日期和停训原因，让 Today 页切换到对应的饮食与恢复指导。"
            : "调整体重、周期和模板输入后，再重新生成正式训练计划。"
        }
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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

        {!isStopTraining ? (
          <>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <label className="block rounded-[22px] bg-white/82 p-4">
                <span className="text-xs uppercase tracking-[0.24em] text-black/42">正式计划开始日期</span>
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
              <div className="sm:col-span-2 rounded-[22px] bg-[#151811] p-4 text-white">
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
          </>
        ) : (
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block rounded-[22px] bg-white/82 p-4">
              <span className="text-xs uppercase tracking-[0.24em] text-black/42">停训开始日期</span>
              <input
                type="date"
                value={stopTraining?.startDate ?? today}
                onChange={(event) => updateStopTrainingField("startDate", event.target.value)}
                className="mt-2 w-full bg-transparent text-lg font-semibold outline-none"
              />
            </label>
            <label className="block rounded-[22px] bg-white/82 p-4">
              <span className="text-xs uppercase tracking-[0.24em] text-black/42">停训结束日期</span>
              <input
                type="date"
                value={stopTraining?.endDate ?? today}
                onChange={(event) => updateStopTrainingField("endDate", event.target.value)}
                className="mt-2 w-full bg-transparent text-lg font-semibold outline-none"
              />
            </label>
            <label className="block rounded-[22px] bg-white/82 p-4">
              <span className="text-xs uppercase tracking-[0.24em] text-black/42">停训类型</span>
              <select
                value={stopTraining?.pauseType ?? "recovery"}
                onChange={(event) => updateStopTrainingField("pauseType", event.target.value as StopTrainingType)}
                className="mt-2 w-full bg-transparent text-lg font-semibold outline-none"
              >
                {Object.entries(stopTrainingTypeLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block rounded-[22px] bg-white/82 p-4 sm:col-span-2">
              <span className="text-xs uppercase tracking-[0.24em] text-black/42">停训备注</span>
              <textarea
                rows={3}
                value={stopTraining?.note ?? ""}
                onChange={(event) => updateStopTrainingField("note", event.target.value)}
                className="mt-2 w-full resize-none bg-transparent text-sm leading-6 outline-none"
                placeholder="记录停训背景和目标，让每日指导更贴合当前状态。"
              />
            </label>
          </div>
        )}

        <div className="mt-5 flex flex-wrap gap-3">
          {!isStopTraining ? (
            <button
              type="button"
              onClick={generatePlan}
              className="rounded-full bg-[#d5ff63] px-5 py-3 text-sm font-semibold text-[#151811] transition hover:bg-[#c2f24a]"
            >
              生成正式训练计划
            </button>
          ) : null}
          <button
            type="button"
            onClick={save}
            disabled={isPending}
            className="rounded-full border border-black/12 px-5 py-3 text-sm font-semibold text-[#151811] transition hover:bg-black/4 disabled:opacity-60"
          >
            {isPending ? "保存中..." : isStopTraining ? "保存停训计划" : "保存正式训练计划"}
          </button>
          {feedback ? <p className="self-center text-sm text-black/56">{feedback}</p> : null}
        </div>
      </SectionCard>

      {!isStopTraining ? (
        <SectionCard
          eyebrow="模板"
          title="A / B / C 训练模板"
          description="编辑正式训练模板。即使后续切换到停训计划，这些模板也会继续保留。"
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
                      <label className="block">
                        <span className="text-[11px] uppercase tracking-[0.2em] text-black/42">动作名称</span>
                        <input
                          value={exercise.name}
                          onChange={(event) =>
                            updateTemplateExercise(template.dayCode, exerciseIndex, { name: event.target.value })
                          }
                          className="mt-2 w-full rounded-[16px] border border-black/10 bg-white px-3 py-3 text-sm font-semibold outline-none"
                          placeholder="输入动作名称"
                        />
                      </label>

                      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto_auto] items-end gap-2">
                        <label className="block">
                          <span className="text-[11px] uppercase tracking-[0.2em] text-black/42">1RM / 自重</span>
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
                        <label className="inline-flex h-[50px] items-center justify-center gap-2 rounded-[16px] border border-black/10 bg-white px-3 text-sm font-medium text-[#151811]">
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
                        <button
                          type="button"
                          onClick={() => removeExercise(template.dayCode, exerciseIndex)}
                          className="h-[50px] rounded-[16px] border border-black/10 bg-white px-4 text-sm font-semibold text-[#151811] transition hover:bg-black/5"
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
      ) : null}
    </div>
  );
}
