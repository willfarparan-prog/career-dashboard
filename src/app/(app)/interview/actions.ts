"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireDatabase } from "@/db";
import type { FactStatus, InterviewOutcome, InterviewStage, StoryFormat } from "@/db/schema";
import { fail, field, ok, type ActionResult } from "@/lib/action-result";
import { AiError } from "@/lib/ai/run";
import { practiceAnswer } from "@/lib/ai/tasks/feedback";
import { generatePrep } from "@/lib/ai/tasks/prep";
import { draftStory, type StoryDraft } from "@/lib/ai/tasks/story";
import { requireOwnerId } from "@/lib/auth/owner";
import { isUuid } from "@/lib/export/formats";
import { addInterview, deleteInterview, updateInterview, type InterviewInput } from "@/lib/interview/interviews";
import { saveCompanyNotes } from "@/lib/interview/prep";
import { createStory, deleteStory, InterviewInputError, updateStory, type StoryInput } from "@/lib/interview/stories";

type Prev = ActionResult | null;

function failure(error: unknown, fallback: string): ActionResult {
  if (error instanceof InterviewInputError || error instanceof AiError) return fail(error.message);
  console.error(error);
  return fail(fallback);
}

const optionalUuid = (value: string) => (value && isUuid(value) ? value : null);

// ── Stories ─────────────────────────────────────────────────────────────

function parseStory(formData: FormData): StoryInput {
  return {
    title: field(formData, "title"),
    achievementId: optionalUuid(field(formData, "achievementId")),
    format: (field(formData, "format") || "star") as StoryFormat,
    situation: field(formData, "situation"),
    task: field(formData, "task"),
    action: field(formData, "action"),
    result: field(formData, "result"),
    body: field(formData, "body"),
    competencies: formData.getAll("competencies").filter((value): value is string => typeof value === "string"),
    factStatus: (field(formData, "factStatus") || "needs_confirmation") as FactStatus,
  };
}

export async function createStoryAction(_: Prev, formData: FormData): Promise<ActionResult> {
  try {
    const userId = await requireOwnerId();
    await createStory(requireDatabase(), userId, parseStory(formData));
  } catch (error) {
    return failure(error, "Couldn't save the story. Please try again.");
  }
  revalidatePath("/interview");
  redirect("/interview#stories");
}

export async function updateStoryAction(_: Prev, formData: FormData): Promise<ActionResult> {
  const id = field(formData, "id");
  try {
    const userId = await requireOwnerId();
    if (!isUuid(id)) return fail("That story wasn't found.");
    const story = await updateStory(requireDatabase(), userId, id, parseStory(formData));
    if (!story) return fail("That story wasn't found.");
  } catch (error) {
    return failure(error, "Couldn't save the story. Please try again.");
  }
  revalidatePath("/interview");
  revalidatePath(`/interview/stories/${id}`);
  return ok("Saved.");
}

export async function deleteStoryAction(_: Prev, formData: FormData): Promise<ActionResult> {
  try {
    const userId = await requireOwnerId();
    const id = field(formData, "id");
    if (!isUuid(id) || !(await deleteStory(requireDatabase(), userId, id))) return fail("That story wasn't found.");
  } catch (error) {
    return failure(error, "Couldn't delete the story.");
  }
  revalidatePath("/interview");
  redirect("/interview#stories");
}

export type DraftStoryResult = { ok: true; draft: StoryDraft; achievementId: string; at: number } | { ok: false; error: string };

/** Drafts a story from an achievement. Returns the draft to fill the form; saves nothing. */
export async function draftStoryAction(_: DraftStoryResult | null, formData: FormData): Promise<DraftStoryResult> {
  try {
    const userId = await requireOwnerId();
    const achievementId = field(formData, "achievementId");
    if (!isUuid(achievementId)) return { ok: false, error: "Pick an achievement to draft from." };
    const { draft } = await draftStory(requireDatabase(), userId, achievementId);
    revalidatePath("/activity");
    return { ok: true, draft, achievementId, at: Date.now() };
  } catch (error) {
    const result = failure(error, "Couldn't draft the story. Please try again.");
    return { ok: false, error: result.ok ? "" : result.error };
  }
}

