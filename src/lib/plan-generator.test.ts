import { describe, expect, it } from "vitest";

import { buildPlanSnapshots } from "@/lib/plan-generator";
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
});
