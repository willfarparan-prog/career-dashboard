import { and, count, desc, eq, gte, sum } from "drizzle-orm";
import type { Database } from "@/db";
import { aiRuns } from "@/db/schema";
import { dailyBudgetUsd } from "@/lib/ai/models";
import { startOfUtcDay, startOfUtcMonth } from "@/lib/applications/dates";

export type AiRun = typeof aiRuns.$inferSelect;

export async function spentSince(db: Database, userId: string, since: Date): Promise<{ cost: number; runs: number }> {
  const [row] = await db
    .select({ total: sum(aiRuns.costUsd), runs: count() })
    .from(aiRuns)
    .where(and(eq(aiRuns.userId, userId), gte(aiRuns.createdAt, since)));
  return { cost: Number(row?.total ?? 0), runs: Number(row?.runs ?? 0) };
}

export type SpendSummary = {
  today: number;
  runsToday: number;
  month: number;
  runsMonth: number;
  /** AI_DAILY_BUDGET_USD (default $5). Resets at midnight UTC. */
  dailyBudget: number;
};

export async function spendSummary(db: Database, userId: string, now = new Date()): Promise<SpendSummary> {
  const [today, month] = await Promise.all([spentSince(db, userId, startOfUtcDay(now)), spentSince(db, userId, startOfUtcMonth(now))]);
  return { today: today.cost, runsToday: today.runs, month: month.cost, runsMonth: month.runs, dailyBudget: dailyBudgetUsd() };
}

/** The latest Claude calls, newest first. */
export async function recentRuns(db: Database, userId: string, limit = 200): Promise<AiRun[]> {
  return db.select().from(aiRuns).where(eq(aiRuns.userId, userId)).orderBy(desc(aiRuns.createdAt)).limit(limit);
}
