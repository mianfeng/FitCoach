import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const PUBLIC_PATHS = ["/unlock", "/api/unlock", "/manifest.webmanifest"];

export function proxy(request: NextRequest) {
  const accessToken = process.env.FITCOACH_ACCESS_TOKEN;
  if (!accessToken) {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;
  if (
    PUBLIC_PATHS.some((path) => pathname === path) ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon.ico")
  ) {
    return NextResponse.next();
  }

  const cookieToken = request.cookies.get("fitcoach_access")?.value;
  if (cookieToken === accessToken) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const unlockUrl = new URL("/unlock", request.url);
  return NextResponse.redirect(unlockUrl);
}

export const config = {
  matcher: ["/((?!.*\\..*).*)", "/api/:path*"],
};
