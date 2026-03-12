import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { getRepository } from "@/lib/server/repository";
import { uid } from "@/lib/utils";
import { sessionReportSchema } from "@/lib/validations";

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const parsed = sessionReportSchema.parse(payload);
    const repository = await getRepository();
    const report = {
      id: uid("report"),
      createdAt: new Date().toISOString(),
      summary: "",
      ...parsed,
    };
    const saved = await repository.saveSessionReport(report);
    const proposals = await repository.listPlanAdjustments(3);
    const summaries = await repository.listMemorySummaries(3);
    revalidatePath("/");
    revalidatePath("/plan");
    revalidatePath("/history");
    return NextResponse.json({ report: saved, proposals, summaries });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save report";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
