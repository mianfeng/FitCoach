import "server-only";

import type {
  ChatContextBundle,
  ChatMessage,
  DailyBrief,
  DailyBriefRequest,
  ExerciseResult,
  ExerciseTemplate,
  KnowledgeBasis,
  KnowledgeChunk,
  LongTermPlan,
  MealPrescription,
  MemorySummary,
  PlanCalendarEntry,
  PlanCalendarSlot,
  PlanSnapshot,
  PlanAdjustmentProposal,
  SessionReport,
  TrainingReschedule,
  UserProfile,
  WorkoutPrescription,
  WorkoutPrescriptionExercise,
  WorkoutTemplate,
} from "@/lib/types";
import {
  countFilledMealSlots,
  createEmptyMealLog,
  normalizeMealLog,
  resolvePostWorkoutEntry,
  summarizeMealAdherence,
} from "@/lib/session-report";
import { average, diffIsoDays, isoToday, roundToIncrement, uid } from "@/lib/utils";

function sortReportsDesc(reports: SessionReport[]) {
  return [...reports].sort((left, right) => right.date.localeCompare(left.date));
}

function parseRepStyle(repStyle: string) {
  const match = /^(\d+)x(\d+)$/.exec(repStyle);
  if (!match) {
    return null;
  }

  return {
    sets: Number(match[1]),
    reps: match[2],
  };
}

const calendarCycle: PlanCalendarSlot[] = ["A", "B", "C", "rest"];

function resolveCalendarEntry(plan: LongTermPlan, date: string): PlanCalendarEntry {
  const matched = plan.calendarEntries.find((entry) => entry.date === date);
  if (matched) {
    return matched;
  }

  const offsetDays = Math.max(0, diffIsoDays(date, plan.startDate));
  const week = Math.floor(offsetDays / 7) + 1;
  const dayIndex = (offsetDays % 7) + 1;
  const slot = calendarCycle[offsetDays % calendarCycle.length];

  return {
    date,
    week,
    dayIndex,
    slot,
    label: `W${week}D${dayIndex}${slot === "rest" ? "休" : slot}`,
  };
}

export function getCurrentWeeklyPhase(plan: LongTermPlan, date: string) {
  const weeks = plan.progressionRule.weeklyPhases;
  const offsetDays = Math.max(0, diffIsoDays(date, plan.startDate));
  const weekIndex = Math.min(weeks.length - 1, Math.floor(offsetDays / 7));
  return weeks[weekIndex];
}

export function getNextScheduledDay(plan: LongTermPlan, reports: SessionReport[]) {
  const completedReports = sortReportsDesc(reports).filter(
    (report): report is SessionReport & { performedDay: WorkoutTemplate["dayCode"] } =>
      report.completed && report.performedDay !== "rest",
  );
  if (!completedReports.length) {
    return plan.progressionRule.daySequence[0];
  }

  const lastDay = completedReports[0].performedDay;
  const order = plan.progressionRule.daySequence;
  const index = order.indexOf(lastDay);
  return order[(index + 1) % order.length];
}

function getExerciseTemplate(dayCode: string, templates: WorkoutTemplate[]) {
  return templates.find((template) => template.dayCode === dayCode);
}

function isExercisePerformed(result: ExerciseResult) {
  return result.performed !== false;
}

function getLatestExerciseResult(reports: SessionReport[], exerciseName: string) {
  for (const report of sortReportsDesc(reports)) {
    const result = (report.exerciseResults ?? []).find(
      (item) => item.exerciseName === exerciseName && isExercisePerformed(item),
    );
    if (result) {
      return result;
    }
  }

  return null;
}

function resolveAdaptiveScheme(exercise: ExerciseTemplate, phaseRepStyle: string) {
  if (!exercise.phaseAdaptive) {
    return { sets: exercise.sets, reps: exercise.reps };
  }

  const parsed = parseRepStyle(phaseRepStyle);
  if (!parsed) {
    return { sets: exercise.sets, reps: exercise.reps };
  }

  return parsed;
}

function suggestExerciseWeight(
  exercise: ExerciseTemplate,
  profile: UserProfile,
  phaseIntensity: number,
  reports: SessionReport[],
) {
  let suggested = exercise.baseWeightKg;

  if (exercise.progressionModel === "percentage") {
    const oneRepMax = exercise.oneRepMaxKg ?? (exercise.oneRepMaxRef ? profile.oneRepMaxes[exercise.oneRepMaxRef] : undefined);
    if (oneRepMax) {
      const percentage = exercise.percentageOf1RM ?? 1;
      suggested = roundToIncrement(oneRepMax * phaseIntensity * percentage, exercise.incrementKg || 2.5);
    }
  }

  const latest = getLatestExerciseResult(reports, exercise.name);
  if (!latest?.topSetWeightKg) {
    return suggested;
  }

  if (latest.droppedSets || latest.rpe >= 9.3) {
    return Math.max(exercise.incrementKg, latest.topSetWeightKg - exercise.incrementKg);
  }

  if (latest.rpe <= 8.5 && latest.actualSets >= latest.targetSets) {
    return Math.max(suggested ?? 0, latest.topSetWeightKg + exercise.incrementKg);
  }

  return latest.topSetWeightKg;
}

