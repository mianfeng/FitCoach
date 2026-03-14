import { NextResponse } from "next/server";

import { getRepository } from "@/lib/server/repository";
import type { NutritionDish } from "@/lib/types";
import { uid } from "@/lib/utils";
import { nutritionDishSchema } from "@/lib/validations";

function normalizeAliases(input: string[]) {
  return [...new Set(input.map((item) => item.trim()).filter(Boolean))];
}

function normalizeName(input: string) {
  return input.trim().toLowerCase();
}

export async function GET() {
  try {
    const repository = await getRepository();
    const dishes = await repository.listNutritionDishes();
    return NextResponse.json({ dishes });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load nutrition dishes";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const parsed = nutritionDishSchema.parse(payload);
    const repository = await getRepository();
    const existing = await repository.listNutritionDishes();
    const normalizedName = normalizeName(parsed.name);
    const duplicate = existing.find((item) => item.id !== parsed.id && normalizeName(item.name) === normalizedName);
    if (duplicate) {
      return NextResponse.json({ error: `菜品名称重复：${parsed.name}` }, { status: 400 });
    }

    const dish: NutritionDish = {
      id: parsed.id ?? uid("dish"),
      name: parsed.name.trim(),
      aliases: normalizeAliases(parsed.aliases),
      macros: parsed.macros,
    };
    const saved = await repository.upsertNutritionDish(dish);
    return NextResponse.json({ dish: saved });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save nutrition dish";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
