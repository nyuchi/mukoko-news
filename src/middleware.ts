import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Route protection middleware.
 *
 * Protected: /platform/*, /admin/*
 * Public: /sign-in, /embed/*, /sources/*, /article/*, /help, /privacy, /terms, /api/*, /_next/*
 *
 * Auth check is client-side (localStorage JWT). This middleware does a basic
 * cookie check for SSR — the AuthProvider handles full validation client-side.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Public routes — no auth required
  const publicPrefixes = [
    "/sign-in",
    "/embed",
    "/sources",
    "/article",
    "/categories",
    "/help",
    "/privacy",
    "/terms",
    "/api",
    "/_next",
    "/favicon",
    "/mukoko",
    "/apple-touch",
    "/manifest",
  ];

  if (
    pathname === "/" ||
    publicPrefixes.some((prefix) => pathname.startsWith(prefix))
  ) {
    return NextResponse.next();
  }

  // Protected routes — check for Stytch session cookie
  const token = request.cookies.get("mukoko_session_token")?.value;
  if (!token) {
    const signInUrl = new URL("/sign-in", request.url);
    signInUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(signInUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Match all routes except static files
    "/((?!_next/static|_next/image|favicon.ico|.*\\.).*)",
  ],
};
