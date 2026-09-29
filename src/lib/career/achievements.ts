import { and, asc, eq, isNull, type SQL } from "drizzle-orm";
import type { Database } from "@/db";
import { achievements, roles, type FactStatus, type Metric } from "@/db/schema";
import type { Achievement, Role } from "@/lib/ai/library";
import { DEFAULT_METRIC_PROMPTS, isFactStatus } from "./labels";
import { CareerInputError, cleanList, cleanTags, isUuid, required } from "./util";

export type AchievementInput = {
  roleId: string | null;
  headline: string;
  action: string;
  audience: string;
  scale: string;
  collaborators: string;
  tools: string[];
  outcome: string;
  metrics: Metric[];
  tags: string[];
  factStatus: FactStatus;
  evidenceNote: string;
  missingMetrics: string[];
  sourceQuote?: string;
};

export type AchievementFilters = {
  /** A role id, or "none" for achievements not tied to a role. */
  role?: string;
  tag?: string;
  status?: FactStatus;
  missingMetrics?: boolean;
};

export function cleanMetrics(metrics: readonly Metric[]): Metric[] {
  return metrics
    .map((m) => ({ label: m.label.trim(), value: m.value.trim(), unit: m.unit?.trim() || null, status: isFactStatus(m.status) ? m.status : "needs_confirmation" }))
    .filter((m) => m.label || m.value);
}

async function assertOwnRole(db: Database, userId: string, roleId: string | null): Promise<string | null> {
  if (!roleId) return null;
  if (!isUuid(roleId)) throw new CareerInputError("Pick one of your roles.");
  const [row] = await db.select({ id: roles.id }).from(roles).where(and(eq(roles.id, roleId), eq(roles.userId, userId)));
  if (!row) throw new CareerInputError("Pick one of your roles.");
  return row.id;
}

export async function validateAchievement(db: Database, userId: string, input: AchievementInput) {
  if (!isFactStatus(input.factStatus)) throw new CareerInputError("Pick a fact status.");
  const metrics = cleanMetrics(input.metrics);
  for (const m of metrics) {
    if (!m.value) throw new CareerInputError(`Add the number for “${m.label}”, or clear that row.`);
    if (!m.label) throw new CareerInputError(`Say what ${m.value}${m.unit ? ` ${m.unit}` : ""} measures.`);
  }
  return {
    roleId: await assertOwnRole(db, userId, input.roleId),
    headline: required(input.headline, "Add a short headline."),
    action: input.action.trim(),
    audience: input.audience.trim(),
    scale: input.scale.trim(),
    collaborators: input.collaborators.trim(),
    tools: cleanList(input.tools),
    outcome: input.outcome.trim(),
    metrics,
    tags: cleanTags(input.tags),
    factStatus: input.factStatus,
    evidenceNote: input.evidenceNote.trim(),
    missingMetrics: cleanList(input.missingMetrics),
    ...(input.sourceQuote !== undefined ? { sourceQuote: input.sourceQuote.trim() } : {}),
  };
}

/** True when an achievement has no numbers yet, or lists numbers worth finding. */
export function needsMetrics(a: Pick<Achievement, "metrics" | "missingMetrics">): boolean {
  return a.metrics.length === 0 || a.missingMetrics.length > 0;
}

const TAG_PROMPTS: Array<[RegExp, string[]]> = [
  [/onboard/, ["people onboarded", "time to onboard"]],
  [/retention|renewal/, ["retention", "renewals"]],
  [/adoption|engagement/, ["participation", "adoption rate"]],
  [/coach|training/, ["people coached", "completion rate"]],
  [/program/, ["participation", "programs run"]],
  [/referral|growth|sales/, ["referrals", "revenue"]],
];

/**
 * Which numbers to ask the owner for. These are prompts only: the app never
 * fills in a number the owner hasn't given.
 */
