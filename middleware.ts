import { NextResponse, type NextRequest } from "next/server";
import { DEMO_COOKIE, parseDemoSession } from "@/lib/demo";
import { isDemoMode } from "@/lib/env";
import { updateSession } from "@/lib/supabase/middleware";

function isProtectedPath(pathname: string): boolean {
  return pathname.startsWith("/app") || pathname.startsWith("/settings");
}

export async function middleware(request: NextRequest) {
  if (isDemoMode()) {
    if (isProtectedPath(request.nextUrl.pathname)) {
      const demo = parseDemoSession(request.cookies.get(DEMO_COOKIE)?.value);
      if (!demo) {
        const url = request.nextUrl.clone();
        url.pathname = "/login";
        url.searchParams.set("next", request.nextUrl.pathname);
        return NextResponse.redirect(url);
      }
    }
    return NextResponse.next();
  }

  return updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
