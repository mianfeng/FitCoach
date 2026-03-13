import { clamp } from "@/lib/utils";
import type {
  MealAdherenceStatus,
  MealLog,
  MealLogEntry,
  PostWorkoutSource,
  ReportAdherence,
  SessionReport,
} from "@/lib/types";

type LegacyMealLog = {
  breakfast?: string;
  lunch?: string;
  dinner?: string;
  preWorkout?: string;
  postWorkout?: string;
  postWorkoutSource?: PostWorkoutSource;
};

type MaybeStructuredMealLog = MealLog | LegacyMealLog | null | undefined;

export const mealSlotOrder = ["breakfast", "lunch", "dinner", "preWorkout", "postWorkout"] as const;

export type MealSlot = (typeof mealSlotOrder)[number];

export const mealSlotLabels: Record<MealSlot, string> = {
  breakfast: "早餐",
  lunch: "午餐",
  dinner: "晚餐",
  preWorkout: "练前餐",
  postWorkout: "练后餐",
};

export const mealAdherenceLabels: Record<MealAdherenceStatus, string> = {
  on_plan: "按计划",
  adjusted: "有调整",
  missed: "缺失",
};

export function createEmptyMealEntry(): MealLogEntry {
  return {
    content: "",
    adherence: "on_plan",
    deviationNote: "",
  };
}

export function createEmptyMealLog(): MealLog {
  return {
    breakfast: createEmptyMealEntry(),
    lunch: createEmptyMealEntry(),
    dinner: createEmptyMealEntry(),
    preWorkout: createEmptyMealEntry(),
    postWorkout: createEmptyMealEntry(),
    postWorkoutSource: "dedicated",
  };
}

export function isStructuredMealEntry(value: unknown): value is MealLogEntry {
  if (!value || typeof value !== "object") {
    return false;
  }

  return (
    "content" in value &&
    "adherence" in value &&
    typeof (value as MealLogEntry).content === "string" &&
    ["on_plan", "adjusted", "missed"].includes((value as MealLogEntry).adherence)
  );
}

function toStructuredEntry(value: string | undefined) {
  const content = value?.trim() ?? "";
  return {
    content,
    adherence: content ? "adjusted" : "missed",
    deviationNote: "",
  } satisfies MealLogEntry;
}

function normalizeMealEntry(value: MealLogEntry | string | undefined) {
  if (isStructuredMealEntry(value)) {
    return {
      content: value.content ?? "",
      adherence: value.adherence,
      deviationNote: value.deviationNote ?? "",
    } satisfies MealLogEntry;
  }

  return toStructuredEntry(value);
}

export function normalizeMealLog(input: MaybeStructuredMealLog): MealLog | undefined {
  if (!input) {
    return undefined;
  }

  return {
    breakfast: normalizeMealEntry(input.breakfast),
    lunch: normalizeMealEntry(input.lunch),
    dinner: normalizeMealEntry(input.dinner),
    preWorkout: normalizeMealEntry(input.preWorkout),
    postWorkout: normalizeMealEntry(input.postWorkout),
    postWorkoutSource: input.postWorkoutSource ?? "dedicated",
  };
}

export function buildMealLogForSubmit(mealLog: MealLog): MealLog {
  if (mealLog.postWorkoutSource === "dedicated") {
    return mealLog;
  }

  const mirrored =
    mealLog.postWorkoutSource === "lunch"
      ? mealLog.lunch
      : mealLog.postWorkoutSource === "dinner"
        ? mealLog.dinner
        : mealLog.postWorkout;

  return {
    ...mealLog,
    postWorkout: {
      content: mirrored.content,
      adherence: mirrored.adherence,
      deviationNote:
        mirrored.deviationNote?.trim() || `${mealSlotLabels[mealLog.postWorkoutSource]}兼作练后餐`,
    },
  };
}

export function resolvePostWorkoutEntry(mealLog: MealLog) {
  if (mealLog.postWorkoutSource === "dedicated") {
    return mealLog.postWorkout;
  }

  return mealLog.postWorkoutSource === "lunch" ? mealLog.lunch : mealLog.dinner;
}

export function countFilledMealSlots(mealLog?: MealLog) {
  if (!mealLog) {
    return 0;
  }

  return mealSlotOrder.filter((slot) => {
    const entry = slot === "postWorkout" ? resolvePostWorkoutEntry(mealLog) : mealLog[slot];
    return entry.content.trim().length > 0 || entry.adherence === "missed";
  }).length;
}

export function summarizeMealAdherence(mealLog?: MealLog) {
  const summary = {
    onPlan: 0,
    adjusted: 0,
    missed: 0,
  };

  if (!mealLog) {
    return summary;
  }

  for (const slot of mealSlotOrder) {
    const entry = slot === "postWorkout" ? resolvePostWorkoutEntry(mealLog) : mealLog[slot];
    if (entry.adherence === "on_plan") {
      summary.onPlan += 1;
      continue;
    }
    if (entry.adherence === "adjusted") {
      summary.adjusted += 1;
      continue;
    }
    summary.missed += 1;
  }

  return summary;
}

export function deriveDietAdherence(mealLog?: MealLog): ReportAdherence | undefined {
  if (!mealLog) {
    return undefined;
  }

  const weights: Record<MealAdherenceStatus, number> = {
    on_plan: 1,
    adjusted: 0.6,
    missed: 0,
  };

  const entries = mealSlotOrder.map((slot) => (slot === "postWorkout" ? resolvePostWorkoutEntry(mealLog) : mealLog[slot]));
  const score = entries.reduce((sum, entry) => {
    const completenessPenalty = entry.content.trim().length > 0 || entry.adherence === "missed" ? 1 : 0.4;
    return sum + weights[entry.adherence] * completenessPenalty;
  }, 0);

  return Math.round(clamp((score / entries.length) * 4 + 1, 1, 5)) as ReportAdherence;
}

export function isStructuredSessionReport(report: SessionReport) {
  return report.reportVersion === 2 || Boolean(report.nextDayDecision) || isStructuredMealEntry(report.mealLog?.breakfast);
}

export function normalizeStoredSessionReport(report: Omit<SessionReport, "mealLog" | "reportVersion"> & {
  mealLog?: MaybeStructuredMealLog;
  reportVersion?: 1 | 2;
}): SessionReport {
  const mealLog = normalizeMealLog(report.mealLog);
  const inferredVersion =
    report.reportVersion ?? (isStructuredMealEntry(report.mealLog?.breakfast) || report.nextDayDecision ? 2 : 1);

  return {
    ...report,
    reportVersion: inferredVersion,
    mealLog,
    trainingReportText: report.trainingReportText ?? "",
    dietAdherence: report.dietAdherence ?? deriveDietAdherence(mealLog),
    nextDayDecision: report.nextDayDecision
      ? {
          trainingReadiness: report.nextDayDecision.trainingReadiness,
          nutritionFocus: report.nextDayDecision.nutritionFocus,
          recoveryFocus: report.nextDayDecision.recoveryFocus,
          priorityNotes: report.nextDayDecision.priorityNotes ?? [],
        }
      : undefined,
  };
}
