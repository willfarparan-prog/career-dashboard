"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireDatabase } from "@/db";
import type { LeadSource } from "@/db/schema";
import { fail, field, ok, type ActionResult } from "@/lib/action-result";
import { aiConfigured, aiErrorMessage } from "@/lib/ai/run";
import { analyzeJob } from "@/lib/ai/tasks/analyze";
import { suggestDirections } from "@/lib/ai/tasks/explore";
import { reviewDiscoverFit } from "@/lib/ai/tasks/discover-fit";
import { requireOwnerId } from "@/lib/auth/owner";
import { getProfile } from "@/lib/career/profile";
import { dismissLeads, getLead, saveLeadToPipeline, setLeadStatus } from "@/lib/discover/leads";
import { refreshSearches } from "@/lib/discover/refresh";
import { createSearch, deleteSearch, listSearches, setSearchActive, suggestedSearches, updateSearch } from "@/lib/discover/searches";
import { getSource } from "@/lib/discover/sources";
import { isUuid } from "@/lib/jobs/format";
import { refreshMessage, searchInputFromForm, SOURCE_LABELS } from "./format";

/*
 * Thin wrappers: owner → database → src/lib/discover → revalidate → ActionResult.
 * Ids from forms are checked for shape here and always filtered by userId in the lib.
 */

function refresh() {
  revalidatePath("/discover");
}

function labelOf(id: LeadSource) {
  return getSource(id)?.label ?? SOURCE_LABELS[id];
}

function idField(formData: FormData, name: string): string | null {
  const value = field(formData, name);
  return isUuid(value) ? value : null;
}

/* ---------- Refresh ---------- */

/** "Refresh now" (every active search) or "Run now" (one search, `searchId`). */
export async function refreshAction(_state: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const userId = await requireOwnerId();
  const db = requireDatabase();
  const raw = field(formData, "searchId");
  const searchId = idField(formData, "searchId");
  if (raw && !searchId) return fail("That search wasn't found.");
  try {
    const summary = await refreshSearches(db, userId, { force: true, searchId: searchId ?? undefined, mode: field(formData, "mode") === "explore" ? "explore" : "priority" });
    refresh();
    return ok(refreshMessage(summary, labelOf));
  } catch (error) {
    return fail(aiErrorMessage(error));
  }
}

/* ---------- Saved searches ---------- */

export async function createSearchAction(_state: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const userId = await requireOwnerId();
  const db = requireDatabase();
  try {
    const search = await createSearch(db, userId, searchInputFromForm(formData));
    refresh();
    return ok(`Added “${search.name}”. Press Run now or Refresh now to fetch postings.`);
  } catch (error) {
    return fail(aiErrorMessage(error));
  }
}

export async function updateSearchAction(_state: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const userId = await requireOwnerId();
  const db = requireDatabase();
  const id = idField(formData, "searchId");
  if (!id) return fail("That search wasn't found.");
  try {
    await updateSearch(db, userId, id, searchInputFromForm(formData));
    refresh();
    return ok("Saved.");
  } catch (error) {
    return fail(aiErrorMessage(error));
  }
}

export async function setSearchActiveAction(_state: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const userId = await requireOwnerId();
  const db = requireDatabase();
  const id = idField(formData, "searchId");
  if (!id) return fail("That search wasn't found.");
  try {
    await setSearchActive(db, userId, id, field(formData, "active") === "true");
    refresh();
    return ok();
  } catch (error) {
    return fail(aiErrorMessage(error));
  }
}

export async function deleteSearchAction(_state: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const userId = await requireOwnerId();
  const db = requireDatabase();
  const id = idField(formData, "searchId");
  if (!id) return fail("That search wasn't found.");
  try {
    await deleteSearch(db, userId, id);
    refresh();
    return ok("Deleted. Postings it found stay in your inbox.");
  } catch (error) {
    return fail(aiErrorMessage(error));
  }
}