function buildWorkoutExercise(
  exercise: ExerciseTemplate,
  profile: UserProfile,
  phaseIntensity: number,
  phaseRepStyle: string,
  reports: SessionReport[],
) {
  const adaptiveScheme = resolveAdaptiveScheme(exercise, phaseRepStyle);
  const suggestedWeightKg = suggestExerciseWeight(exercise, profile, phaseIntensity, reports);

  const reasoning: string[] = [];
  if (exercise.progressionModel === "percentage" && (exercise.oneRepMaxKg || exercise.oneRepMaxRef)) {
    reasoning.push(`按当前阶段强度 ${Math.round(phaseIntensity * 100)}% 推算`);
  }
  const latest = getLatestExerciseResult(reports, exercise.name);
  if (latest?.topSetWeightKg) {
    reasoning.push(
      latest.droppedSets || latest.rpe >= 9.3
        ? "上次训练偏吃力，本次建议保守一点"
        : "结合上次完成度，做小幅线性推进",
    );
  } else {
    reasoning.push("首次处方按计划基准重量起步");
  }

  return {
    name: exercise.name,
    focus: exercise.focus,
    sets: adaptiveScheme.sets,
    reps: adaptiveScheme.reps,
    suggestedWeightKg,
    restSeconds: exercise.restSeconds,
    cues: exercise.cues,
    reasoning: reasoning.join("；"),
  } satisfies WorkoutPrescriptionExercise;
}

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

export function buildMealPrescription(
  profile: UserProfile,
  plan: LongTermPlan,
  mode: "training" | "rest",
): MealPrescription {
  const carbModifier = plan.manualOverrides?.carbModifierPerKg ?? 0;
  const carbsPerKg =
    mode === "training"
      ? plan.mealStrategy.trainingCarbsPerKg + carbModifier
      : plan.mealStrategy.restCarbsPerKg + carbModifier;

  const macros = {
    carbsG: Math.round(profile.currentWeightKg * carbsPerKg),
    proteinG: Math.round(profile.currentWeightKg * plan.mealStrategy.proteinPerKg),
    fatsG: Math.round(profile.currentWeightKg * plan.mealStrategy.fatsPerKg),
  };

  const exampleSet =
    mode === "training" ? plan.mealStrategy.trainingExamples : plan.mealStrategy.restExamples;

  return {
    dayType: mode,
    macros,
    meals: buildMealBlocks(mode, exampleSet, plan.mealStrategy.mealSplit),
    guidance: [
      mode === "training"
        ? "训练日碳水跟着训练走，优先保证练前后窗口。"
        : "休息日整体碳水下调 0.5-1 g/kg，保持蛋白稳定。",
      "若晚饭后训练，可把晚饭视为练前餐，夜宵视为练后餐。",
      plan.manualOverrides?.recoveryMode === "deload"
        ? "当前处于恢复模式，饮食不需要再额外压低。"
        : mode === "training"
          ? "保持 2242 分配，避免随机加餐导致摄入漂移。"
          : "保持 253 分配，避免把休息日吃成训练日节奏。",
    ],
  };
}

export function buildDailyBrief(
  request: DailyBriefRequest,
  profile: UserProfile,
  plan: LongTermPlan,
  templates: WorkoutTemplate[],
  reports: SessionReport[],
  existingBrief: DailyBrief | null,
) {
  const calendarEntry = resolveCalendarEntry(plan, request.date);
  const fallbackScheduledDay = calendarEntry.slot === "rest" ? undefined : calendarEntry.slot;

  if (
    existingBrief &&
    existingBrief.calendarSlot === calendarEntry.slot &&
    existingBrief.calendarLabel === calendarEntry.label &&
    existingBrief.planRevisionId === plan.planRevisionId
  ) {
    return {
      brief: {
        ...existingBrief,
        scheduledDay: fallbackScheduledDay,
        scheduledDate: request.date,
        calendarLabel: calendarEntry.label,
        calendarSlot: calendarEntry.slot,
        isRestDay: calendarEntry.slot === "rest",
        reused: true,
      },
      reused: true,
    };
  }

  const scheduledDay = fallbackScheduledDay;
  const weeklyPhase = getCurrentWeeklyPhase(plan, request.date);
  const applicableReports = reports.filter((report) => report.date < request.date);
  const template = scheduledDay ? getExerciseTemplate(scheduledDay, templates) : null;
  if (scheduledDay && !template) {
    throw new Error(`Missing workout template for ${scheduledDay}`);
  }

  const isRestDay = calendarEntry.slot === "rest";
  const workoutPrescription: WorkoutPrescription = {
    dayCode: scheduledDay ?? "A",
    title: isRestDay ? "恢复 / 休息日" : template!.name,
    objective: isRestDay ? "今天按休息日处理，优先恢复、活动和饮食执行。" : template!.objective,
    warmup: isRestDay ? ["10 分钟散步", "肩髋灵活性 10 分钟", "早点睡"] : template!.warmup,
    exercises: isRestDay
      ? []
      : template!.exercises.map((exercise) =>
          buildWorkoutExercise(exercise, profile, weeklyPhase.intensity, weeklyPhase.repStyle, applicableReports),
        ),
    caution: [
      `当前日期对应 ${calendarEntry.label}，阶段为第 ${weeklyPhase.week} 周 ${weeklyPhase.label}。`,
      plan.manualOverrides?.recoveryMode === "deload"
        ? "恢复模式开启：主项负重下调、RPE 控制在 7 左右。"
        : "主项执行时优先动作标准，不要为了加重破坏轨迹。",
      isRestDay ? "今天是休息日，不安排训练汇报。" : "训练结束后尽快回填执行结果。",
    ],
  };

  const mealPrescription = buildMealPrescription(profile, plan, isRestDay ? "rest" : "training");

  return {
    brief: {
      id: uid("brief"),
      date: request.date,
      scheduledDate: request.date,
      scheduledDay,
      calendarLabel: calendarEntry.label,
      calendarSlot: calendarEntry.slot,
      isRestDay,
      workoutPrescription,
      mealPrescription,
      reasoningSummary: [
        `Today 页面严格跟随日历日期，当前标签是 ${calendarEntry.label}。`,
        `本周强度采用 ${Math.round(weeklyPhase.intensity * 100)}% 区间，组次风格为 ${weeklyPhase.repStyle}。`,
        isRestDay ? "休息日只显示恢复与饮食，不生成训练动作。" : "训练日动作和饮食都按该日期槽位生成。",
      ],
      planRevisionId: plan.planRevisionId,
      sourceSnapshotId: uid("snapshot"),
      userQuestion: request.userQuestion,
      optionalConstraints: request.optionalConstraints,
      createdAt: new Date().toISOString(),
    },
    reused: false,
  };
}