export function metricPrompts(a: Pick<Achievement, "metrics" | "missingMetrics" | "tags">): string[] {
  if (a.missingMetrics.length) return a.missingMetrics;
  if (a.metrics.length) return [];
  const fromTags = a.tags.flatMap((tag) => TAG_PROMPTS.filter(([pattern]) => pattern.test(tag)).flatMap(([, prompts]) => prompts));
  return cleanList([...fromTags, ...DEFAULT_METRIC_PROMPTS]).slice(0, 5);
}

export async function listAchievements(db: Database, userId: string, filters: AchievementFilters = {}): Promise<Achievement[]> {
  const where: SQL[] = [eq(achievements.userId, userId)];
  if (filters.role === "none") where.push(isNull(achievements.roleId));
  else if (filters.role) {
    if (!isUuid(filters.role)) return [];
    where.push(eq(achievements.roleId, filters.role));
  }
  if (filters.status && isFactStatus(filters.status)) where.push(eq(achievements.factStatus, filters.status));
  const rows = await db
    .select()
    .from(achievements)
    .where(and(...where))
    .orderBy(asc(achievements.sort), asc(achievements.createdAt));
  const tag = filters.tag?.trim().toLowerCase();
  return rows.filter((a) => (!tag || a.tags.some((t) => t.toLowerCase() === tag)) && (!filters.missingMetrics || needsMetrics(a)));
}

export async function getAchievement(db: Database, userId: string, id: string): Promise<Achievement | null> {
  if (!isUuid(id)) return null;
  const [row] = await db.select().from(achievements).where(and(eq(achievements.id, id), eq(achievements.userId, userId)));
  return row ?? null;
}

export async function createAchievement(db: Database, userId: string, input: AchievementInput): Promise<Achievement> {
  const values = await validateAchievement(db, userId, input);
  const [row] = await db.insert(achievements).values({ userId, ...values }).returning();
  return row;
}

export async function updateAchievement(db: Database, userId: string, id: string, input: AchievementInput): Promise<Achievement> {
  if (!isUuid(id)) throw new CareerInputError("That achievement no longer exists.");
  const values = await validateAchievement(db, userId, input);
  const [row] = await db
    .update(achievements)
    .set({ ...values, updatedAt: new Date() })
    .where(and(eq(achievements.id, id), eq(achievements.userId, userId)))
    .returning();
  if (!row) throw new CareerInputError("That achievement no longer exists.");
  return row;
}

export async function deleteAchievement(db: Database, userId: string, id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const deleted = await db
    .delete(achievements)
    .where(and(eq(achievements.id, id), eq(achievements.userId, userId)))
    .returning({ id: achievements.id });
  return deleted.length > 0;
}

/** Every tag in use, sorted, for the filter menu. */
export function allTags(list: readonly Pick<Achievement, "tags">[]): string[] {
  return [...new Set(list.flatMap((a) => a.tags.map((t) => t.toLowerCase())))].sort();
}

export type RoleGroup = { role: Role | null; items: Achievement[] };

/** Groups achievements under their roles (in the given role order), then the ones without a role. */
export function groupByRole(list: readonly Achievement[], roleList: readonly Role[]): RoleGroup[] {
  const known = new Set(roleList.map((r) => r.id));
  const groups: RoleGroup[] = roleList.map((role) => ({ role, items: list.filter((a) => a.roleId === role.id) }));
  groups.push({ role: null, items: list.filter((a) => !a.roleId || !known.has(a.roleId)) });
  return groups.filter((g) => g.items.length > 0);
}

/** "18" + "%" → "18%"; "40,000" + "USD" → "$40,000"; "250" + "hours" → "250 hours". */
export function formatMetricValue(m: Pick<Metric, "value" | "unit">): string {
  const unit = m.unit?.trim() ?? "";
  if (!unit) return m.value;
  if (unit === "%") return `${m.value}%`;
  if (/^(usd|\$)$/i.test(unit)) return `$${m.value.replace(/^\$/, "")}`;
  return `${m.value} ${unit}`;
}
