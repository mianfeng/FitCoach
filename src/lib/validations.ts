import { z } from "zod";

const dayCodeSchema = z.enum(["A", "B", "C"]);
const schedulePatternSchema = z.literal("3on1off");

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
    calendarEntries: z
      .array(
        z.object({
          date: z.string(),
          week: z.number().min(1),
          dayIndex: z.number().min(1).max(7),
          slot: z.union([dayCodeSchema, z.literal("rest")]),
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

export const sessionReportSchema = z.object({
  date: z.string().min(1),
  performedDay: dayCodeSchema,
  exerciseResults: z.array(exerciseResultSchema),
  bodyWeightKg: z.number().positive(),
  sleepHours: z.number().min(0).max(24),
  dietAdherence: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
  ]),
  fatigue: z.number().min(1).max(10),
  painNotes: z.string().optional(),
  recoveryNote: z.string().optional(),
  completed: z.boolean(),
});
