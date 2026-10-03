import { and, asc, eq } from "drizzle-orm";
import type { Database } from "@/db";
import { DISCOVER_MODES, LEAD_SOURCES, jobSearches, type DiscoverMode, type CareerPath, type LeadSource } from "@/db/schema";

export type JobSearch = typeof jobSearches.$inferSelect;

export class SearchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SearchError";
  }
}

export type SearchInput = {
  mode?: DiscoverMode;
  directionTerms?: string[];
  name?: string;
  query: string;
  location?: string;
  remoteOnly?: boolean;
  sources?: string[];
  maxAgeDays?: number | null;
};

export function validateSearch(input: SearchInput) {
  if (input.mode && !DISCOVER_MODES.includes(input.mode)) throw new SearchError("Choose Priority paths or Explore other careers.");
  const query = input.query.trim();
  if (!query) throw new SearchError("Say what to search for, e.g. \"customer success manager\".");
  if (query.length > 120) throw new SearchError("Keep the search under 120 characters.");
  const sources = (input.sources ?? [...LEAD_SOURCES]).filter((s): s is LeadSource => (LEAD_SOURCES as readonly string[]).includes(s));
  if (!sources.length) throw new SearchError("Pick at least one source.");
  const maxAgeDays = input.maxAgeDays ?? 7;
  if (!Number.isInteger(maxAgeDays) || maxAgeDays < 1 || maxAgeDays > 30) throw new SearchError("Posted within must be 1–30 days.");
  return {
    mode: input.mode ?? "priority",
    directionTerms: [...new Set((input.directionTerms ?? []).map((s) => s.trim().slice(0, 80)).filter(Boolean))].slice(0, 8),
    name: (input.name ?? "").trim() || query,
    query,
    location: (input.location ?? "").trim(),
    remoteOnly: Boolean(input.remoteOnly),
    sources: [...new Set(sources)],
    maxAgeDays,
  };
}

export async function listSearches(db: Database, userId: string, mode?: DiscoverMode): Promise<JobSearch[]> {
  return db.select().from(jobSearches).where(and(eq(jobSearches.userId, userId), mode ? eq(jobSearches.mode, mode) : undefined)).orderBy(asc(jobSearches.createdAt));
}

export async function getSearch(db: Database, userId: string, id: string): Promise<JobSearch | null> {
  const [row] = await db.select().from(jobSearches).where(and(eq(jobSearches.id, id), eq(jobSearches.userId, userId)));
  return row ?? null;
}

export async function createSearch(db: Database, userId: string, input: SearchInput): Promise<JobSearch> {
  const [row] = await db.insert(jobSearches).values({ userId, ...validateSearch(input) }).returning();
  return row;
}

export async function updateSearch(db: Database, userId: string, id: string, input: SearchInput): Promise<void> {
  const existing = await getSearch(db, userId, id);
  if (!existing) throw new SearchError("Search not found.");
  if (input.mode && input.mode !== existing.mode) throw new SearchError("Create a new search to use another view.");
  const values = validateSearch({ ...input, mode: existing.mode });
  const updated = await db.update(jobSearches).set({ ...values, updatedAt: new Date() }).where(and(eq(jobSearches.id, id), eq(jobSearches.userId, userId))).returning({ id: jobSearches.id });
  if (!updated.length) throw new SearchError("Search not found.");
}

export async function setSearchActive(db: Database, userId: string, id: string, active: boolean): Promise<void> {
  const updated = await db.update(jobSearches).set({ active, updatedAt: new Date() }).where(and(eq(jobSearches.id, id), eq(jobSearches.userId, userId))).returning({ id: jobSearches.id });
  if (!updated.length) throw new SearchError("Search not found.");
}

/** Leads keep their data; they just lose the link to the deleted search. */
export async function deleteSearch(db: Database, userId: string, id: string): Promise<void> {
  await db.delete(jobSearches).where(and(eq(jobSearches.id, id), eq(jobSearches.userId, userId)));
}

const PATH_QUERIES: Record<CareerPath, string> = {
  customer_success: "customer success manager",
  implementation: "implementation specialist",
  account_management: "account manager",
  employer_wellbeing: "employee wellbeing program manager",
  other: "client success",
};

/** Starter searches from the profile's target roles and places (shown as one-click suggestions). */
export function suggestedSearches(targetRoles: CareerPath[], targetLocations: string[]): SearchInput[] {
  const place = targetLocations.find((l) => !/remote/i.test(l)) ?? "";
  const roles = targetRoles.length ? targetRoles : (["customer_success", "implementation", "account_management", "employer_wellbeing"] as CareerPath[]);
  return roles.slice(0, 4).map((role) => ({ name: PATH_QUERIES[role], query: PATH_QUERIES[role], location: place, remoteOnly: false, maxAgeDays: 7 }));
}