export function buildDailyBriefFromSnapshot(snapshot: PlanSnapshot): DailyBrief {
  return {
    id: uid("brief"),
    date: snapshot.date,
    scheduledDate: snapshot.date,
    scheduledDay: snapshot.scheduledDay === "rest" ? undefined : snapshot.scheduledDay,
    calendarLabel: snapshot.label,
    calendarSlot: snapshot.scheduledDay,
    isRestDay: snapshot.scheduledDay === "rest",
    workoutPrescription: snapshot.workoutPrescription,
    mealPrescription: snapshot.mealPrescription,
    reasoningSummary: ["由历史计划快照直接回放，不重新生成当日处方。"],
    planRevisionId: snapshot.planRevisionId,
    sourceSnapshotId: snapshot.id,
    userQuestion: "",
    createdAt: new Date().toISOString(),
    reused: true,
  };
}

export function buildTodayAutofillBrief(
  date: string,
  profile: UserProfile,
  plan: LongTermPlan,
  templates: WorkoutTemplate[],
  reports: SessionReport[],
) {
  return buildDailyBrief(
    {
      date,
      userQuestion: "",
    },
    profile,
    plan,
    templates,
    reports,
    null,
  ).brief;
}

function averageReportRpe(report: SessionReport) {
  return average((report.exerciseResults ?? []).map((item) => item.rpe));
}

function countDroppedSets(report: SessionReport) {
  return (report.exerciseResults ?? []).filter((item) => item.droppedSets).length;
}

function getPerformedExerciseCount(report: SessionReport) {
  return (report.exerciseResults ?? []).filter((item) => isExercisePerformed(item)).length;
}

export function describeMealExecution(report: SessionReport) {
  const mealLog = normalizeMealLog(report.mealLog);
  if (!mealLog) {
    return "餐次记录待补充";
  }

  const adherence = summarizeMealAdherence(mealLog);
  const filledCount = countFilledMealSlots(mealLog);
  return `五餐记录 ${filledCount}/5，按计划 ${adherence.onPlan} 餐，调整 ${adherence.adjusted} 餐，缺失 ${adherence.missed} 餐`;
}

export function describeTrainingReadiness(
  trainingReadiness: NonNullable<SessionReport["nextDayDecision"]>["trainingReadiness"],
) {
  if (trainingReadiness === "push") {
    return "可继续推进";
  }
  if (trainingReadiness === "hold") {
    return "维持当前负荷";
  }
  return "进入减载";
}

function buildLatestReportSummary(report: SessionReport | null | undefined) {
  if (!report) {
    return "今天还没有可分析的日报记录。";
  }

  const mealLog = normalizeMealLog(report.mealLog);
  const mealSummary = summarizeMealAdherence(mealLog);
  const filledMealCount = countFilledMealSlots(mealLog);
  const performedCount = getPerformedExerciseCount(report);
  const totalExerciseCount = report.exerciseResults?.length ?? 0;
  const averageRpe = averageReportRpe(report);
  const droppedSetCount = countDroppedSets(report);

  return [
    `${report.date}${report.completed ? " 已完成" : " 草稿"}，${report.performedDay === "rest" ? "休息日" : `${report.performedDay} 日`}。`,
    `恢复数据：体重 ${report.bodyWeightKg} kg，睡眠 ${report.sleepHours} h，疲劳 ${report.fatigue}/10。`,
    `饮食记录：${describeMealExecution({ ...report, mealLog })}。`,
    report.performedDay === "rest"
      ? "训练记录：今天是休息日，没有训练动作需要完成。"
      : `训练记录：动作完成 ${performedCount}/${totalExerciseCount}，平均 RPE ${averageRpe.toFixed(1)}，掉组 ${droppedSetCount} 次。`,
    report.trainingReportText?.trim() ? `主观备注：${report.trainingReportText}` : "主观备注：暂无额外训练备注。",
    filledMealCount < 5 || mealSummary.missed > 0
      ? "注意：今天的饮食记录还不完整，判断时要把缺失餐次算进不确定性。"
      : "注意：今天的饮食记录相对完整，可以直接基于现有数据判断执行质量。",
  ].join(" ");
}

