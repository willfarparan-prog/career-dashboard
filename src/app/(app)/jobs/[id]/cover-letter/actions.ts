"use server";

import { revalidatePath } from "next/cache";
import { requireDatabase } from "@/db";
import { fail, field, ok, type ActionResult } from "@/lib/action-result";
import { AiError } from "@/lib/ai/run";
import { draftCoverLetter } from "@/lib/ai/tasks/cover";
import { requireOwnerId } from "@/lib/auth/owner";
import { CoverLetterError, deleteCoverLetter, setCoverLetterStatus, updateCoverLetterParagraphs, type CoverLetterStatus } from "@/lib/cover/letters";
import { isUuid } from "@/lib/export/formats";

function refresh(jobId: string) {
  revalidatePath(`/jobs/${jobId}/cover-letter`);
  revalidatePath(`/jobs/${jobId}`);
}

function failure(error: unknown, fallback: string): ActionResult {
  if (error instanceof CoverLetterError || error instanceof AiError) return fail(error.message);
  console.error(error);
  return fail(fallback);
}

export async function generateCoverLetterAction(jobId: string, _state: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const userId = await requireOwnerId();
    if (!isUuid(jobId)) return fail("That job wasn't found.");
    const choice = field(formData, "draftId");
    if (choice && choice !== "none" && !isUuid(choice)) return fail("That resume draft wasn't found.");
    const draftId = choice === "none" ? null : choice || undefined;
    const letter = await draftCoverLetter(requireDatabase(), userId, jobId, { draftId, tone: field(formData, "tone") });
    refresh(letter.jobId);
    return ok("New letter drafted. Read each paragraph before you approve it.");
  } catch (error) {
    return failure(error, "Couldn't draft the letter. Please try again.");
  }
}

export async function saveCoverLetterAction(letterId: string, _state: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const userId = await requireOwnerId();
    if (!isUuid(letterId)) return fail("That letter wasn't found.");
    const texts = formData.getAll("paragraph").map((value) => (typeof value === "string" ? value : ""));
    const letter = await updateCoverLetterParagraphs(requireDatabase(), userId, letterId, texts);
    if (!letter) return fail("That letter wasn't found.");
    refresh(letter.jobId);
    return ok("Saved.");
  } catch (error) {
    return failure(error, "Couldn't save the letter.");
  }
}

export async function setCoverLetterStatusAction(letterId: string, status: CoverLetterStatus, _state: ActionResult | null, formData: FormData): Promise<ActionResult> {
  void formData;
  try {
    const userId = await requireOwnerId();
    if (!isUuid(letterId)) return fail("That letter wasn't found.");
    const letter = await setCoverLetterStatus(requireDatabase(), userId, letterId, status === "approved" ? "approved" : "draft");
    if (!letter) return fail("That letter wasn't found.");
    refresh(letter.jobId);
    return ok(letter.status === "approved" ? "Approved." : "Back to draft.");
  } catch (error) {
    return failure(error, "Couldn't update the letter.");
  }
}

export async function deleteCoverLetterAction(letterId: string, _state: ActionResult | null, formData: FormData): Promise<ActionResult> {
  void formData;
  try {
    const userId = await requireOwnerId();
    if (!isUuid(letterId)) return fail("That letter wasn't found.");
    const letter = await deleteCoverLetter(requireDatabase(), userId, letterId);
    if (!letter) return fail("That letter wasn't found.");
    refresh(letter.jobId);
    return ok("Deleted.");
  } catch (error) {
    return failure(error, "Couldn't delete the letter.");
  }
}
