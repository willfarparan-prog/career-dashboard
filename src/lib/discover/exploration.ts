import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Database } from "@/db";
import { careerExplorations, leadFitReviews } from "@/db/schema";
import { buildLibraryContext, loadLibrary } from "@/lib/ai/library";
import { EXPLORE_PREFERENCES } from "./explore-types";
import { getLead, type JobLead } from "./leads";

export async function explorationInputs(db: Database, userId: string) {
  const library = await loadLibrary(db, userId);
  const context = buildLibraryContext(library);
  const preferences = { ...EXPLORE_PREFERENCES, minimumPay: library.profile?.compMin ?? null,
    locations: library.profile?.targetLocations ?? [], remoteOk: library.profile?.remoteOk ?? true };
  return { library, context, preferences };
}
export type ExplorationInputs = Awaited<ReturnType<typeof explorationInputs>>;

export function requireExperience(inputs: ExplorationInputs) {
  if (!inputs.context.roleByAlias.size && !inputs.context.shared.length) {
    throw new Error("Add a role or achievement to your career library before requesting personalized suggestions or reviews.");
  }
}

export function explorationFingerprint(inputs: ExplorationInputs, version: string, lead?: JobLead) {
  return createHash("sha256").update(JSON.stringify({ version, library: inputs.context.text, preferences: inputs.preferences,
    posting: lead ? { title: lead.title, company: lead.company, description: lead.description, location: lead.location,
      remote: lead.isRemote, salaryMin: lead.salaryMin, salaryMax: lead.salaryMax, salaryText: lead.salaryText, salaryProvenance: lead.salaryProvenance } : null,
  })).digest("hex");
}

export async function getExploration(db: Database, userId: string) {
  const [row] = await db.select().from(careerExplorations).where(eq(careerExplorations.userId, userId));
  return row ?? null;
}

export async function fitReviewInputs(db: Database, userId: string, leadId: string) {
  const [inputs, lead] = await Promise.all([explorationInputs(db, userId), getLead(db, userId, leadId)]);
  if (!lead) throw new Error("Posting not found.");
  return { ...inputs, lead };
}

export async function getFitReviews(db: Database, userId: string) {
  return db.select().from(leadFitReviews).where(eq(leadFitReviews.userId, userId));
}

export async function getFitReview(db: Database, userId: string, leadId: string) {
  const [row] = await db.select().from(leadFitReviews).where(and(eq(leadFitReviews.userId, userId), eq(leadFitReviews.leadId, leadId)));
  return row ?? null;
}
