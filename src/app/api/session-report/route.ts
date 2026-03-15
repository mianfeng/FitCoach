import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import {
  buildDailyBriefFromSnapshot,
  buildNextDayDecision,
  buildStrictDailyReviewMarkdown,
  buildTodayAutofillBrief,
} from "@/lib/server/domain";
import { computeMealLogNutritionWithGemini, generateGeminiDailyReview } from "@/lib/server/gemini";
import { createEmptyMealLog, deriveDietAdherence, normalizeMealLog } from "@/lib/session-report";
import { getRepository } from "@/lib/server/repository";
import { uid } from "@/lib/utils";
import { sessionReportSchema } from "@/lib/validations";

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const parsed = sessionReportSchema.parse(payload);
    const repository = await getRepository();
    const mealLog = normalizeMealLog(parsed.mealLog) ?? createEmptyMealLog();
    const normalizedReport = {
      ...parsed,
      reportVersion: 2 as const,
      mealLog,
      trainingReportText: parsed.trainingReportText ?? "",
      dietAdherence: parsed.dietAdherence ?? deriveDietAdherence(mealLog),
      painNotes: parsed.painNotes?.trim() || undefined,
      recoveryNote: parsed.recoveryNote?.trim() || undefined,
    };
    const snapshot = await repository.getDashboardSnapshot();
    const planSnapshot = await repository.findPlanSnapshotByDate(parsed.date);
    const reviewBrief =
      planSnapshot
        ? buildDailyBriefFromSnapshot(planSnapshot)
        : buildTodayAutofillBrief(
            parsed.date,
            snapshot.profile,
            snapshot.plan,
            snapshot.templates,
            snapshot.recentReports,
          );
    const targetNutrition = {
      calories:
        reviewBrief.mealPrescription.macros.proteinG * 4 +
        reviewBrief.mealPrescription.macros.carbsG * 4 +
        reviewBrief.mealPrescription.macros.fatsG * 9,
      proteinG: reviewBrief.mealPrescription.macros.proteinG,
      carbsG: reviewBrief.mealPrescription.macros.carbsG,
      fatsG: reviewBrief.mealPrescription.macros.fatsG,
    };
    const nutritionSummary = await computeMealLogNutritionWithGemini({
      mealLog,
      targetNutrition,
      nutritionDishes: snapshot.nutritionDishes,
    });
    const reportWithNutrition = {
      ...normalizedReport,
      mealLog: nutritionSummary.mealLog,
      nutritionTotals: nutritionSummary.status === "ready" ? nutritionSummary.nutritionTotals : undefined,
      nutritionGap: nutritionSummary.status === "ready" ? nutritionSummary.nutritionGap : undefined,
      nutritionWarnings: nutritionSummary.nutritionWarnings,
      nutritionComputation:
        nutritionSummary.status === "ready"
          ? {
              status: "ready" as const,
              source: "gemini" as const,
              computedAt: nutritionSummary.computedAt,
            }
          : {
              status: "pending" as const,
              source: "gemini" as const,
              error: nutritionSummary.error,
            },
    };
    if (!normalizedReport.completed) {
      const draftReport = {
        id: uid("report"),
        createdAt: new Date().toISOString(),
        summary: "",
        dailyReviewMarkdown: undefined,
        nextDayDecision: undefined,
        ...reportWithNutrition,
      };
      const saved = await repository.saveSessionReport(draftReport);
      const proposals = await repository.listPlanAdjustments(3);
      const summaries = await repository.listMemorySummaries(3);
      revalidatePath("/");
      revalidatePath("/plan");
      revalidatePath("/history");
      return NextResponse.json({
        report: saved,
        proposals,
        summaries,
        review: null,
        submissionMode: "draft",
      });
    }

    const previewReport = {
      id: "preview",
      createdAt: new Date().toISOString(),
      summary: "",
      ...reportWithNutrition,
    };
    const nextDayDecision = buildNextDayDecision(previewReport, snapshot.plan);
    const fallbackReview = buildStrictDailyReviewMarkdown({
      report: {
        ...previewReport,
        nextDayDecision,
      },
      targetMacros: reviewBrief.mealPrescription.macros,
      nextDayDecision,
    });
    const review =
      (await generateGeminiDailyReview({
        report: {
          ...previewReport,
          nextDayDecision,
        },
        targetMacros: reviewBrief.mealPrescription.macros,
        planLabel: reviewBrief.calendarLabel,
        workoutTitle: reviewBrief.workoutPrescription.title,
        draftReview: fallbackReview,
      })) ??
      fallbackReview;
    const report = {
      id: uid("report"),
      createdAt: new Date().toISOString(),
      summary: "",
      dailyReviewMarkdown: review,
      nextDayDecision,
      ...reportWithNutrition,
    };
    const saved = await repository.saveSessionReport(report);
    const proposals = await repository.listPlanAdjustments(3);
    const summaries = await repository.listMemorySummaries(3);
    revalidatePath("/");
    revalidatePath("/plan");
    revalidatePath("/history");
    return NextResponse.json({ report: saved, proposals, summaries, review, submissionMode: "completed" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save report";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
