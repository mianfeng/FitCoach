import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import {
  buildDailyBriefFromSnapshot,
  buildDailyReviewMarkdown,
  buildTodayAutofillBrief,
} from "@/lib/server/domain";
import { generateGeminiDailyReview } from "@/lib/server/gemini";
import { getRepository } from "@/lib/server/repository";
import { uid } from "@/lib/utils";
import { sessionReportSchema } from "@/lib/validations";

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const parsed = sessionReportSchema.parse(payload);
    const repository = await getRepository();
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
    const review =
      (await generateGeminiDailyReview({
        report: {
          id: "preview",
          createdAt: new Date().toISOString(),
          summary: "",
          ...parsed,
        },
        targetMacros: reviewBrief.mealPrescription.macros,
        planLabel: reviewBrief.calendarLabel,
        workoutTitle: reviewBrief.workoutPrescription.title,
      })) ??
      buildDailyReviewMarkdown({
        report: {
          id: "preview",
          createdAt: new Date().toISOString(),
          summary: "",
          ...parsed,
        },
        targetMacros: reviewBrief.mealPrescription.macros,
      });
    const report = {
      id: uid("report"),
      createdAt: new Date().toISOString(),
      summary: "",
      dailyReviewMarkdown: review,
      ...parsed,
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