// ── Practice ────────────────────────────────────────────────────────────

export async function practiceAction(_: Prev, formData: FormData): Promise<ActionResult> {
  let attemptId: string;
  try {
    const userId = await requireOwnerId();
    const attempt = await practiceAnswer(requireDatabase(), userId, {
      question: field(formData, "question"),
      answer: field(formData, "answer"),
      competency: field(formData, "competency"),
      jobId: optionalUuid(field(formData, "jobId")),
    });
    attemptId = attempt.id;
  } catch (error) {
    return failure(error, "Couldn't get feedback. Please try again.");
  }
  revalidatePath("/interview");
  redirect(`/interview/practice/${attemptId}`);
}

// ── Per-job prep and rounds ─────────────────────────────────────────────

function refreshJob(jobId: string) {
  revalidatePath(`/jobs/${jobId}/interview`);
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/");
}

export async function generatePrepAction(jobId: string, _: Prev, formData: FormData): Promise<ActionResult> {
  void formData;
  try {
    const userId = await requireOwnerId();
    if (!isUuid(jobId)) return fail("That job wasn't found.");
    await generatePrep(requireDatabase(), userId, jobId);
  } catch (error) {
    return failure(error, "Couldn't build the prep pack. Please try again.");
  }
  refreshJob(jobId);
  return ok("Prep pack ready. Check each suggested story actually answers its question.");
}

export async function saveCompanyNotesAction(jobId: string, _: Prev, formData: FormData): Promise<ActionResult> {
  try {
    const userId = await requireOwnerId();
    if (!isUuid(jobId)) return fail("That job wasn't found.");
    await saveCompanyNotes(requireDatabase(), userId, jobId, field(formData, "companyNotes"));
  } catch (error) {
    return failure(error, "Couldn't save your notes.");
  }
  refreshJob(jobId);
  return ok("Saved.");
}

function parseRound(formData: FormData): InterviewInput {
  return {
    stage: (field(formData, "stage") || "other") as InterviewStage,
    date: field(formData, "date"),
    interviewers: field(formData, "interviewers"),
    notes: field(formData, "notes"),
    debrief: field(formData, "debrief"),
    thankYouSent: formData.get("thankYouSent") === "on",
    outcome: (field(formData, "outcome") || "pending") as InterviewOutcome,
  };
}

export async function addRoundAction(jobId: string, _: Prev, formData: FormData): Promise<ActionResult> {
  try {
    const userId = await requireOwnerId();
    if (!isUuid(jobId)) return fail("That job wasn't found.");
    await addInterview(requireDatabase(), userId, jobId, parseRound(formData));
  } catch (error) {
    return failure(error, "Couldn't add the round.");
  }
  refreshJob(jobId);
  return ok("Round added.");
}

export async function updateRoundAction(_: Prev, formData: FormData): Promise<ActionResult> {
  try {
    const userId = await requireOwnerId();
    const id = field(formData, "id");
    if (!isUuid(id)) return fail("That round wasn't found.");
    const round = await updateInterview(requireDatabase(), userId, id, parseRound(formData));
    if (!round) return fail("That round wasn't found.");
    refreshJob(round.jobId);
  } catch (error) {
    return failure(error, "Couldn't save the round.");
  }
  return ok("Saved.");
}

export async function deleteRoundAction(_: Prev, formData: FormData): Promise<ActionResult> {
  try {
    const userId = await requireOwnerId();
    const id = field(formData, "id");
    if (!isUuid(id)) return fail("That round wasn't found.");
    const round = await deleteInterview(requireDatabase(), userId, id);
    if (!round) return fail("That round wasn't found.");
    refreshJob(round.jobId);
  } catch (error) {
    return failure(error, "Couldn't delete the round.");
  }
  return ok("Deleted.");
}
