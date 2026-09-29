"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireDatabase } from "@/db";
import { BULLET_STATES, CAREER_PATHS, type BulletState, type CareerPath } from "@/db/schema";
import { fail, field, ok, type ActionResult } from "@/lib/action-result";
import { aiErrorMessage } from "@/lib/ai/run";
import { requireOwnerId } from "@/lib/auth/owner";
import * as drafts from "@/lib/drafts/service";

type State = ActionResult | null;

function refresh() {
  revalidatePath("/jobs", "layout");
  revalidatePath("/");
}

/** Runs an edit for the signed-in owner and turns any failure into a form error. */
async function attempt(run: (db: ReturnType<typeof requireDatabase>, userId: string) => Promise<unknown>, message?: string): Promise<ActionResult> {
  try {
    const userId = await requireOwnerId();
    await run(requireDatabase(), userId);
  } catch (error) {
    return fail(aiErrorMessage(error));
  }
  refresh();
  return ok(message);
}

export async function generateDraftAction(_: State, formData: FormData): Promise<ActionResult> {
  const jobId = field(formData, "jobId");
  const pathValue = field(formData, "careerPath");
  const careerPath = (CAREER_PATHS as readonly string[]).includes(pathValue) ? (pathValue as CareerPath) : undefined;
  let draftId: string;
  try {
    const userId = await requireOwnerId();
    draftId = await drafts.generateDraft(requireDatabase(), userId, jobId, {
      careerPath,
      emphasis: field(formData, "emphasis"),
      useClaude: field(formData, "mode") !== "library",
    });
  } catch (error) {
    return fail(aiErrorMessage(error));
  }
  refresh();
  redirect(`/jobs/${jobId}/resume/${draftId}`);
}

export async function bulletTextAction(_: State, formData: FormData) {
  return attempt((db, userId) => drafts.updateBulletText(db, userId, field(formData, "bulletId"), field(formData, "text")), "Saved.");
}

export async function bulletStateAction(_: State, formData: FormData) {
  const state = field(formData, "state");
  if (!(BULLET_STATES as readonly string[]).includes(state)) return fail("Unknown state.");
  return attempt((db, userId) => drafts.setBulletState(db, userId, field(formData, "bulletId"), state as BulletState));
}

export async function revertBulletAction(_: State, formData: FormData) {
  return attempt((db, userId) => drafts.revertBullet(db, userId, field(formData, "bulletId")), "Back to the original wording.");
}

export async function moveBulletAction(_: State, formData: FormData) {
  const direction = field(formData, "direction") === "up" ? "up" : "down";
  return attempt((db, userId) => drafts.moveBullet(db, userId, field(formData, "bulletId"), direction));
}

export async function regenerateBulletAction(_: State, formData: FormData) {
  return attempt(
    (db, userId) =>
      drafts.regenerateBullet(db, userId, field(formData, "bulletId"), {
        tone: field(formData, "tone") || "plain",
        length: field(formData, "length") || "same",
        emphasis: field(formData, "emphasis") || "outcome",
      }),
    "New wording proposed. Accept it or edit it.",
  );
}

export async function addBulletAction(_: State, formData: FormData) {
  const achievementId = field(formData, "achievementId");
  if (!achievementId) return fail("Pick an achievement.");
  return attempt((db, userId) => drafts.addBulletFromAchievement(db, userId, field(formData, "draftId"), achievementId), "Added.");
}

export async function summaryAction(_: State, formData: FormData) {
  return attempt((db, userId) => drafts.updateSummary(db, userId, field(formData, "draftId"), field(formData, "summary"), formData.get("locked") === "on"), "Summary saved.");
}

export async function skillsAction(_: State, formData: FormData) {
  const names = field(formData, "skills").split(/[\n,]/);
  return attempt((db, userId) => drafts.updateSkills(db, userId, field(formData, "draftId"), names), "Skills saved.");
}

export async function runChecksAction(_: State, formData: FormData) {
  return attempt((db, userId) => drafts.runChecks(db, userId, field(formData, "draftId")), "Checks re-run.");
}

export async function reviewAction(_: State, formData: FormData) {
  return attempt((db, userId) => drafts.reviewDraft(db, userId, field(formData, "draftId")), "Claude's review is in.");
}

export async function findingAction(_: State, formData: FormData) {
  const ids = formData.getAll("findingId").filter((id): id is string => typeof id === "string" && Boolean(id));
  const resolved = field(formData, "resolved") === "true";
  return attempt(async (db, userId) => {
    for (const id of ids) await drafts.setFindingResolved(db, userId, id, resolved);
  });
}

export async function approveAction(_: State, formData: FormData) {
  return attempt((db, userId) => drafts.approveDraft(db, userId, field(formData, "draftId")), "Approved. Export it or mark the job applied to freeze this version.");
}

export async function reopenAction(_: State, formData: FormData) {
  return attempt((db, userId) => drafts.reopenDraft(db, userId, field(formData, "draftId")), "Back to draft.");
}

export async function renameAction(_: State, formData: FormData) {
  return attempt((db, userId) => drafts.renameDraft(db, userId, field(formData, "draftId"), field(formData, "name")), "Renamed.");
}

export async function duplicateAction(_: State, formData: FormData): Promise<ActionResult> {
  const jobId = field(formData, "jobId");
  let copyId: string;
  try {
    const userId = await requireOwnerId();
    copyId = await drafts.duplicateDraft(requireDatabase(), userId, field(formData, "draftId"));
  } catch (error) {
    return fail(aiErrorMessage(error));
  }
  refresh();
  redirect(`/jobs/${jobId}/resume/${copyId}`);
}

export async function deleteDraftAction(_: State, formData: FormData): Promise<ActionResult> {
  const jobId = field(formData, "jobId");
  try {
    const userId = await requireOwnerId();
    await drafts.deleteDraft(requireDatabase(), userId, field(formData, "draftId"));
  } catch (error) {
    return fail(aiErrorMessage(error));
  }
  refresh();
  redirect(`/jobs/${jobId}`);
}
