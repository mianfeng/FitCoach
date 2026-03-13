export type DayCode = "A" | "B" | "C";
export type PlanPhase = "lean_bulk" | "cut" | "maintenance";
export type KnowledgeBasisType = "knowledge" | "history" | "inference";
export type ProposalScope = "day" | "week" | "cycle";
export type ProposalStatus = "pending" | "approved" | "rejected";
export type ReportAdherence = 1 | 2 | 3 | 4 | 5;
export type SchedulePattern = "3on1off";
export type PlanCalendarSlot = DayCode | "rest";
export type PostWorkoutSource = "dedicated" | "lunch" | "dinner";
export type MealAdherenceStatus = "on_plan" | "adjusted" | "missed";
export type TrainingReadiness = "push" | "hold" | "deload";

export interface CoachPersona {
  id: string;
  name: string;
  voice: string;
  mission: string;
  corePrinciples: string[];
}

export interface UserProfile {
  id: string;
  name: string;
  currentWeightKg: number;
  targetWeightKg: number;
  primaryGoal: string;
  dietaryPreferences: string[];
  restrictions: string[];
  wakeWindow: string;
  sleepTargetHours: number;
  oneRepMaxes: Record<string, number>;
  updatedAt: string;
}

export interface WeeklyPhase {
  week: number;
  label: string;
  intensity: number;
  repStyle: string;
  notes: string;
}

export interface ProgressionRule {
  type: "linear";
  daySequence: DayCode[];
  weeklyPhases: WeeklyPhase[];
  defaultIncrementsKg: Record<string, number>;
}

export interface PlanCalendarEntry {
  date: string;
  week: number;
  dayIndex: number;
  slot: PlanCalendarSlot;
  label: string;
}

export interface DeloadRule {
  consecutiveHighFatigueDays: number;
  lowSleepThreshold: number;
  fixedWeek?: number;
}

export interface MealStrategy {
  trainingCarbsPerKg: number;
  restCarbsPerKg: number;
  proteinPerKg: number;
  fatsPerKg: number;
  mealSplit: number[];
  trainingExamples: string[];
  restExamples: string[];
}

export interface ManualOverrides {
  carbModifierPerKg?: number;
  recoveryMode?: "standard" | "deload";
}

export interface LongTermPlan {
  id: string;
  goal: string;
  phase: PlanPhase;
  startDate: string;
  durationWeeks: number;
  startingIntensityPct: number;
  schedulePattern: SchedulePattern;
  calendarEntries: PlanCalendarEntry[];
  planRevisionId: string;
  splitType: "PPL";
  progressionRule: ProgressionRule;
  deloadRule: DeloadRule;
  mealStrategy: MealStrategy;
  note: string;
  manualOverrides?: ManualOverrides;
}

export interface ExerciseTemplate {
  id: string;
  name: string;
  category: "compound" | "accessory" | "core";
  focus: string;
  sets: number;
  reps: string;
  restSeconds: number;
  cues: string[];
  baseWeightKg?: number;
  oneRepMaxKg?: number;
  usesBodyweight?: boolean;
  oneRepMaxRef?: string;
  progressionModel: "percentage" | "fixed";
  percentageOf1RM?: number;
  incrementKg: number;
  substitutions: string[];
  phaseAdaptive?: boolean;
}

export interface WorkoutTemplate {
  id: string;
  dayCode: DayCode;
  name: string;
  objective: string;
  warmup: string[];
  exercises: ExerciseTemplate[];
}

export interface DailyBriefRequest {
  date: string;
  userQuestion: string;
  optionalConstraints?: string;
}

export interface WorkoutPrescriptionExercise {
  name: string;
  focus: string;
  sets: number;
  reps: string;
  suggestedWeightKg?: number;
  restSeconds: number;
  cues: string[];
  reasoning: string;
}

export interface WorkoutPrescription {
  dayCode: DayCode;
  title: string;
  objective: string;
  warmup: string[];
  exercises: WorkoutPrescriptionExercise[];
  caution: string[];
}

export interface MealBlock {
  label: string;
  sharePercent: number;
  examples: string[];
}

export interface MealPrescription {
  dayType: "training" | "rest";
  macros: {
    carbsG: number;
    proteinG: number;
    fatsG: number;
  };
  meals: MealBlock[];
  guidance: string[];
}