function buildGapText(delta: number, label: string, unit: string) {
  const normalizedDelta = Math.round(delta * 10) / 10;
  const absDelta = Math.abs(normalizedDelta);
  const suffix = unit ? ` ${unit}` : "";

  if (absDelta < 0.1) {
    return `${label}基本达标`;
  }

  return normalizedDelta > 0 ? `${label}超出 ${absDelta}${suffix}` : `${label}还差 ${absDelta}${suffix}`;
}

function getDeviationRatio(gap: number, target: number) {
  if (target <= 0) {
    return 0;
  }

  return Math.abs(gap / target);
}

function getNutritionDeviationSummary(nutritionGap: SessionReport["nutritionGap"], targetNutrition: {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatsG: number;
}) {
  if (!nutritionGap) {
    return null;
  }

  const calories = getDeviationRatio(nutritionGap.calories, targetNutrition.calories);
  const proteinG = getDeviationRatio(nutritionGap.proteinG, targetNutrition.proteinG);
  const carbsG = getDeviationRatio(nutritionGap.carbsG, targetNutrition.carbsG);
  const fatsG = getDeviationRatio(nutritionGap.fatsG, targetNutrition.fatsG);
  const averageMacro = average([proteinG, carbsG, fatsG]);

  return {
    calories,
    proteinG,
    carbsG,
    fatsG,
    averageMacro,
    moderateCount: [calories, proteinG, carbsG, fatsG].filter((value) => value >= 0.15).length,
    majorCount: [calories, proteinG, carbsG, fatsG].filter((value) => value >= 0.3).length,
  };
}

export function rebaseDailyBriefToDate(brief: DailyBrief, displayDate: string, reschedule: TrainingReschedule): DailyBrief {
  return {
    ...brief,
    id: uid("brief"),
    date: displayDate,
    scheduledDate: reschedule.sourceDate,
    rescheduledFromDate: reschedule.sourceDate,
    rescheduledToDate: reschedule.targetDate,
    reasoningSummary: [
      `该训练原定于 ${reschedule.sourceDate}，已调整到 ${reschedule.targetDate} 执行。`,
      ...brief.reasoningSummary,
    ],
    createdAt: new Date().toISOString(),
  };
}

export function buildRescheduledOutBrief(params: {
  date: string;
  targetDate: string;
  profile: UserProfile;
  plan: LongTermPlan;
}) {
  const { date, targetDate, profile, plan } = params;
  const calendarEntry = resolveCalendarEntry(plan, date);

  return {
    id: uid("brief"),
    date,
    scheduledDate: date,
    scheduledDay: undefined,
    calendarLabel: calendarEntry.label,
    calendarSlot: "rest" as const,
    isRestDay: true,
    rescheduledToDate: targetDate,
    workoutPrescription: {
      dayCode: "A" as const,
      title: "训练已顺延",
      objective: `这一天的训练已顺延到 ${targetDate}，今天按恢复日处理。`,
      warmup: ["20 分钟轻活动", "肩髋灵活性 10 分钟", "早点睡"],
      exercises: [],
      caution: [
        `${calendarEntry.label} 原定训练已改到 ${targetDate}。`,
        "今天不需要填写训练动作，优先恢复、补水和规律饮食。",
      ],
    },
    mealPrescription: buildMealPrescription(profile, plan, "rest"),
    reasoningSummary: [
      `该日期原定训练已顺延到 ${targetDate}。`,
      "为了避免同一天显示两套训练，当前页面切换为恢复日视图。",
    ],
    planRevisionId: plan.planRevisionId,
    sourceSnapshotId: uid("snapshot"),
    userQuestion: "",
    createdAt: new Date().toISOString(),
  } satisfies DailyBrief;
}

function resolveDailyReviewRating(params: {
  report: SessionReport;
  mealSummary: ReturnType<typeof summarizeMealAdherence>;
  nextDayDecision: NonNullable<SessionReport["nextDayDecision"]>;
  deviationSummary: ReturnType<typeof getNutritionDeviationSummary>;
}) {
  const { report, mealSummary, nextDayDecision, deviationSummary } = params;
  const averageRpeValue = averageReportRpe(report);
  const droppedSetCount = countDroppedSets(report);
  const highStress = report.fatigue >= 9 || droppedSetCount >= 2 || averageRpeValue >= 9.2;
  const moderateStress =
    report.fatigue >= 7 || droppedSetCount >= 1 || averageRpeValue >= 8.7 || nextDayDecision.trainingReadiness === "hold";
  const severeNutritionDrift =
    deviationSummary != null &&
    (deviationSummary.majorCount >= 2 ||
      deviationSummary.averageMacro >= 0.28 ||
      deviationSummary.proteinG >= 0.3 ||
      (deviationSummary.calories >= 0.3 && deviationSummary.proteinG >= 0.2));
  const moderateNutritionDrift =
    deviationSummary != null &&
    (deviationSummary.majorCount >= 1 ||
      deviationSummary.moderateCount >= 2 ||
      deviationSummary.averageMacro >= 0.15 ||
      deviationSummary.proteinG >= 0.15);

  if (
    mealSummary.missed >= 3 ||
    (nextDayDecision.trainingReadiness === "deload" && highStress) ||
    (severeNutritionDrift && (mealSummary.missed >= 1 || moderateStress || nextDayDecision.trainingReadiness === "deload"))
  ) {
    return {
      badge: "🔴 灾难",
      reason: "今天出现了多项明显偏离，先把饮食或恢复拉回计划线，再谈推进。",
    };
  }

  if (
    mealSummary.missed >= 1 ||
    moderateStress ||
    nextDayDecision.trainingReadiness === "deload" ||
    moderateNutritionDrift
  ) {
    return {
      badge: "🟡 警告",
      reason: "今天有一到两个关键点需要纠偏，但还没到失控。",
    };
  }

  return {
    badge: "🟢 完美",
    reason: "整体执行仍在可控范围，营养、训练和恢复没有明显偏离。",
  };
}

