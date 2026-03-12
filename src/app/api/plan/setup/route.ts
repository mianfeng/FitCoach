import { NextResponse } from "next/server";

import { getRepository } from "@/lib/server/repository";
import type { PlanSetupInput } from "@/lib/types";
import { planSetupSchema } from "@/lib/validations";

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const input = planSetupSchema.parse(payload) as PlanSetupInput;
    const repository = await getRepository();
    const saved = await repository.savePlanSetup(input);
    return NextResponse.json(saved);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save plan";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
