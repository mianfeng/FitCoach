import type { CutMacroTemplate, ExerciseTemplate, WorkoutTemplate } from "@/lib/types";

export const DEFAULT_CUT_MACRO_TEMPLATE: CutMacroTemplate = {
  trainingDay: {
    proteinG: 90,
    fatsG: 48,
    carbsG: 150,
  },
  restDay: {
    proteinG: 90,
    fatsG: 48,
    carbsG: 120,
  },
};

function pickDefaultMainExerciseId(exercises: ExerciseTemplate[]) {
  return exercises.find((exercise) => exercise.category === "compound")?.id ?? exercises[0]?.id;
}

export function countMainExercises(template: WorkoutTemplate) {
  return template.exercises.filter((exercise) => exercise.exerciseRole === "main").length;
}

export function normalizeExerciseRolesForTemplate(template: WorkoutTemplate): WorkoutTemplate {
  if (!template.exercises.length) {
    return template;
  }

  const existingMainExercises = template.exercises.filter((exercise) => exercise.exerciseRole === "main");
  const canonicalMainId = existingMainExercises[0]?.id ?? pickDefaultMainExerciseId(template.exercises);

  return {
    ...template,
    exercises: template.exercises.map((exercise) => ({
      ...exercise,
      exerciseRole: exercise.id === canonicalMainId ? "main" : "accessory",
    })),
  };
}

export function normalizeExerciseRolesForTemplates(templates: WorkoutTemplate[]) {
  return templates.map((template) => normalizeExerciseRolesForTemplate(template));
}