function buildMealNutritionLine(label: string, estimate?: SessionReport["nutritionTotals"]) {
  return `${label}：${estimate?.calories ?? 0} kcal（P ${estimate?.proteinG ?? 0} / C ${estimate?.carbsG ?? 0} / F ${estimate?.fatsG ?? 0}）`;
}

function buildGapAnalysisLine(
  nutritionGap: NonNullable<SessionReport["nutritionGap"]>,
) {
  return [
    buildGapText(nutritionGap.calories, "总热量", "kcal"),
    buildGapText(nutritionGap.proteinG, "蛋白质", "g"),
    buildGapText(nutritionGap.carbsG, "碳水", "g"),
    buildGapText(nutritionGap.fatsG, "脂肪", "g"),
  ].join("；");
}

function buildStrictActionItems(params: {
  report: SessionReport;
  nextDayDecision: NonNullable<SessionReport["nextDayDecision"]>;
  totalDeviationRatio: number;
}) {
  const { report, nextDayDecision, totalDeviationRatio } = params;
  const mealLog = normalizeMealLog(report.mealLog);
  const mealSummary = summarizeMealAdherence(mealLog);
  const actions: string[] = [];

  if (mealSummary.missed > 0 || totalDeviationRatio > 0.1) {
    actions.push("把剩余餐次补齐，并优先把蛋白和训练前后碳水吃到计划线。");
  }

  if (nextDayDecision.trainingReadiness === "deload") {
    actions.push("下一次主项主动减载，把顶组 RPE 压回 7-8，不要硬顶。");
  } else if (nextDayDecision.trainingReadiness === "hold") {
    actions.push("下一次先稳住动作质量和完成度，本次不要急着加重量。");
  }

  if (report.sleepHours < 7 || report.fatigue >= 7) {
    actions.push("今晚优先保证睡眠和补水，明早再决定是否推进训练。");
  }

  if (!actions.length) {
    actions.push("明天继续按计划执行，维持餐次完整性和训练节奏。");
  }

  return actions.slice(0, 3);
}

export function buildNextDayDecision(
  report: SessionReport,
  plan: LongTermPlan,
): NonNullable<SessionReport["nextDayDecision"]> {
  const averageRpeValue = averageReportRpe(report);
  const droppedSetCount = countDroppedSets(report);
  const mealSummary = summarizeMealAdherence(normalizeMealLog(report.mealLog));

  const highStress =
    report.fatigue >= plan.deloadRule.consecutiveHighFatigueDays ||
    report.sleepHours <= plan.deloadRule.lowSleepThreshold ||
    averageRpeValue >= 9.2 ||
    droppedSetCount >= 2;

  if (highStress) {
    return {
      trainingReadiness: "deload",
      nutritionFocus: "先补齐缺失餐次，优先保证蛋白、训练前后碳水和总热量不要继续掉线。",
      recoveryFocus: "今晚把睡眠、补水和轻度活动放到第一位，让疲劳先退下来。",
      priorityNotes: ["主动减载", "补齐关键餐次", "先恢复再推进"],
    };
  }

  const moderateStress =
    report.fatigue >= 6 || report.sleepHours < 7 || averageRpeValue >= 8.7 || droppedSetCount >= 1 || mealSummary.missed > 0;

  if (moderateStress) {
    return {
      trainingReadiness: "hold",
      nutritionFocus: "先把执行度拉回计划线，尤其是蛋白和训练窗口碳水不要再缺。",
      recoveryFocus: "把睡眠和恢复节奏稳住，再看下一次训练是否推进。",
      priorityNotes: ["稳住动作质量", "补齐餐次", "控制疲劳"],
    };
  }

  return {
    trainingReadiness: "push",
    nutritionFocus: "维持当前餐次节奏，继续把蛋白、碳水和总热量吃满。",
    recoveryFocus: "保持当前睡眠和补水习惯，让恢复继续支撑推进。",
    priorityNotes: ["按计划推进", "保持餐次完整", "继续观察恢复"],
  };
}

