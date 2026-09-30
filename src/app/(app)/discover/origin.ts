import "server-only";

import { headers } from "next/headers";
import { buildBookmarklet, resolveAppOrigin } from "@/lib/discover/bookmarklet";

/** The bookmarklet for this deployment: NEXT_PUBLIC_APP_URL, else the request's host. */
export async function bookmarkletHref(): Promise<string> {
  const h = await headers();
  const origin = resolveAppOrigin({
    envUrl: process.env.NEXT_PUBLIC_APP_URL,
    host: h.get("x-forwarded-host") ?? h.get("host"),
    proto: h.get("x-forwarded-proto"),
  });
  return buildBookmarklet(origin);
}
