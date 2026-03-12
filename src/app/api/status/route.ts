import { NextResponse } from "next/server";

import { getRuntimeStatus } from "@/lib/server/status";

export async function GET() {
  try {
    const status = await getRuntimeStatus();
    return NextResponse.json(status);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to get runtime status";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