export function buildSessionSummary(
  report: SessionReport,
  priorReports: SessionReport[],
  plan: LongTermPlan,
): {
  memorySummary: MemorySummary;
  proposals: PlanAdjustmentProposal[];
} {
  const nextDayDecision = buildNextDayDecision(report, plan);
  const recentWindow = [report, ...priorReports].slice(0, Math.max(3, plan.deloadRule.consecutiveHighFatigueDays));
  const sustainedHighFatigue =
    recentWindow.length >= plan.deloadRule.consecutiveHighFatigueDays &&
    recentWindow
      .slice(0, plan.deloadRule.consecutiveHighFatigueDays)
      .every((item) => item.fatigue >= plan.deloadRule.consecutiveHighFatigueDays);

  const memorySummary: MemorySummary = {
    id: uid("summary"),
    period: "daily",
    date: report.date,
    summary:
      report.performedDay === "rest"
        ? `休息日记录已完成，当前判断为${describeTrainingReadiness(nextDayDecision.trainingReadiness)}。`
        : `完成 ${report.performedDay} 日训练，当前判断为${describeTrainingReadiness(nextDayDecision.trainingReadiness)}。`,
    signals: [
      `体重 ${report.bodyWeightKg}kg`,
      `睡眠 ${report.sleepHours}h`,
      `疲劳 ${report.fatigue}/10`,
      `饮食：${describeMealExecution(report)}`,
    ],
    createdAt: new Date().toISOString(),
  };

  const proposals: PlanAdjustmentProposal[] = [];

  if (sustainedHighFatigue) {
    proposals.push({
      id: uid("proposal"),
      triggerReason: "连续高疲劳，建议进入减载",
      scope: "week",
      before: {
        manualOverrides: {
          recoveryMode: plan.manualOverrides?.recoveryMode,
        },
      },
      after: {
        manualOverrides: {
          ...plan.manualOverrides,
          recoveryMode: "deload",
        },
        note: "连续高疲劳和高压力训练后，建议短期切到减载恢复模式。",
      },
      requiresUserApproval: true,
      status: "pending",
      rationale: "最近连续多次高疲劳/低恢复信号，继续硬推会降低训练质量并抬高受伤风险。",
      createdAt: new Date().toISOString(),
    });
  }

  return {
    memorySummary,
    proposals,
  };
}

export function buildStrictDailyReviewMarkdown(params: {
  report: SessionReport;
  targetMacros: MealPrescription["macros"];
  nextDayDecision?: SessionReport["nextDayDecision"];
}) {
  const { report, targetMacros } = params;
  const targetNutrition = {
    calories: targetMacros.proteinG * 4 + targetMacros.carbsG * 4 + targetMacros.fatsG * 9,
    proteinG: targetMacros.proteinG,
    carbsG: targetMacros.carbsG,
    fatsG: targetMacros.fatsG,
  };
  const normalizedMealLog = normalizeMealLog(report.mealLog);
  const nutritionReady =
    report.nutritionComputation?.status === "ready" && Boolean(report.nutritionTotals) && Boolean(report.nutritionGap);
  const nutritionSummary = nutritionReady
    ? {
        mealLog: normalizedMealLog,
        nutritionTotals: report.nutritionTotals!,
        nutritionGap: report.nutritionGap!,
      }
    : null;
  const nutritionPendingMessage =
    report.nutritionWarnings?.[0]?.trim() || "Nutrition is pending AI computation. Save again later to retry.";
  const nextDayDecision =
    params.nextDayDecision ??
    report.nextDayDecision ?? {
      trainingReadiness: "hold" as const,
      nutritionFocus: "先把饮食执行拉回计划线。",
      recoveryFocus: "先把睡眠和补水稳住。",
      priorityNotes: ["先恢复到基本节奏"],
    };
  const targetKcal = targetNutrition.calories;
  const deviationSummary = nutritionSummary
    ? getNutritionDeviationSummary(nutritionSummary.nutritionGap, targetNutrition)
    : null;
  const totalDeviationRatio = deviationSummary
    ? Math.max(
        deviationSummary.calories,
        deviationSummary.proteinG,
        deviationSummary.carbsG,
        deviationSummary.fatsG,
      )
    : 0;
  const mealSummary = summarizeMealAdherence(normalizedMealLog);

  let overloadStatus = "达标";
  if (nextDayDecision.trainingReadiness === "deload") {
    overloadStatus = "需减载";
  } else if (nextDayDecision.trainingReadiness === "hold" || !report.completed) {
    overloadStatus = "停滞";
  }

  const rating = resolveDailyReviewRating({
    report,
    mealSummary,
    nextDayDecision,
    deviationSummary,
  });

  const trainingComment =
    report.performedDay === "rest"
      ? "今天是休息日，重点看恢复质量和饮食完整度。"
      : `完成 ${getPerformedExerciseCount(report)}/${report.exerciseResults?.length ?? 0} 个动作，平均 RPE ${averageReportRpe(report).toFixed(1)}，掉组 ${countDroppedSets(report)} 次。`;
  const parsedMealLog = nutritionSummary?.mealLog ?? normalizedMealLog;
  const effectivePostWorkout = parsedMealLog ? resolvePostWorkoutEntry(parsedMealLog) : undefined;
  const mealBreakdownLines =
    nutritionSummary && parsedMealLog
      ? [
          buildMealNutritionLine("早餐", parsedMealLog.breakfast.nutritionEstimate),
          buildMealNutritionLine("午餐", parsedMealLog.lunch.nutritionEstimate),
          buildMealNutritionLine("晚餐", parsedMealLog.dinner.nutritionEstimate),
          buildMealNutritionLine("练前", parsedMealLog.preWorkout.nutritionEstimate),
          buildMealNutritionLine("练后", effectivePostWorkout?.nutritionEstimate),
        ]
      : ["营养还在计算中，暂不展示数值拆解。"];
  const dataCheckLines = nutritionSummary
    ? [
        `- 估算摄入：${nutritionSummary.nutritionTotals.calories} kcal / 蛋白质 ${nutritionSummary.nutritionTotals.proteinG} g / 碳水 ${nutritionSummary.nutritionTotals.carbsG} g / 脂肪 ${nutritionSummary.nutritionTotals.fatsG} g`,
        `- 缺口分析：${buildGapAnalysisLine(nutritionSummary.nutritionGap)}`,
        `- 每餐拆解：${mealBreakdownLines.join("；")}`,
      ]
    : [
        "- 估算摄入：营养数据仍在计算中",
        `- 缺口分析：${nutritionPendingMessage}`,
        `- 每餐拆解：${mealBreakdownLines.join("；")}`,
      ];

  const actions = buildStrictActionItems({
    report,
    nextDayDecision,
    totalDeviationRatio,
  });

  return [
    "1. 📊 数据核算",
    "",
    ...dataCheckLines,
    "",
    "2. 🏋️ 训练评估",
    "",
    `- 超负荷状态：${overloadStatus}`,
    `- 简要评价：${trainingComment}`,
    "",
    "3. 🎯 质量评级",
    "",
    `- ${rating.badge}（${rating.reason}）`,
    "",
    "4. ⚡ 行动建议",
    "",
    ...actions.map((item) => `- ${item}`),
  ].join("\n");
}

