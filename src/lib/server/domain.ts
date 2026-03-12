import "server-only";

import { differenceInCalendarDays, subDays } from "date-fns";

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
  UserProfile,
  WorkoutPrescription,
  WorkoutPrescriptionExercise,
  WorkoutTemplate,
} from "@/lib/types";
import { average, clamp, isoToday, roundToIncrement, uid } from "@/lib/utils";

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

  const offsetDays = Math.max(0, differenceInCalendarDays(new Date(date), new Date(plan.startDate)));
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
  const offsetDays = Math.max(0, differenceInCalendarDays(new Date(date), new Date(plan.startDate)));
  const weekIndex = Math.min(weeks.length - 1, Math.floor(offsetDays / 7));
  return weeks[weekIndex];
}

export function getNextScheduledDay(plan: LongTermPlan, reports: SessionReport[]) {
  const completedReports = sortReportsDesc(reports).filter((report) => report.completed);
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
    const result = report.exerciseResults.find((item) => item.exerciseName === exerciseName && isExercisePerformed(item));
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
  const [breakfast, lunch, preworkout, postworkout] = plan.mealStrategy.mealSplit;

  return {
    dayType: mode,
    macros,
    meals: [
      { label: "早餐", sharePercent: breakfast, examples: exampleSet.slice(0, 2) },
      { label: "其他餐", sharePercent: lunch, examples: exampleSet.slice(1, 3) },
      { label: "练前餐", sharePercent: preworkout, examples: ["馒头", "面包", "香蕉", "快碳饮料"] },
      { label: "练后餐", sharePercent: postworkout, examples: ["米饭", "瘦肉", "牛奶", "高碳主食"] },
    ],
    guidance: [
      mode === "training"
        ? "训练日碳水跟着训练走，优先保证练前后窗口。"
        : "休息日整体碳水下调 0.5-1 g/kg，保持蛋白稳定。",
      "若晚饭后训练，可把晚饭视为练前餐，夜宵视为练后餐。",
      plan.manualOverrides?.recoveryMode === "deload"
        ? "当前处于恢复模式，饮食不需要再额外压低。"
        : "保持 2242 分配，避免随机加餐导致摄入漂移。",
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
    existingBrief.calendarLabel === calendarEntry.label
  ) {
    return {
      brief: {
        ...existingBrief,
        scheduledDay: fallbackScheduledDay,
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
      sourceSnapshotId: uid("snapshot"),
      userQuestion: request.userQuestion,
      optionalConstraints: request.optionalConstraints,
      createdAt: new Date().toISOString(),
    },
    reused: false,
  };
}

function averageReportRpe(report: SessionReport) {
  return average(report.exerciseResults.map((item) => item.rpe));
}

function summarizeExerciseOutcome(report: SessionReport) {
  const completedCount = report.exerciseResults.filter((item) => isExercisePerformed(item)).length;
  return `${completedCount}/${report.exerciseResults.length} 个动作完成度稳定`;
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
      userQuestion: "自动生成今日执行清单",
    },
    profile,
    plan,
    templates,
    reports,
    null,
  ).brief;
}

export function buildDailyBriefFromSnapshot(snapshot: PlanSnapshot): DailyBrief {
  return {
    id: snapshot.id,
    date: snapshot.date,
    scheduledDay: snapshot.scheduledDay === "rest" ? undefined : snapshot.scheduledDay,
    calendarLabel: snapshot.label,
    calendarSlot: snapshot.scheduledDay,
    isRestDay: snapshot.scheduledDay === "rest",
    workoutPrescription: snapshot.workoutPrescription,
    mealPrescription: snapshot.mealPrescription,
    reasoningSummary:
      snapshot.scheduledDay === "rest"
        ? ["该日期是历史休息日快照。"]
        : [`历史计划快照：${snapshot.label}`],
    sourceSnapshotId: snapshot.id,
    userQuestion: "history-snapshot",
    createdAt: snapshot.createdAt,
  };
}

