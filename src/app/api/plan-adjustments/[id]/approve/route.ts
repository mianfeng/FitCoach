import { NextResponse } from "next/server";

import { getRepository } from "@/lib/server/repository";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const repository = await getRepository();
    const proposal = await repository.approvePlanAdjustment(id);
    if (!proposal) {
      return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
    }
    return NextResponse.json({ proposal });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to approve proposal";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