/** Adds the profile-based starter searches (skipping any that already exist). */
export async function addSuggestedSearchesAction(): Promise<ActionResult> {
  const userId = await requireOwnerId();
  const db = requireDatabase();
  try {
    const [profile, existing] = await Promise.all([getProfile(db, userId), listSearches(db, userId, "priority")]);
    const have = new Set(existing.map((s) => `${s.query.toLowerCase()}|${s.location.toLowerCase()}`));
    const toAdd = suggestedSearches(profile?.targetRoles ?? [], profile?.targetLocations ?? []).filter(
      (s) => !have.has(`${s.query.toLowerCase()}|${(s.location ?? "").toLowerCase()}`),
    );
    for (const input of toAdd) await createSearch(db, userId, input);
    refresh();
    if (!toAdd.length) return ok("Those searches are already saved.");
    return ok(`Added ${toAdd.length} search${toAdd.length === 1 ? "" : "es"}. Press Refresh now to fetch postings.`);
  } catch (error) {
    return fail(aiErrorMessage(error));
  }
}

/* ---------- Leads ---------- */

/**
 * Save to pipeline: the lead becomes a job (and a "saved" application), Claude
 * analyzes it when connected, and the owner lands on the job page. Saving a
 * lead that's already a job just opens that job.
 */
export async function saveLeadAction(_state: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const userId = await requireOwnerId();
  const db = requireDatabase();
  const leadId = idField(formData, "leadId");
  if (!leadId) return fail("That posting wasn't found.");
  let jobId: string;
  let isNew: boolean;
  try {
    const lead = await getLead(db, userId, leadId);
    if (!lead) return fail("That posting wasn't found.");
    isNew = !lead.jobId;
    jobId = await saveLeadToPipeline(db, userId, leadId);
  } catch (error) {
    return fail(aiErrorMessage(error));
  }

  // The job is saved either way; an analysis failure shows on its page.
  let analysisError = "";
  if (isNew && aiConfigured()) {
    try {
      await analyzeJob(db, userId, jobId);
    } catch (error) {
      analysisError = aiErrorMessage(error);
    }
  }
  refresh();
  revalidatePath("/jobs");
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/applications");
  revalidatePath("/");
  redirect(analysisError ? `/jobs/${jobId}?error=${encodeURIComponent(analysisError.slice(0, 300))}` : `/jobs/${jobId}`);
}

/** Dismiss (`status=dismissed`) or restore (`status=new`) one lead. */
export async function setLeadStatusAction(_state: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const userId = await requireOwnerId();
  const db = requireDatabase();
  const leadId = idField(formData, "leadId");
  if (!leadId) return fail("That posting wasn't found.");
  const status = field(formData, "status") === "new" ? "new" : "dismissed";
  try {
    await setLeadStatus(db, userId, leadId, status);
    refresh();
    return ok(status === "new" ? "Restored to New." : "Dismissed.");
  } catch (error) {
    return fail(aiErrorMessage(error));
  }
}

/** "Dismiss all shown": only leads still marked New are touched. */
export async function dismissLeadsAction(_state: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const userId = await requireOwnerId();
  const db = requireDatabase();
  const ids = formData
    .getAll("leadId")
    .filter((value): value is string => typeof value === "string" && isUuid(value))
    .slice(0, 500);
  if (!ids.length) return fail("Nothing to dismiss.");
  try {
    await dismissLeads(db, userId, ids);
    refresh();
    return ok(`Dismissed ${ids.length} posting${ids.length === 1 ? "" : "s"}.`);
  } catch (error) {
    return fail(aiErrorMessage(error));
  }
}

export async function suggestDirectionsAction(): Promise<ActionResult> {
  const userId = await requireOwnerId();
  const db = requireDatabase();
  try {
    const directions = await suggestDirections(db, userId);
    refresh();
    return ok(`Suggested ${directions.length} direction${directions.length === 1 ? "" : "s"}. Review a search before adding it.`);
  } catch (error) { return fail(aiErrorMessage(error)); }
}

export async function checkFitAction(_state: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const userId = await requireOwnerId();
  const db = requireDatabase();
  const id = idField(formData, "leadId");
  if (!id) return fail("Posting not found.");
  try {
    await reviewDiscoverFit(db, userId, id);
    refresh();
    return ok("Fit review ready. Expand Your fit review below.");
  } catch (error) { return fail(aiErrorMessage(error)); }
}
