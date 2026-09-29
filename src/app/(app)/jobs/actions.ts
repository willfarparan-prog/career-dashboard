"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireDatabase } from "@/db";
import { fail, field, intField, ok, type ActionResult } from "@/lib/action-result";
import { aiConfigured, aiErrorMessage } from "@/lib/ai/run";
import { analyzeJob } from "@/lib/ai/tasks/analyze";
import { matchEvidence } from "@/lib/ai/tasks/match";
import { createJob, deleteJob, overrideRequirementLabel, setPostingStatus, updateJobFit } from "@/lib/jobs/jobs";
import { requireOwnerId } from "@/lib/auth/owner";

function refresh(jobId?: string) {
  revalidatePath("/jobs");
  if (jobId) revalidatePath(`/jobs/${jobId}`);
}

export async function createJobAction(_state: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const userId = await requireOwnerId();
  const db = requireDatabase();
  let jobId: string;
  try {
    const job = await createJob(db, userId, {
      postingText: field(formData, "postingText"),
      sourceUrl: field(formData, "sourceUrl"),
      company: field(formData, "company"),
      title: field(formData, "title"),
      location: field(formData, "location"),
      compText: field(formData, "compText"),
      deadline: field(formData, "deadline"),
      requisitionId: field(formData, "requisitionId"),
      interest: intField(formData, "interest"),
      growth: intField(formData, "growth"),
      companySize: field(formData, "companySize"),
    });
    jobId = job.id;
  } catch (error) {
    return fail(aiErrorMessage(error));
  }

  // The job is saved either way; an analysis failure shows on its page.
  let analysisError = "";
  if (aiConfigured()) {
    try {
      await analyzeJob(db, userId, jobId);
    } catch (error) {
      analysisError = aiErrorMessage(error);
    }
  }
  refresh(jobId);
  revalidatePath("/applications");
  revalidatePath("/");
  redirect(analysisError ? `/jobs/${jobId}?error=${encodeURIComponent(analysisError.slice(0, 300))}` : `/jobs/${jobId}`);
}

export async function analyzeJobAction(_state: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const userId = await requireOwnerId();
  const db = requireDatabase();
  const jobId = field(formData, "jobId");
  try {
    const { requirements } = await analyzeJob(db, userId, jobId);
    refresh(jobId);
    return ok(`Analyzed. Found ${requirements} requirement${requirements === 1 ? "" : "s"}.`);
  } catch (error) {
    return fail(aiErrorMessage(error));
  }
}

export async function matchEvidenceAction(_state: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const userId = await requireOwnerId();
  const db = requireDatabase();
  const jobId = field(formData, "jobId");
  try {
    const counts = await matchEvidence(db, userId, jobId);
    refresh(jobId);
    const skipped = counts.skipped ? ` Kept your ${counts.skipped} manual label${counts.skipped === 1 ? "" : "s"}.` : "";
    return ok(`Matched: ${counts.strong} strong, ${counts.transferable} transferable, ${counts.gap} gap${counts.gap === 1 ? "" : "s"}.${skipped}`);
  } catch (error) {
    return fail(aiErrorMessage(error));
  }
}

export async function updateFitAction(_state: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const userId = await requireOwnerId();
  const db = requireDatabase();
  const jobId = field(formData, "jobId");
  try {
    await updateJobFit(db, userId, jobId, {
      interest: intField(formData, "interest"),
      growth: intField(formData, "growth"),
      companySize: field(formData, "companySize"),
      careerPath: field(formData, "careerPath"),
    });
    refresh(jobId);
    return ok("Saved.");
  } catch (error) {
    return fail(aiErrorMessage(error));
  }
}

export async function postingStatusAction(_state: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const userId = await requireOwnerId();
  const db = requireDatabase();
  const jobId = field(formData, "jobId");
  try {
    await setPostingStatus(db, userId, jobId, field(formData, "postingStatus"));
    refresh(jobId);
    return ok();
  } catch (error) {
    return fail(aiErrorMessage(error));
  }
}

export async function overrideLabelAction(_state: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const userId = await requireOwnerId();
  const db = requireDatabase();
  try {
    const { jobId } = await overrideRequirementLabel(db, userId, field(formData, "requirementId"), field(formData, "label"));
    refresh(jobId);
    return ok();
  } catch (error) {
    return fail(aiErrorMessage(error));
  }
}

export async function deleteJobAction(_state: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const userId = await requireOwnerId();
  const db = requireDatabase();
  const jobId = field(formData, "jobId");
  try {
    await deleteJob(db, userId, jobId);
  } catch (error) {
    return fail(aiErrorMessage(error));
  }
  refresh();
  revalidatePath("/applications");
  revalidatePath("/");
  redirect("/jobs");
}
