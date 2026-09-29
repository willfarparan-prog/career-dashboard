"use server";

import { revalidatePath } from "next/cache";
import { requireDatabase } from "@/db";
import { fail, field, ok, type ActionResult } from "@/lib/action-result";
import { submittedAtFromDay } from "@/lib/applications/dates";
import { markApplied } from "@/lib/applications/mark-applied";
import { isApplicationStatus, updateApplication, type ApplicationPatch } from "@/lib/applications/update";
import { requireOwnerId } from "@/lib/auth/owner";

function refresh(applicationId: string, jobId: string) {
  revalidatePath("/applications");
  revalidatePath(`/applications/${applicationId}`);
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/");
}

async function save(applicationId: string, patch: ApplicationPatch, message: string): Promise<ActionResult> {
  const userId = await requireOwnerId();
  const db = requireDatabase();
  const result = await updateApplication(db, userId, applicationId, patch);
  if (!result.ok) return fail(result.error);
  refresh(result.application.id, result.application.jobId);
  return ok(message);
}

export async function updateStatusAction(_: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const status = field(formData, "status");
  if (!isApplicationStatus(status)) return fail("Pick a valid status.");
  return save(field(formData, "applicationId"), { status }, "Status updated.");
}

export async function updateNextActionAction(_: ActionResult | null, formData: FormData): Promise<ActionResult> {
  return save(
    field(formData, "applicationId"),
    { nextAction: field(formData, "nextAction"), nextActionDate: field(formData, "nextActionDate") },
    "Next action saved.",
  );
}

export async function updateApplicationAction(_: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const status = field(formData, "status");
  if (status && !isApplicationStatus(status)) return fail("Pick a valid status.");
  return save(
    field(formData, "applicationId"),
    {
      ...(isApplicationStatus(status) ? { status } : {}),
      source: field(formData, "source"),
      nextAction: field(formData, "nextAction"),
      nextActionDate: field(formData, "nextActionDate"),
      contactName: field(formData, "contactName"),
      contactEmail: field(formData, "contactEmail"),
      contactNote: field(formData, "contactNote"),
      notes: field(formData, "notes"),
    },
    "Saved.",
  );
}

export async function markAppliedAction(_: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const userId = await requireOwnerId();
  const db = requireDatabase();
  const day = field(formData, "submittedOn");
  const submittedAt = day ? submittedAtFromDay(day) : new Date();
  if (!submittedAt) return fail("Use a date like 2026-09-29 for the day you applied.");
  const resumeDraftId = field(formData, "resumeDraftId");
  if (!resumeDraftId) return fail("Choose the resume you sent.");

  const result = await markApplied(db, userId, field(formData, "applicationId"), {
    resumeDraftId,
    coverLetterId: field(formData, "coverLetterId") || null,
    submittedAt,
    source: field(formData, "source"),
  });
  if (!result.ok) return fail(result.error);
  refresh(result.application.id, result.application.jobId);
  return ok(["Marked as applied. Exact copies of what you sent are saved.", ...result.warnings].join(" "));
}
