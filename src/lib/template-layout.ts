import type { ExerciseTemplate, WorkoutTemplate } from "@/lib/types";

function cloneExercise(exercise: ExerciseTemplate): ExerciseTemplate {
  return {
    ...exercise,
    cues: [...exercise.cues],
    substitutions: [...exercise.substitutions],
  };
}

function cloneExercises(exercises: ExerciseTemplate[]) {
  return exercises.map(cloneExercise);
}

export function applyCurrentTemplateLayout(templates: WorkoutTemplate[]): WorkoutTemplate[] {
  const dayA = templates.find((template) => template.dayCode === "A");
  const dayB = templates.find((template) => template.dayCode === "B");
  const dayC = templates.find((template) => template.dayCode === "C");

  if (!dayA || !dayB || !dayC) {
    return templates;
  }

  const shoulderPress = dayB.exercises.find((exercise) => exercise.name === "哑铃推举");
  const isLegacyLayout =
    dayA.name.includes("/ Pull") &&
    dayA.exercises.some((exercise) => exercise.name === "反手高位下拉") &&
    dayB.name.includes("/ Push") &&
    dayB.exercises.some((exercise) => exercise.name === "杠铃卧推") &&
    shoulderPress != null;

  if (!isLegacyLayout) {
    return templates;
  }

  const migratedDayAExercises = dayB.exercises
    .filter((exercise) => exercise.name !== "哑铃推举")
    .map(cloneExercise);
  const migratedDayCExercises = [
    ...cloneExercises(dayC.exercises.slice(0, 2)),
    cloneExercise(shoulderPress),
    ...cloneExercises(dayC.exercises.slice(2)),
  ];

  return templates.map((template) => {
    if (template.dayCode === "A") {
      return {
        ...template,
        name: "Day A / Push",
        objective: "胸肩增宽主线，主项为卧推。",
        warmup: [...dayB.warmup],
        exercises: migratedDayAExercises,
      };
    }

    if (template.dayCode === "B") {
      return {
        ...template,
        name: "Day B / Pull",
        objective: "背部宽度与厚度并进，带二头收尾。",
        warmup: [...dayA.warmup],
        exercises: cloneExercises(dayA.exercises),
      };
    }

    if (template.dayCode === "C") {
      return {
        ...template,
        objective: "腿部主项、肩部补强与核心稳定一起推进。",
        exercises: migratedDayCExercises,
      };
    }

    return template;
  });
}
