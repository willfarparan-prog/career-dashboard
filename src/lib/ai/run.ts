import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { and, gte, eq, sum } from "drizzle-orm";
import type { z } from "zod";
import { getDatabase } from "@/db";
import { aiRuns } from "@/db/schema";
import { configuredModel, dailyBudgetUsd, estimateCost, supportsEffort, supportsFallbacks, type Usage } from "./models";

/*
 * Every Claude call in the app goes through runStructured():
 *   budget check → one structured-output request → usage/cost logged to ai_runs.
 * The key stays on the server. Outputs are schema-validated JSON, which still
 * needs the owner's factual review before anything is treated as true.
 */

export type Effort = "low" | "medium" | "high";

export type UserContent = string | Anthropic.Beta.BetaContentBlockParam[];

export type StructuredRequest<T extends z.ZodType> = {
  userId: string;
  task: string;
  promptVersion: string;
  schema: T;
  /** Stable, cacheable context (the career library). Sent first so tasks share the cached prefix. */
  context?: string;
  instructions: string;
  content: UserContent;
  effort: Effort;
  refId?: string;
  /** Returned instead of calling Claude when AI_FAKE=1 (dev server and tests only). */
  fake: () => z.infer<T>;
};

export type StructuredResult<T> = { output: T; model: string; promptVersion: string; runId: string | null };

export class AiError extends Error {
  constructor(message: string, readonly kind: "not_configured" | "budget" | "refused" | "truncated" | "invalid" | "api") {
    super(message);
    this.name = "AiError";
  }
}

export function fakeMode() {
  return process.env.AI_FAKE === "1" && process.env.NODE_ENV !== "production";
}

export function aiConfigured() {
  return fakeMode() || Boolean(process.env.ANTHROPIC_API_KEY);
}

let client: Anthropic | null = null;
function anthropic() {
  client ??= new Anthropic({ maxRetries: 2 });
  return client;
}

function startOfUtcDay(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export async function spentSince(userId: string, since: Date): Promise<number> {
  const db = getDatabase();
  if (!db) return 0;
  const [row] = await db
    .select({ total: sum(aiRuns.costUsd) })
    .from(aiRuns)
    .where(and(eq(aiRuns.userId, userId), gte(aiRuns.createdAt, since)));
  return Number(row?.total ?? 0);
}

export async function spentToday(userId: string) {
  return spentSince(userId, startOfUtcDay());
}

type LogEntry = {
  userId: string;
  task: string;
  model: string;
  promptVersion: string;
  status: (typeof aiRuns.$inferInsert)["status"];
  usage?: Usage;
  durationMs: number;
  error?: string;
  refId?: string;
};

async function logRun(entry: LogEntry): Promise<string | null> {
  const db = getDatabase();
  if (!db) return null;
  const usage = entry.usage ?? { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  const [row] = await db
    .insert(aiRuns)
    .values({
      userId: entry.userId,
      task: entry.task,
      model: entry.model,
      promptVersion: entry.promptVersion,
      status: entry.status,
      ...usage,
      costUsd: estimateCost(entry.model, usage),
      durationMs: entry.durationMs,
      error: entry.error?.slice(0, 2000) ?? null,
      refId: entry.refId ?? null,
    })
    .returning({ id: aiRuns.id });
  return row?.id ?? null;
}

const SHARED_PREAMBLE = [
  "You work inside a private job-application workspace for one person.",
  "The career library below is the only source of facts about them. Never invent employers, titles, dates, numbers, tools, certifications or outcomes.",
  "If something is not in the library, say it is missing rather than filling it in. Coaching, program ownership, stakeholder work and client adoption are real and transferable; formal SaaS experience exists only where a role is marked SaaS.",
].join("\n");

export async function runStructured<T extends z.ZodType>(request: StructuredRequest<T>): Promise<StructuredResult<z.infer<T>>> {
  const model = configuredModel();
  const started = Date.now();

  if (fakeMode()) {
    const output = request.schema.parse(request.fake());
    const runId = await logRun({ ...request, model: `fake:${model}`, status: "ok", durationMs: Date.now() - started });
    return { output, model: `fake:${model}`, promptVersion: request.promptVersion, runId };
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new AiError("Claude isn't connected yet. Add ANTHROPIC_API_KEY in Vercel and redeploy.", "not_configured");
  }

  const budget = dailyBudgetUsd();
  const spent = await spentToday(request.userId);
  if (spent >= budget) {
    await logRun({ ...request, model, status: "blocked", durationMs: 0, error: `Daily budget $${budget.toFixed(2)} reached` });
    throw new AiError(`Today's Claude budget ($${budget.toFixed(2)}) is used up. It resets at midnight UTC, or raise AI_DAILY_BUDGET_USD.`, "budget");
  }

  const system: Anthropic.Beta.BetaTextBlockParam[] = [];
  if (request.context) {
    system.push({ type: "text", text: `${SHARED_PREAMBLE}\n\n${request.context}`, cache_control: { type: "ephemeral" } });
  } else {
    system.push({ type: "text", text: SHARED_PREAMBLE });
  }
  system.push({ type: "text", text: request.instructions });

  const fallbacks = supportsFallbacks(model);
  let response;
  try {
    response = await anthropic().beta.messages.parse({
      model,
      max_tokens: 16000,
      system,
      messages: [{ role: "user", content: request.content }],
      output_config: {
        format: betaZodOutputFormat(request.schema),
        ...(supportsEffort(model) ? { effort: request.effort } : {}),
      },
      ...(fallbacks ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    });
  } catch (error) {
    const message = error instanceof Anthropic.APIError ? `Claude returned ${error.status ?? "an error"}: ${error.message}` : error instanceof Error ? error.message : "Couldn't reach Claude.";
    await logRun({ ...request, model, status: "error", durationMs: Date.now() - started, error: message });
    throw new AiError(message, "api");
  }

  const served = response.model || model;
  const usage: Usage = {
    inputTokens: response.usage.input_tokens ?? 0,
    outputTokens: response.usage.output_tokens ?? 0,
    cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
  };
  const durationMs = Date.now() - started;

  if (response.stop_reason === "refusal") {
    await logRun({ ...request, model: served, status: "refused", usage, durationMs, error: response.stop_details?.explanation ?? "refused" });
    throw new AiError("Claude declined this request. Try rewording the input or removing unrelated text.", "refused");
  }
  if (response.stop_reason === "max_tokens") {
    await logRun({ ...request, model: served, status: "truncated", usage, durationMs, error: "max_tokens" });
    throw new AiError("Claude's answer was cut off because it was too long. Try a shorter input.", "truncated");
  }
  const parsed = request.schema.safeParse(response.parsed_output);
  if (!parsed.success) {
    await logRun({ ...request, model: served, status: "error", usage, durationMs, error: "Output did not match the schema" });
    throw new AiError("Claude's answer didn't match the expected format. Please try again.", "invalid");
  }

  const runId = await logRun({ ...request, model: served, status: "ok", usage, durationMs });
  return { output: parsed.data, model: served, promptVersion: request.promptVersion, runId };
}

/** A user-facing message for any error thrown while running a task. */
export function aiErrorMessage(error: unknown): string {
  if (error instanceof AiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}