export function buildSessionSummary(
  report: SessionReport,
  recentReports: SessionReport[],
  plan: LongTermPlan,
) {
  const recent = sortReportsDesc([report, ...recentReports]);
  const highStressWindow = recent.slice(0, plan.deloadRule.consecutiveHighFatigueDays);
  const averageRpe = averageReportRpe(report);
  const signals: string[] = [
    `睡眠 ${report.sleepHours}h`,
    `疲劳 ${report.fatigue}/10`,
    `饮食达标 ${report.dietAdherence}/5`,
    summarizeExerciseOutcome(report),
  ];

  let summary = `${report.performedDay} 日已记录。`;
  if (report.completed) {
    summary += averageRpe >= 9 ? " 本次训练强度偏高。" : " 主项推进仍在可控区间。";
  } else {
    summary += " 本次未完整执行，下一次建议不要加重。";
  }

  const proposals: PlanAdjustmentProposal[] = [];
  const highStressCount = highStressWindow.filter(
    (item) =>
      item.fatigue >= 8 ||
      item.sleepHours < plan.deloadRule.lowSleepThreshold ||
      averageReportRpe(item) >= 9.2,
  ).length;

  if (highStressCount >= plan.deloadRule.consecutiveHighFatigueDays) {
    proposals.push({
      id: uid("proposal"),
      triggerReason: "连续高疲劳 / 低睡眠",
      scope: "week",
      before: {
        note: "当前保持标准推进",
        manualOverrides: plan.manualOverrides,
      },
      after: {
        note: "建议下一次训练进入 deload",
        manualOverrides: {
          ...plan.manualOverrides,
          recoveryMode: "deload",
        },
      },
      requiresUserApproval: true,
      status: "pending",
      rationale: "最近几次训练恢复指标持续偏差，先保住动作质量和恢复。",
      createdAt: new Date().toISOString(),
    });
  }

  const fourteenDaysAgo = subDays(new Date(report.date), 14);
  const trendWindow = recent
    .filter((item) => new Date(item.date) >= fourteenDaysAgo)
    .sort((left, right) => left.date.localeCompare(right.date));

  if (trendWindow.length >= 3) {
    const delta = trendWindow.at(-1)!.bodyWeightKg - trendWindow[0].bodyWeightKg;
    if (plan.phase === "lean_bulk" && delta < 0.2) {
      proposals.push({
        id: uid("proposal"),
        triggerReason: "增肌体重增长偏慢",
        scope: "cycle",
        before: {
          note: "当前训练日碳水正常",
          mealStrategy: {
            trainingCarbsPerKg: plan.mealStrategy.trainingCarbsPerKg,
          },
        },
        after: {
          note: "建议训练日碳水 +0.5 g/kg",
          manualOverrides: {
            ...plan.manualOverrides,
            carbModifierPerKg: clamp((plan.manualOverrides?.carbModifierPerKg ?? 0) + 0.5, -1, 2),
          },
        },
        requiresUserApproval: true,
        status: "pending",
        rationale: "近两周体重上涨不足，优先通过碳水微调而不是盲目加训练量。",
        createdAt: new Date().toISOString(),
      });
    }

    if (plan.phase === "lean_bulk" && delta > 1.2) {
      proposals.push({
        id: uid("proposal"),
        triggerReason: "增肌体重增长过快",
        scope: "cycle",
        before: {
          note: "当前训练日碳水正常",
          mealStrategy: {
            trainingCarbsPerKg: plan.mealStrategy.trainingCarbsPerKg,
          },
        },
        after: {
          note: "建议训练日碳水 -0.5 g/kg",
          manualOverrides: {
            ...plan.manualOverrides,
            carbModifierPerKg: clamp((plan.manualOverrides?.carbModifierPerKg ?? 0) - 0.5, -1, 2),
          },
        },
        requiresUserApproval: true,
        status: "pending",
        rationale: "体重上涨过快时先削减碳水，尽量控制脂肪增长。",
        createdAt: new Date().toISOString(),
      });
    }
  }

  const memorySummary: MemorySummary = {
    id: uid("summary"),
    period: "daily",
    date: report.date,
    summary,
    signals,
    createdAt: new Date().toISOString(),
  };

  return { summary, signals, memorySummary, proposals };
}

export function buildRecentReportSummary(reports: SessionReport[]) {
  if (!reports.length) {
    return "暂无历史汇报，默认按长期计划首日执行。";
  }

  const latest = sortReportsDesc(reports).slice(0, 3);
  const weightTrend = latest.map((item) => `${item.date} ${item.bodyWeightKg}kg`).join(" / ");
  const fatigueTrend = latest.map((item) => item.fatigue).join(" -> ");

  return `最近 ${latest.length} 次记录体重为 ${weightTrend}；疲劳趋势 ${fatigueTrend}；最新训练日 ${latest[0].performedDay}。`;
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

  return {
    persona,
    activeGoal: plan.goal,
    activePlanSummary: `当前阶段 ${weeklyPhase.label}，今日顺位 ${getNextScheduledDay(plan, reports)}，恢复模式 ${
      plan.manualOverrides?.recoveryMode ?? "standard"
    }。`,
    recentReportSummary: buildRecentReportSummary(reports),
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
    "首页会根据正式计划自动生成今天的训练与饮食看板，你只需要在执行后回填结果。",
    basis.length ? `本次回答依据：${basis.map((item) => item.label).join(" / ")}` : "本次回答主要基于当前计划推断。",
  ].join("\n\n");
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
        label: `${report.date} ${report.performedDay} 日`,
        excerpt: `体重 ${report.bodyWeightKg}kg，睡眠 ${report.sleepHours}h，疲劳 ${report.fatigue}/10`,
      }) satisfies KnowledgeBasis,
  );
}

export function createReportDraftFromBrief(brief: DailyBrief) {
  return {
    date: isoToday(),
    performedDay: brief.scheduledDay ?? "A",
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
        }) satisfies ExerciseResult,
    ),
    bodyWeightKg: 60,
    sleepHours: 7.5,
    dietAdherence: 4 as const,
    fatigue: 5,
    completed: true,
  };
}
