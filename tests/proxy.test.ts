import assert from "node:assert/strict";
import { test } from "node:test";
import { unstable_doesMiddlewareMatch as matches } from "next/experimental/testing/server";
import { config } from "@/proxy";

const runs = (path: string) => matches({ config, url: `https://app.example.com${path}` });

test("the page Google returns to goes through the proxy, which swaps the sign-in code for a session", () => {
  assert.equal(runs("/auth/continue"), true);
  assert.equal(runs("/auth/continue?neon_auth_session_verifier=abc"), true);
});

test("app pages are gated by the proxy", () => {
  for (const path of ["/", "/jobs", "/jobs/123", "/discover", "/settings", "/applications/9"]) assert.equal(runs(path), true, path);
});

test("sign-in pages, API routes and static files bypass it", () => {
  for (const path of ["/auth/sign-in", "/auth/sign-up", "/auth/callback", "/api/auth/get-session", "/api/health", "/api/cron/discover", "/api/data-export", "/unauthorized", "/_next/static/x.js", "/icon.svg"]) {
    assert.equal(runs(path), false, path);
  }
});
