import { addDays } from "date-fns";

import type {
  ExerciseTemplate,
  MealPrescription,
  PlanSnapshot,
  PlanCalendarEntry,
  PlanSetupInput,
  PlanCalendarSlot,
  WeeklyPhase,
  WorkoutTemplate,
} from "@/lib/types";
import { applyCurrentTemplateLayout } from "@/lib/template-layout";
import { clamp, roundToIncrement, uid } from "@/lib/utils";

const nonDeloadRepStyles = ["5x10", "4x10", "4x8", "3x8", "5x5", "3x5", "3x3", "3x3"];
const nonDeloadLabels = ["初期", "初期", "中期", "中期", "冲刺期", "冲刺期", "极限期", "极限期"];
const cycleSlots: PlanCalendarSlot[] = ["A", "B", "C", "rest"];

function buildMealBlocks(
  mode: "training" | "rest",
  examples: string[],
  mealSplit: number[],
): MealPrescription["meals"] {
  if (mode === "rest") {
    return [
      { label: "早餐", sharePercent: 20, examples: examples.slice(0, 2) },
      { label: "午餐", sharePercent: 50, examples: examples.slice(1, 3) },
      { label: "晚餐", sharePercent: 30, examples: [examples[0], ...examples.slice(2, 4)].filter(Boolean) },
    ];
  }

  const [breakfast, lunch, preworkout, postworkout] = mealSplit;
  return [
    { label: "早餐", sharePercent: breakfast, examples: examples.slice(0, 2) },
    { label: "其他餐", sharePercent: lunch, examples: examples.slice(1, 3) },
    { label: "练前餐", sharePercent: preworkout, examples: ["馒头", "面包", "香蕉", "快碳饮料"] },
    { label: "练后餐", sharePercent: postworkout, examples: ["米饭", "瘦肉", "牛奶", "高碳主食"] },
  ];
}

function buildSnapshotMealPrescription(input: PlanSetupInput, mode: "training" | "rest"): MealPrescription {
  const carbModifier = input.plan.manualOverrides?.carbModifierPerKg ?? 0;
  const carbsPerKg =
    mode === "training"
      ? input.plan.mealStrategy.trainingCarbsPerKg + carbModifier
      : input.plan.mealStrategy.restCarbsPerKg + carbModifier;

  const macros = {
    carbsG: Math.round(input.profile.currentWeightKg * carbsPerKg),
    proteinG: Math.round(input.profile.currentWeightKg * input.plan.mealStrategy.proteinPerKg),
    fatsG: Math.round(input.profile.currentWeightKg * input.plan.mealStrategy.fatsPerKg),
  };

  const examples = mode === "training" ? input.plan.mealStrategy.trainingExamples : input.plan.mealStrategy.restExamples;

  return {
    dayType: mode,
    macros,
    meals: buildMealBlocks(mode, examples, input.plan.mealStrategy.mealSplit),
    guidance: [
      mode === "training" ? "训练日碳水跟着训练走。" : "休息日保持蛋白稳定、碳水略低。",
      "晚饭后训练时，可把晚饭视为练前餐。",
      input.plan.manualOverrides?.recoveryMode === "deload"
        ? "当前为恢复模式。"
        : mode === "training"
          ? "按训练日 2242 分配稳定执行。"
          : "按休息日 253 分配稳定执行。",
    ],
  };
}

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
  if (exercise.usesBodyweight) {
    return undefined;
  }

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
    !exercise.usesBodyweight && oneRepMaxKg && oneRepMaxKg > 0
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
    usesBodyweight: exercise.usesBodyweight ?? false,
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
      planRevisionId: input.plan.planRevisionId ?? uid("planrev"),
      calendarEntries,
      progressionRule: {
        ...input.plan.progressionRule,
        weeklyPhases,
      },
    },
  };

  return {
    ...nextInput,
    templates: applyCurrentTemplateLayout(
      nextInput.templates.map((template) => ({
        ...template,
        exercises: template.exercises.map((exercise) => ({
          ...exercise,
          oneRepMaxKg: inferOneRepMaxKg(exercise, nextInput.profile.oneRepMaxes),
        })),
      })),
    ).map((template) => ({
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

export function buildPlanSnapshots(input: PlanSetupInput): PlanSnapshot[] {
  const normalized = normalizePlanSetupInput(input);
  const templatesByDay = new Map(normalized.templates.map((template) => [template.dayCode, template]));

  return normalized.plan.calendarEntries.map((entry) => {
    const weeklyPhase = normalized.plan.progressionRule.weeklyPhases[Math.max(0, entry.week - 1)];
    const template = entry.slot === "rest" ? null : templatesByDay.get(entry.slot);
    const mealPrescription = buildSnapshotMealPrescription(normalized, entry.slot === "rest" ? "rest" : "training");

    return {
      id: uid("snapshot"),
      date: entry.date,
      label: entry.label,
      scheduledDay: entry.slot,
      workoutPrescription: {
        dayCode: entry.slot === "rest" ? "A" : entry.slot,
        title: entry.slot === "rest" ? "恢复 / 休息日" : template?.name ?? `${entry.slot} 日训练`,
        objective:
          entry.slot === "rest"
            ? "按休息日处理，优先恢复、活动和饮食执行。"
            : template?.objective ?? `${entry.slot} 日标准训练`,
        warmup: entry.slot === "rest" ? ["轻量活动 10 分钟", "拉伸 10 分钟"] : template?.warmup ?? [],
        exercises:
          entry.slot === "rest"
            ? []
            : (template?.exercises ?? []).map((exercise) => ({
                name: exercise.name,
                focus: exercise.focus,
                sets: exercise.sets,
                reps: exercise.reps,
                suggestedWeightKg: exercise.usesBodyweight ? undefined : exercise.baseWeightKg,
                restSeconds: exercise.restSeconds,
                cues: exercise.cues,
                reasoning: weeklyPhase
                  ? `按 ${weeklyPhase.label} 周期安排，首轮工作重量基于保存时的正式计划。`
                  : "按正式计划快照生成。",
              })),
        caution:
          entry.slot === "rest"
            ? ["休息日不安排主项训练，优先恢复。"]
            : weeklyPhase
              ? [`当前快照对应第 ${weeklyPhase.week} 周 ${weeklyPhase.label}。`]
              : ["正式计划快照。"],
      },
      mealPrescription,
      planRevisionId: normalized.plan.planRevisionId,
      createdAt: new Date().toISOString(),
    } satisfies PlanSnapshot;
  });
}
