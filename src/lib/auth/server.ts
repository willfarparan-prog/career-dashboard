import "server-only";

import { createNeonAuth } from "@neondatabase/auth/next/server";

type NeonAuth = ReturnType<typeof createNeonAuth>;
let instance: NeonAuth | null = null;

/** Created on first use so builds and local previews work without auth env vars. */
export function getAuth(): NeonAuth {
  if (instance) return instance;
  const baseUrl = process.env.NEON_AUTH_BASE_URL;
  const secret = process.env.NEON_AUTH_COOKIE_SECRET;
  if (!baseUrl || !secret) throw new Error("Neon Auth is not configured (NEON_AUTH_BASE_URL, NEON_AUTH_COOKIE_SECRET).");
  instance = createNeonAuth({ baseUrl, cookies: { secret, sessionDataTtl: 300 } });
  return instance;
}
