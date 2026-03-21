import { describe, expect, it } from "vitest";

import { buildPlanSnapshots } from "@/lib/plan-generator";
import { buildDefaultPlanSetup } from "@/lib/seed";

describe("plan snapshots", () => {
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
