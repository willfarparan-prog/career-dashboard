import type { NextRequest } from "next/server";
import { getAuth } from "@/lib/auth/server";

type Handler = (request: NextRequest, context: { params: Promise<{ path: string[] }> }) => Promise<Response>;

// Created per request so the build doesn't need auth env vars.
export const GET: Handler = (request, context) => (getAuth().handler().GET as Handler)(request, context);
export const POST: Handler = (request, context) => (getAuth().handler().POST as Handler)(request, context);
