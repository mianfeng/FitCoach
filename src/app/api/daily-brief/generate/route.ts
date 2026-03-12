import { NextResponse } from "next/server";

import { buildDailyBrief } from "@/lib/server/domain";
import { getRepository } from "@/lib/server/repository";
import { dailyBriefRequestSchema } from "@/lib/validations";

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const input = dailyBriefRequestSchema.parse(payload);
    const repository = await getRepository();
    const { profile, plan, templates } = await repository.getPlanSetup();
    const reports = await repository.listSessionReports(20);
    const existing = await repository.findDailyBriefByDate(input.date);
    const { brief, reused } = buildDailyBrief(input, profile, plan, templates, reports, existing);
    if (!reused) {
      await repository.saveDailyBrief(brief);
    }
    return NextResponse.json({ brief, reused });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to generate brief";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
