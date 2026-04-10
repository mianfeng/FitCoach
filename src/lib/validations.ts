import { z } from "zod";

const dayCodeSchema = z.enum(["A", "B", "C"]);
const performedDaySchema = z.union([dayCodeSchema, z.literal("rest")]);
const schedulePatternSchema = z.literal("3on1off");
const postWorkoutSourceSchema = z.enum(["dedicated", "lunch", "dinner"]);
const mealAdherenceSchema = z.enum(["on_plan", "adjusted", "missed"]);
const planCalendarSlotSchema = z.union([dayCodeSchema, z.literal("rest")]);
const mealCookingMethodSchema = z.enum([
  "poached_steamed",
  "stir_fry_light",
  "stir_fry_normal",
  "stir_fry_heavy",
  "grill_pan_sear",
  "deep_fry",
]);

const mealEntrySchema = z.object({
  content: z.string(),
  adherence: mealAdherenceSchema,
  deviationNote: z.string().optional(),
  cookingMethod: mealCookingMethodSchema.optional(),
  rinseOil: z.boolean().optional(),
});

export const dailyBriefRequestSchema = z.object({
  date: z.string().min(1),
  userQuestion: z.string().min(2),
  optionalConstraints: z.string().optional(),
});

export const planSetupSchema = z.object({
  profile: z.object({
    id: z.string(),
    name: z.string().min(1),
    currentWeightKg: z.number().positive(),
    targetWeightKg: z.number().positive(),
    primaryGoal: z.string().min(1),
    dietaryPreferences: z.array(z.string()),
    restrictions: z.array(z.string()),
    wakeWindow: z.string().min(1),
    sleepTargetHours: z.number().min(4).max(12),
    oneRepMaxes: z.record(z.string(), z.number().nonnegative()),
    updatedAt: z.string(),
  }),
  persona: z.object({
    id: z.string(),
    name: z.string().min(1),
    voice: z.string().min(1),
    mission: z.string().min(1),
    corePrinciples: z.array(z.string()).min(1),
  }),
  plan: z.object({
    id: z.string(),
    goal: z.string().min(1),
    phase: z.enum(["lean_bulk", "cut", "maintenance"]),
    startDate: z.string(),
    durationWeeks: z.number().min(1).max(52).optional(),
    startingIntensityPct: z.number().min(1).max(100).optional(),
    schedulePattern: schedulePatternSchema.optional(),
    planRevisionId: z.string().optional(),
    calendarEntries: z
      .array(
        z.object({
          date: z.string(),
          week: z.number().min(1),
          dayIndex: z.number().min(1).max(7),
          slot: planCalendarSlotSchema,
          label: z.string().min(1),
        }),
      )
      .optional(),
    splitType: z.literal("PPL"),
    progressionRule: z.object({
      type: z.literal("linear"),
      daySequence: z.array(dayCodeSchema).length(3),
      weeklyPhases: z.array(
        z.object({
          week: z.number(),
          label: z.string(),
          intensity: z.number(),
          repStyle: z.string(),
          notes: z.string(),
        }),
      ),
      defaultIncrementsKg: z.record(z.string(), z.number()),
    }),
    deloadRule: z.object({
      consecutiveHighFatigueDays: z.number().min(1).max(7),
      lowSleepThreshold: z.number().min(3).max(10),
      fixedWeek: z.number().optional(),
    }),
    mealStrategy: z.object({
      trainingCarbsPerKg: z.number().min(0),
      restCarbsPerKg: z.number().min(0),
      proteinPerKg: z.number().min(0),
      fatsPerKg: z.number().min(0),
      mealSplit: z.array(z.number()).length(4),
      trainingExamples: z.array(z.string()),
      restExamples: z.array(z.string()),
    }),
    note: z.string(),
    manualOverrides: z
      .object({
        carbModifierPerKg: z.number().optional(),
        recoveryMode: z.enum(["standard", "deload"]).optional(),
      })
      .optional(),
  }),
  templates: z.array(
    z.object({
      id: z.string(),
      dayCode: dayCodeSchema,
      name: z.string(),
      objective: z.string(),
      warmup: z.array(z.string()),
      exercises: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          category: z.enum(["compound", "accessory", "core"]),
          focus: z.string(),
          sets: z.number().min(1),
          reps: z.string(),
          restSeconds: z.number().min(15),
          cues: z.array(z.string()),
          baseWeightKg: z.number().optional(),
          oneRepMaxKg: z.number().positive().optional(),
          usesBodyweight: z.boolean().optional(),
          oneRepMaxRef: z.string().optional(),
          progressionModel: z.enum(["percentage", "fixed"]),
          percentageOf1RM: z.number().optional(),
          incrementKg: z.number().min(0),
          substitutions: z.array(z.string()),
          phaseAdaptive: z.boolean().optional(),
        }),
      ),
    }),
  ),
});