export function buildRecentReportSummary(reports: SessionReport[]) {
  if (!reports.length) {
    return "暂无历史汇报，默认按当前正式计划执行。";
  }

  const latest = sortReportsDesc(reports).slice(0, 3);
  const weightTrend = latest.map((item) => `${item.date} ${item.bodyWeightKg}kg`).join(" / ");
  const fatigueTrend = latest.map((item) => item.fatigue).join(" -> ");
  const latestTraining = latest
    .map((item) =>
      item.trainingReportText?.trim()
        ? `${item.date}${item.completed ? "" : " 草稿"} ${item.trainingReportText.slice(0, 18)}${item.trainingReportText.length > 18 ? "..." : ""}`
        : `${item.date}${item.completed ? "" : " 草稿"} ${item.performedDay}`,
    )
    .join(" / ");

  return `最近 ${latest.length} 次记录体重为 ${weightTrend}；疲劳趋势 ${fatigueTrend}；最近训练摘要 ${latestTraining}。`;
}

function buildChatReportSummary(reports: SessionReport[]) {
  if (!reports.length) {
    return "最近还没有训练或饮食回填记录，当前只能按计划本身做判断。";
  }

  const latest = sortReportsDesc(reports).slice(0, 3);
  const latestReport = latest[0];
  const weightTrend = latest.map((item) => `${item.date} ${item.bodyWeightKg}kg`).join(" / ");
  const fatigueTrend = latest.map((item) => `${item.date} ${item.fatigue}/10`).join(" / ");

  return [
    `最新记录：${buildLatestReportSummary(latestReport)}`,
    `近 ${latest.length} 次体重趋势：${weightTrend}。`,
    `近 ${latest.length} 次疲劳趋势：${fatigueTrend}。`,
  ].join(" ");
}

export function buildChatContextBundle(params: {
  persona: ChatContextBundle["persona"];
  plan: LongTermPlan;
  reports: SessionReport[];
  retrievedKnowledge: KnowledgeChunk[];
  messages: ChatMessage[];
}) {
  const { persona, plan, reports, retrievedKnowledge, messages } = params;
  const weeklyPhase = getCurrentWeeklyPhase(plan, isoToday());
  const latestReport = sortReportsDesc(reports)[0];
  const currentDate = isoToday();

  return {
    persona,
    activeGoal: plan.goal,
    activePlanSummary: `当前阶段 ${weeklyPhase.label}，今日顺位 ${getNextScheduledDay(plan, reports)}，恢复模式 ${
      plan.manualOverrides?.recoveryMode ?? "standard"
    }。`,
    recentReportSummary: buildChatReportSummary(reports),
    latestReportSummary:
      buildLatestReportSummary(latestReport) +
      (latestReport?.nutritionTotals
        ? ` 营养汇总：${latestReport.nutritionTotals.calories} kcal / 蛋白 ${latestReport.nutritionTotals.proteinG} g / 碳水 ${latestReport.nutritionTotals.carbsG} g / 脂肪 ${latestReport.nutritionTotals.fatsG} g。`
        : ""),
    currentDate,
    latestReportDate: latestReport?.date,
    latestReportIsToday: latestReport?.date === currentDate,
    retrievedKnowledge,
    recentMessages: messages.slice(-6),
  };
}

export function buildFallbackCoachAnswer(
  message: string,
  context: ChatContextBundle,
  basis: KnowledgeBasis[],
) {
  const topic = context.retrievedKnowledge[0];
  const directAnswer = topic
    ? `基于你的资料，最相关的是「${topic.title}」。${topic.content.slice(0, 120)}...`
    : "当前没有检索到直接资料片段，我会优先按你的长期计划和最近记录回答。";

  return [
    `问题：${message}`,
    `当前目标：${context.activeGoal}`,
    `执行背景：${context.activePlanSummary}`,
    directAnswer,
    "首页会根据正式计划自动生成当天的训练与饮食看板，你只需要在执行后回填结果。",
    basis.length ? `本次回答依据：${basis.map((item) => item.label).join(" / ")}` : "本次回答主要基于当前计划推断。",
  ].join("\n\n");
}

