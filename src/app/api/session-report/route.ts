import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import {
  buildDailyBriefFromSnapshot,
  buildNextDayDecision,
  buildDailyReviewMarkdown,
  buildTodayAutofillBrief,
} from "@/lib/server/domain";
import { generateGeminiDailyReview } from "@/lib/server/gemini";
import { deriveDietAdherence, normalizeMealLog } from "@/lib/session-report";
import { getRepository } from "@/lib/server/repository";
import { uid } from "@/lib/utils";
import { sessionReportSchema } from "@/lib/validations";

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const parsed = sessionReportSchema.parse(payload);
    const repository = await getRepository();
    const snapshot = await repository.getDashboardSnapshot();
    const mealLog = normalizeMealLog(parsed.mealLog);
    const normalizedReport = {
      ...parsed,
      reportVersion: 2 as const,
      mealLog,
      trainingReportText: parsed.trainingReportText ?? "",
      dietAdherence: parsed.dietAdherence ?? deriveDietAdherence(mealLog),
      painNotes: parsed.painNotes?.trim() || undefined,
      recoveryNote: parsed.recoveryNote?.trim() || undefined,
    };
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
    const previewReport = {
      id: "preview",
      createdAt: new Date().toISOString(),
      summary: "",
      ...normalizedReport,
    };
    const nextDayDecision = buildNextDayDecision(previewReport, snapshot.plan);
    const fallbackReview = buildDailyReviewMarkdown({
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
      ...normalizedReport,
    };
    const saved = await repository.saveSessionReport(report);
    const proposals = await repository.listPlanAdjustments(3);
    const summaries = await repository.listMemorySummaries(3);
    revalidatePath("/");
    revalidatePath("/plan");
    revalidatePath("/history");
    return NextResponse.json({ report: saved, proposals, summaries, review });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save report";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