export interface DailyBrief {
  id: string;
  date: string;
  scheduledDay?: DayCode;
  calendarLabel: string;
  calendarSlot: PlanCalendarSlot;
  isRestDay: boolean;
  workoutPrescription: WorkoutPrescription;
  mealPrescription: MealPrescription;
  reasoningSummary: string[];
  sourceSnapshotId: string;
  userQuestion: string;
  optionalConstraints?: string;
  createdAt: string;
  reused?: boolean;
}

export interface PlanSnapshot {
  id: string;
  date: string;
  label: string;
  scheduledDay: PlanCalendarSlot;
  workoutPrescription: WorkoutPrescription;
  mealPrescription: MealPrescription;
  planRevisionId: string;
  createdAt: string;
}

export interface ExerciseResult {
  exerciseName: string;
  performed?: boolean;
  targetSets: number;
  targetReps: string;
  actualSets: number;
  actualReps: string;
  topSetWeightKg?: number;
  rpe: number;
  droppedSets: boolean;
  notes?: string;
}

export interface MealLog {
  breakfast: MealLogEntry;
  lunch: MealLogEntry;
  dinner: MealLogEntry;
  preWorkout: MealLogEntry;
  postWorkout: MealLogEntry;
  postWorkoutSource: PostWorkoutSource;
}

export interface MealLogEntry {
  content: string;
  adherence: MealAdherenceStatus;
  deviationNote?: string;
}

export interface NextDayDecision {
  trainingReadiness: TrainingReadiness;
  nutritionFocus: string;
  recoveryFocus: string;
  priorityNotes: string[];
}

export interface SessionReport {
  id: string;
  reportVersion: 1 | 2;
  date: string;
  performedDay: PlanCalendarSlot;
  exerciseResults?: ExerciseResult[];
  bodyWeightKg: number;
  sleepHours: number;
  dietAdherence?: ReportAdherence;
  fatigue: number;
  mealLog?: MealLog;
  trainingReportText?: string;
  dailyReviewMarkdown?: string;
  painNotes?: string;
  recoveryNote?: string;
  completed: boolean;
  summary?: string;
  nextDayDecision?: NextDayDecision;
  createdAt: string;
}

export interface ProposalPatch {
  note?: string;
  manualOverrides?: ManualOverrides;
  mealStrategy?: Partial<MealStrategy>;
}

export interface PlanAdjustmentProposal {
  id: string;
  triggerReason: string;
  scope: ProposalScope;
  before: ProposalPatch;
  after: ProposalPatch;
  requiresUserApproval: boolean;
  status: ProposalStatus;
  rationale: string;
  createdAt: string;
}

export interface MemorySummary {
  id: string;
  period: "daily" | "weekly";
  date: string;
  summary: string;
  signals: string[];
  createdAt: string;
}

export interface KnowledgeDoc {
  id: string;
  title: string;
  sourcePath: string;
  markdown: string;
  importedAt: string;
}

export interface KnowledgeChunk {
  id: string;
  docId: string;
  title: string;
  content: string;
  anchor: string;
  tags: string[];
}

export interface KnowledgeBasis {
  type: KnowledgeBasisType;
  label: string;
  excerpt: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  basis: KnowledgeBasis[];
}

export interface ChatContextBundle {
  persona: CoachPersona;
  activeGoal: string;
  activePlanSummary: string;
  recentReportSummary: string;
  retrievedKnowledge: KnowledgeChunk[];
  recentMessages: ChatMessage[];
}

export interface ChatResponse {
  answer: string;
  basis: KnowledgeBasis[];
  contextSummary: string;
}

export interface PlanSetupInput {
  profile: UserProfile;
  persona: CoachPersona;
  plan: LongTermPlan;
  templates: WorkoutTemplate[];
}

export interface KnowledgeImportResult {
  importedDocs: number;
  importedChunks: number;
}

export interface DashboardSnapshot {
  profile: UserProfile;
  persona: CoachPersona;
  plan: LongTermPlan;
  templates: WorkoutTemplate[];
  recentBrief: DailyBrief | null;
  recentReports: SessionReport[];
  proposals: PlanAdjustmentProposal[];
  summaries: MemorySummary[];
  chatMessages: ChatMessage[];
}