export function buildNaturalFallbackCoachAnswer(
  message: string,
  context: ChatContextBundle,
  basis: KnowledgeBasis[],
) {
  const topic = context.retrievedKnowledge[0];
  const basisLabels = basis.map((item) => item.label).join(" / ");
  const opening = topic
    ? `先说结论：和你这个问题最相关的参考是「${topic.title}」，先抓住它的核心意思就够了，${topic.content.slice(0, 100)}...`
    : "先说结论：当前没有命中特别直接的资料片段，我会先按你的目标、近期执行和训练逻辑给你一个相对稳妥的判断。";

  return [
    opening,
    `你这次问的是：${message}`,
    `我先看的背景是你的当前目标“${context.activeGoal}”和执行情况“${context.activePlanSummary}”。真正落地时，我不会只照着手册复述，而是更看重恢复、训练刺激、饮食执行和最近几天的主观反馈能不能对上。`,
    basis.length
      ? `这次回答主要参考了：${basisLabels}。如果证据不够硬，我会把它当成推断，不会包装成绝对结论。`
      : "这次回答主要基于你当前计划和最近记录做推断，不把它当成绝对结论。",
    "如果你想继续往下拆，我更建议你直接追问动作替换、容量安排、疲劳管理或者饮食策略，我可以顺着训练逻辑把理由讲透。",
  ].join("\n\n");
}

export function buildStructuredCoachFallbackAnswer(
  message: string,
  context: ChatContextBundle,
  basis: KnowledgeBasis[],
) {
  const basisLabels = basis.length ? basis.map((item) => item.label).join(" / ") : "当前计划与最近记录";
  const reportSourceLine = context.latestReportDate
    ? context.latestReportIsToday
      ? `我现在依据的是今天（${context.currentDate}）的最新记录。`
      : `我现在没有 ${context.currentDate} 的完整记录，最近一次可用记录是 ${context.latestReportDate}。`
    : `我现在没有 ${context.currentDate} 的日报记录，只能按当前计划和历史趋势判断。`;

  return [
    "1. 结论",
    "",
    "- 先按你现有记录做判断，再决定是否调整；如果你问的是今天的执行质量，优先以最新一条实际日报为准，而不是空谈理论。",
    "",
    "2. 分析依据",
    "",
    `- 我优先看的不是泛化建议，而是目标匹配度、营养或训练结构、疲劳成本、可执行性和长期收益。当前主要依据：${basisLabels}。`,
    "",
    "3. 结合我的情况",
    "",
    `- ${reportSourceLine} 当前目标是 ${context.activeGoal}，执行背景是：${context.activePlanSummary}。最近可直接引用的数据是：${context.latestReportSummary}`,
    "",
    "4. 实际建议",
    "",
    message.includes("饮食") || message.includes("吃")
      ? "- 先看已记录餐次的总热量和宏量是否到位，再看缺口主要卡在蛋白、碳水还是总热量；如果当天还没记全，就先补齐剩余餐次再下最终结论。"
      : "- 如果你是在问今天训练做得怎么样，就先把当天剩余动作或备注补齐，我会直接按已记录数据给结论。",
    "- 如果你是在比较两个选择，就把候选项直接发给我，我按你当前体重、目标、训练体系和器械条件给你二选一。",
    "",
    "5. 延伸提醒",
    "",
    "- 最容易出错的是把“最近一次记录”当成“今天已经完成的记录”。如果日期不是今天，判断就只能算参考，不能算当天定论。",
  ].join("\n");
}

export function buildKnowledgeBasisFromChunks(chunks: KnowledgeChunk[]) {
  return chunks.slice(0, 3).map(
    (chunk) =>
      ({
        type: "knowledge",
        label: chunk.title,
        excerpt: chunk.content.slice(0, 110),
      }) satisfies KnowledgeBasis,
  );
}

export function buildHistoryBasis(reports: SessionReport[]) {
  if (!reports.length) {
    return [] as KnowledgeBasis[];
  }

  const latest = sortReportsDesc(reports).slice(0, 2);
  return latest.map(
    (report) =>
      ({
        type: "history",
        label: `${report.date} ${report.performedDay === "rest" ? "休息日" : `${report.performedDay} 日`}`,
        excerpt: report.trainingReportText?.trim()
          ? `${report.completed ? "" : "草稿："}${report.trainingReportText.slice(0, 80)}`
          : `体重 ${report.bodyWeightKg}kg，睡眠 ${report.sleepHours}h，疲劳 ${report.fatigue}/10`,
      }) satisfies KnowledgeBasis,
  );
}

export function createReportDraftFromBrief(brief: DailyBrief) {
  return {
    reportVersion: 2 as const,
    date: isoToday(),
    performedDay: brief.calendarSlot,
    mealLog: createEmptyMealLog(),
    trainingReportText: "",
    exerciseResults: brief.isRestDay
      ? []
      : brief.workoutPrescription.exercises.map(
          (exercise) =>
            ({
              exerciseName: exercise.name,
              performed: false,
              targetSets: exercise.sets,
              targetReps: exercise.reps,
              actualSets: 0,
              actualReps: exercise.reps,
              topSetWeightKg: undefined,
              rpe: 8,
              droppedSets: false,
            }) satisfies ExerciseResult,
        ),
    bodyWeightKg: 60,
    sleepHours: 7.5,
    fatigue: 5,
    completed: false,
  };
}


