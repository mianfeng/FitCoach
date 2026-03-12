import { readFile } from "node:fs/promises";

import { NextResponse } from "next/server";

import { getRepository } from "@/lib/server/repository";

export async function POST(request: Request) {
  try {
    const repository = await getRepository();
    const payload = await request.json().catch(() => null);

    if (!payload?.markdown) {
      const sourcePath = "content/knowledge/fitness-core-theory.md";
      const markdown = await readFile(sourcePath, "utf8");
      const result = await repository.importKnowledge(
        markdown,
        "健身核心理论手册 (V3.2 - 饮食全解析版)",
        sourcePath,
      );
      return NextResponse.json(result);
    }

    const result = await repository.importKnowledge(
      payload.markdown,
      payload.title ?? "自定义健身知识",
      payload.sourcePath ?? "manual-import",
    );
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to import knowledge";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
