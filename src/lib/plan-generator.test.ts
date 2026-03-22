import { describe, expect, it } from "vitest";

import { buildPlanSnapshots, mergePlanSnapshotsFromDate } from "@/lib/plan-generator";
import { buildDefaultPlanSetup } from "@/lib/seed";

describe("plan snapshots", () => {
  it("applies the latest A/B/C day layout", () => {
    const setup = buildDefaultPlanSetup();
    const templateA = setup.templates.find((template) => template.dayCode === "A");
    const templateB = setup.templates.find((template) => template.dayCode === "B");
    const templateC = setup.templates.find((template) => template.dayCode === "C");

    expect(templateA?.name).toBe("Day A / Push");
    expect(templateA?.exercises.map((exercise) => exercise.name)).toEqual([
      "杠铃卧推",
      "上斜哑铃卧推",
      "侧平举",
      "绳索下压",
    ]);
    expect(templateB?.name).toBe("Day B / Pull");
    expect(templateB?.exercises.some((exercise) => exercise.name === "反手高位下拉")).toBe(true);
    expect(templateC?.exercises.some((exercise) => exercise.name === "哑铃推举")).toBe(true);
  });

  it("uses 253 meal split for rest-day snapshots", () => {
    const setup = buildDefaultPlanSetup();
    const snapshots = buildPlanSnapshots({
      ...setup,
      plan: {
        ...setup.plan,
        startDate: "2026-03-12",
        calendarEntries: [],
      },
    });

    const restSnapshot = snapshots.find((snapshot) => snapshot.scheduledDay === "rest");

    expect(restSnapshot?.mealPrescription.meals.map((meal) => `${meal.label}:${meal.sharePercent}`)).toEqual([
      "早餐:20",
      "午餐:50",
      "晚餐:30",
    ]);
    expect(restSnapshot?.mealPrescription.guidance.at(-1)).toContain("253");
  });

  it("only updates current and future snapshots after a plan change", () => {
    const merged = mergePlanSnapshotsFromDate(
      [
        {
          id: "past",
          date: "2026-03-21",
          label: "W2D2B",
          scheduledDay: "B",
          workoutPrescription: {
            dayCode: "B",
            title: "旧 B 日",
            objective: "",
            warmup: [],
            exercises: [],
            caution: [],
          },
          mealPrescription: {
            dayType: "training",
            macros: { proteinG: 108, carbsG: 240, fatsG: 54 },
            meals: [],
            guidance: [],
          },
          planRevisionId: "old",
          createdAt: "2026-03-21T10:00:00.000Z",
        },
      ],
      [
        {
          id: "past-new",
          date: "2026-03-21",
          label: "W2D2B",
          scheduledDay: "B",
          workoutPrescription: {
            dayCode: "B",
            title: "新 B 日",
            objective: "",
            warmup: [],
            exercises: [],
            caution: [],
          },
          mealPrescription: {
            dayType: "training",
            macros: { proteinG: 108, carbsG: 240, fatsG: 54 },
            meals: [],
            guidance: [],
          },
          planRevisionId: "new",
          createdAt: "2026-03-22T10:00:00.000Z",
        },
        {
          id: "future-new",
          date: "2026-03-22",
          label: "W2D3C",
          scheduledDay: "C",
          workoutPrescription: {
            dayCode: "C",
            title: "新 C 日",
            objective: "",
            warmup: [],
            exercises: [],
            caution: [],
          },
          mealPrescription: {
            dayType: "training",
            macros: { proteinG: 108, carbsG: 240, fatsG: 54 },
            meals: [],
            guidance: [],
          },
          planRevisionId: "new",
          createdAt: "2026-03-22T10:00:00.000Z",
        },
      ],
      "2026-03-22",
    );

    expect(merged.map((snapshot) => `${snapshot.date}:${snapshot.workoutPrescription.title}`)).toEqual([
      "2026-03-21:旧 B 日",
      "2026-03-22:新 C 日",
    ]);
  });
});
