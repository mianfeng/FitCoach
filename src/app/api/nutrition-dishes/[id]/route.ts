import { NextResponse } from "next/server";

import { getRepository } from "@/lib/server/repository";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!id?.trim()) {
      return NextResponse.json({ error: "Missing dish id" }, { status: 400 });
    }
    const repository = await getRepository();
    await repository.deleteNutritionDish(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete nutrition dish";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
