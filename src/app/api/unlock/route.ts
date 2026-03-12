import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { env } from "@/lib/server/env";

export async function POST(request: Request) {
  const payload = await request.json().catch(() => null);
  const accessToken = payload?.accessToken;

  if (!env.accessToken) {
    return NextResponse.json({ ok: true, authEnabled: false });
  }

  if (accessToken !== env.accessToken) {
    return NextResponse.json({ error: "访问口令不正确" }, { status: 401 });
  }

  const cookieStore = await cookies();
  cookieStore.set("fitcoach_access", accessToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });

  return NextResponse.json({ ok: true, authEnabled: true });
}
