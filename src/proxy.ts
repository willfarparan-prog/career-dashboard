import { NextResponse, type NextRequest } from "next/server";
import { getAuth } from "@/lib/auth/server";

// Local preview (`next dev` + CAREER_DEV_PREVIEW=1) skips sign-in; see src/lib/auth/owner.ts.
const devPreview = process.env.NODE_ENV === "development" && process.env.CAREER_DEV_PREVIEW === "1";

type Middleware = (request: NextRequest) => Promise<Response> | Response;
let middleware: Middleware | null = null;

/** Optimistic gate only: pages and actions still check the owner themselves. */
export default async function proxy(request: NextRequest) {
  if (devPreview) return NextResponse.next();
  middleware ??= getAuth().middleware({ loginUrl: "/auth/sign-in" }) as unknown as Middleware;
  return middleware(request);
}

export const config = {
  // API routes are excluded: each handler checks the owner itself and answers 401, not a redirect.
  matcher: ["/((?!auth|api/|unauthorized|_next/static|_next/image|favicon.ico|icon.svg|robots.txt).*)"],
};
