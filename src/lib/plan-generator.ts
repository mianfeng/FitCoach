import { addDays } from "date-fns";

import type {
  ExerciseTemplate,
  PlanCalendarEntry,
  PlanSetupInput,
  PlanCalendarSlot,
  WeeklyPhase,
  WorkoutTemplate,
} from "@/lib/types";
import { clamp, roundToIncrement } from "@/lib/utils";

const nonDeloadRepStyles = ["5x10", "4x10", "4x8", "3x8", "5x5", "3x5", "3x3", "3x3"];
const nonDeloadLabels = ["初期", "初期", "中期", "中期", "冲刺期", "冲刺期", "极限期", "极限期"];
const cycleSlots: PlanCalendarSlot[] = ["A", "B", "C", "rest"];

function buildWeeklyPhases(durationWeeks: number, startingIntensityPct: number): WeeklyPhase[] {
  const baseIntensity = clamp(startingIntensityPct / 100, 0.45, 0.9);
  let progressiveIndex = 0;

  return Array.from({ length: durationWeeks }, (_, index) => {
    const week = index + 1;
    const isDeload = week % 5 === 0;
    if (isDeload) {
      const previousIntensity =
        progressiveIndex > 0 ? clamp(baseIntensity + (progressiveIndex - 1) * 0.025, 0.45, 0.92) : baseIntensity;
      return {
        week,
        label: "减载周",
        intensity: clamp(previousIntensity - 0.1, 0.45, 0.85),
        repStyle: "3x8",
        notes: "训练量和负重回撤，优先恢复和动作质量。",
      };
    }

    const intensity = clamp(baseIntensity + progressiveIndex * 0.025, 0.45, 0.92);
    const repStyle = nonDeloadRepStyles[Math.min(progressiveIndex, nonDeloadRepStyles.length - 1)];
    const label = nonDeloadLabels[Math.min(progressiveIndex, nonDeloadLabels.length - 1)];
    progressiveIndex += 1;

    return {
      week,
      label,
      intensity,
      repStyle,
      notes: week === 1 ? "线性周期起始周，先建立容量基准。" : "按周推进负重，完成后再进入下一档。",
    };
  });
}

function buildCalendarEntries(startDate: string, durationWeeks: number): PlanCalendarEntry[] {
  const totalDays = durationWeeks * 7;

  return Array.from({ length: totalDays }, (_, index) => {
    const date = addDays(new Date(startDate), index);
    const week = Math.floor(index / 7) + 1;
    const dayIndex = (index % 7) + 1;
    const slot = cycleSlots[index % cycleSlots.length];
    const suffix = slot === "rest" ? "休" : slot;

    return {
      date: date.toISOString().slice(0, 10),
      week,
      dayIndex,
      slot,
      label: `W${week}D${dayIndex}${suffix}`,
    };
  });
}

function parseRepStyle(repStyle: string) {
  const match = /^(\d+)x(\d+)$/.exec(repStyle);
  if (!match) {
    return { sets: 4, reps: "8" };
  }

  return {
    sets: Number(match[1]),
    reps: match[2],
  };
}

function inferOneRepMaxKg(exercise: ExerciseTemplate, oneRepMaxes: Record<string, number>) {
  if (exercise.oneRepMaxKg && exercise.oneRepMaxKg > 0) {
    return exercise.oneRepMaxKg;
  }

  if (exercise.oneRepMaxRef && oneRepMaxes[exercise.oneRepMaxRef]) {
    return oneRepMaxes[exercise.oneRepMaxRef];
  }

  if (exercise.baseWeightKg && exercise.baseWeightKg > 0) {
    return roundToIncrement(exercise.baseWeightKg * 1.35, exercise.incrementKg || 2.5);
  }

  return undefined;
}

