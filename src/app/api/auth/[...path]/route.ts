import type { NextRequest } from "next/server";
import { devPreview } from "@/lib/auth/owner";
import { getAuth } from "@/lib/auth/server";

type Handler = (request: NextRequest, context: { params: Promise<{ path: string[] }> }) => Promise<Response>;

const configured = () => Boolean(process.env.NEON_AUTH_BASE_URL && process.env.NEON_AUTH_COOKIE_SECRET);

// Created per request so the build doesn't need auth env vars. The local
// preview has no Neon Auth, so the auth UI's session check gets "no session".
export const GET: Handler = (request, context) =>
  devPreview && !configured() ? Promise.resolve(Response.json(null)) : (getAuth().handler().GET as Handler)(request, context);
export const POST: Handler = (request, context) =>
  devPreview && !configured() ? Promise.resolve(Response.json(null)) : (getAuth().handler().POST as Handler)(request, context);
