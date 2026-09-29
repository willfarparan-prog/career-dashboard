import { NextResponse, type NextRequest } from "next/server";
import { getAuth } from "@/lib/auth/server";

// Local preview (`next dev` + CAREER_DEV_PREVIEW=1) skips sign-in; see src/lib/auth/owner.ts.
const devPreview = process.env.NODE_ENV === "development" && process.env.CAREER_DEV_PREVIEW === "1";

type Middleware = (request: NextRequest) => Promise<Response> | Response;
let middleware: Middleware | null = null;

/**
 * Optimistic gate only: pages and actions still check the owner themselves.
 *
 * It also finishes Google sign-in. Returning from Google, the URL carries a
 * one-time `neon_auth_session_verifier`; only this proxy exchanges it for the
 * session cookie, so it must run on the page Google sends you back to
 * (/auth/continue). Without that, sign-in "succeeds" but no session exists.
 */
export default async function proxy(request: NextRequest) {
  if (devPreview) return NextResponse.next();
  middleware ??= getAuth().middleware({ loginUrl: "/auth/sign-in" }) as unknown as Middleware;
  return middleware(request);
}

export const config = {
  matcher: [
    // Where Google returns you: must go through the proxy (see above).
    "/auth/continue",
    // Everything else except the sign-in pages, API routes (each handler checks the owner
    // itself and answers 401, not a redirect) and static files.
    "/((?!auth|api/|unauthorized|_next/static|_next/image|favicon.ico|icon.svg|robots.txt).*)",
  ],
};