function buildGeneratedExercise(
  exercise: ExerciseTemplate,
  dayCode: WorkoutTemplate["dayCode"],
  oneRepMaxes: Record<string, number>,
  firstWeek: WeeklyPhase,
  startingIntensityPct: number,
  index: number,
): ExerciseTemplate {
  const oneRepMaxKg = inferOneRepMaxKg(exercise, oneRepMaxes);
  const adaptiveScheme = parseRepStyle(firstWeek.repStyle);
  const incrementKg = exercise.incrementKg || 2.5;
  const percentageOf1RM = exercise.percentageOf1RM ?? 1;
  const generatedBaseWeight =
    oneRepMaxKg && oneRepMaxKg > 0
      ? roundToIncrement(oneRepMaxKg * (startingIntensityPct / 100) * percentageOf1RM, incrementKg)
      : undefined;

  return {
    ...exercise,
    name: exercise.name || `${dayCode} 日动作 ${index + 1}`,
    focus: exercise.focus || `${dayCode} 日主线动作`,
    sets: adaptiveScheme.sets,
    reps: adaptiveScheme.reps,
    restSeconds: exercise.restSeconds || 90,
    cues: exercise.cues.length ? exercise.cues : ["保持动作标准", "完整控制离心", "不要为加重破坏轨迹"],
    baseWeightKg: generatedBaseWeight,
    oneRepMaxKg,
    progressionModel: "percentage",
    percentageOf1RM,
    incrementKg,
    substitutions: exercise.substitutions ?? [],
    phaseAdaptive: true,
    category: exercise.category || "compound",
  };
}

function buildGeneratedTemplates(input: PlanSetupInput, weeklyPhases: WeeklyPhase[]): WorkoutTemplate[] {
  const firstWeek = weeklyPhases[0] ?? {
    week: 1,
    label: "初期",
    intensity: 0.7,
    repStyle: "5x10",
    notes: "线性推进起始周。",
  };

  return input.templates.map((template) => ({
    ...template,
    exercises: template.exercises.map((exercise, index) =>
      buildGeneratedExercise(
        exercise,
        template.dayCode,
        input.profile.oneRepMaxes,
        firstWeek,
        input.plan.startingIntensityPct,
        index,
      ),
    ),
  }));
}

export function normalizePlanSetupInput(input: PlanSetupInput): PlanSetupInput {
  const durationWeeks = input.plan.durationWeeks ?? input.plan.progressionRule.weeklyPhases.length ?? 8;
  const startingIntensityPct =
    input.plan.startingIntensityPct ?? Math.round((input.plan.progressionRule.weeklyPhases[0]?.intensity ?? 0.7) * 100);
  const weeklyPhases = buildWeeklyPhases(durationWeeks, startingIntensityPct);
  const expectedCalendarLength = durationWeeks * 7;
  const calendarEntries =
    input.plan.calendarEntries?.length === expectedCalendarLength
      ? input.plan.calendarEntries
      : buildCalendarEntries(input.plan.startDate, durationWeeks);
  const nextInput: PlanSetupInput = {
    ...input,
    profile: {
      ...input.profile,
      updatedAt: input.profile.updatedAt,
    },
    plan: {
      ...input.plan,
      goal: input.plan.goal || `${input.profile.currentWeightKg}kg -> ${input.profile.targetWeightKg}kg ${input.plan.phase}`,
      durationWeeks,
      startingIntensityPct,
      schedulePattern: input.plan.schedulePattern ?? "3on1off",
      calendarEntries,
      progressionRule: {
        ...input.plan.progressionRule,
        weeklyPhases,
      },
    },
  };

  return {
    ...nextInput,
    templates: nextInput.templates.map((template) => ({
      ...template,
      exercises: template.exercises.map((exercise) => ({
        ...exercise,
        oneRepMaxKg: inferOneRepMaxKg(exercise, nextInput.profile.oneRepMaxes),
      })),
    })),
  };
}

export function regenerateLinearPlan(input: PlanSetupInput): PlanSetupInput {
  const normalized = normalizePlanSetupInput(input);
  const weeklyPhases = normalized.plan.progressionRule.weeklyPhases;
  const calendarEntries = buildCalendarEntries(normalized.plan.startDate, normalized.plan.durationWeeks);
  const templates = buildGeneratedTemplates(normalized, weeklyPhases);

  return {
    ...normalized,
    plan: {
      ...normalized.plan,
      goal: `${normalized.profile.currentWeightKg}kg -> ${normalized.profile.targetWeightKg}kg ${normalized.plan.phase === "lean_bulk" ? "Lean Bulk" : normalized.plan.phase}`,
      calendarEntries,
      progressionRule: {
        ...normalized.plan.progressionRule,
        weeklyPhases,
      },
    },
    templates,
  };
}