const nutritionMacrosSchema = z
  .object({
    proteinG: z.number().min(0),
    carbsG: z.number().min(0),
    fatsG: z.number().min(0),
  })
  .refine((value) => value.proteinG + value.carbsG + value.fatsG > 0, {
    message: "至少填写一个大于 0 的宏量营养素。",
  });

export const nutritionDishSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1),
  aliases: z.array(z.string()).default([]),
  macros: nutritionMacrosSchema,
});

export const chatRequestSchema = z.object({
  message: z.string().min(2),
});

export const approvePlanAdjustmentSchema = z.object({
  id: z.string().min(1),
});

export const exerciseResultSchema = z.object({
  exerciseName: z.string().min(1),
  performed: z.boolean().optional().default(true),
  targetSets: z.number().min(1),
  targetReps: z.string().min(1),
  actualSets: z.number().min(0),
  actualReps: z.string().min(1),
  topSetWeightKg: z.number().optional(),
  rpe: z.number().min(1).max(10),
  droppedSets: z.boolean(),
  notes: z.string().optional(),
});

export const mealLogSchema = z.object({
  breakfast: mealEntrySchema,
  lunch: mealEntrySchema,
  dinner: mealEntrySchema,
  preWorkout: mealEntrySchema,
  postWorkout: mealEntrySchema,
  postWorkoutSource: postWorkoutSourceSchema,
});

export const legacyMealLogSchema = z.object({
  breakfast: z.string(),
  lunch: z.string(),
  dinner: z.string(),
  preWorkout: z.string(),
  postWorkout: z.string(),
  postWorkoutSource: postWorkoutSourceSchema,
});

const nextDayDecisionSchema = z.object({
  trainingReadiness: z.enum(["push", "hold", "deload"]),
  nutritionFocus: z.string().min(1),
  recoveryFocus: z.string().min(1),
  priorityNotes: z.array(z.string()).min(1),
});

const sessionReportBaseSchema = z.object({
  date: z.string().min(1),
  scheduledDate: z.string().min(1).optional(),
  performedDay: performedDaySchema,
  exerciseResults: z.array(exerciseResultSchema).optional(),
  bodyWeightKg: z.number().positive(),
  sleepHours: z.number().min(0).max(24),
  dietAdherence: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
  ]).optional(),
  fatigue: z.number().min(1).max(10),
  trainingReportText: z.string().default(""),
  dailyReviewMarkdown: z.string().optional(),
  painNotes: z.string().optional(),
  recoveryNote: z.string().optional(),
  completed: z.boolean(),
});

const sessionReportV2Schema = sessionReportBaseSchema.extend({
  reportVersion: z.literal(2).optional().default(2),
  mealLog: mealLogSchema.optional(),
  nextDayDecision: nextDayDecisionSchema.optional(),
});

const sessionReportV1Schema = sessionReportBaseSchema.extend({
  reportVersion: z.literal(1).optional(),
  mealLog: legacyMealLogSchema.optional(),
});

export const sessionReportSchema = z
  .union([sessionReportV2Schema, sessionReportV1Schema])
  .superRefine((value, ctx) => {
    if (value.completed && value.performedDay !== "rest" && (!value.exerciseResults || value.exerciseResults.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["exerciseResults"],
        message: "训练日必须提交动作执行记录。",
      });
    }
  });

export const trainingRescheduleSchema = z
  .object({
    sourceDate: z.string().min(1),
    targetDate: z.string().min(1),
    note: z.string().trim().max(200).optional(),
  })
  .refine((value) => value.sourceDate !== value.targetDate, {
    path: ["targetDate"],
    message: "目标日期不能和原日期相同。",
  });

export const trainingRescheduleUpdateSchema = z.object({
  id: z.string().min(1),
  targetDate: z.string().min(1),
  note: z.string().trim().max(200).optional(),
});

export const trainingRescheduleDeleteSchema = z.object({
  id: z.string().min(1),
});
