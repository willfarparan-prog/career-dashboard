"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireDatabase } from "@/db";
import { fail, field, type ActionResult } from "@/lib/action-result";
import { requireOwnerId } from "@/lib/auth/owner";
import type { ExtractInput } from "@/lib/ai/tasks/extract";
import { acceptImport, discardImport, importResume, readUpload } from "@/lib/career/imports";
import { careerErrorMessage } from "@/lib/career/util";

type Prev = ActionResult | null;

/** Paste or upload → Claude extraction → pending import → review page. */
export async function startImportAction(_: Prev, formData: FormData): Promise<ActionResult> {
  const userId = await requireOwnerId();
  const file = formData.get("file");
  const text = field(formData, "text");
  let id: string;
  try {
    let input: ExtractInput;
    if (file instanceof File && file.size > 0) input = await readUpload(file);
    else if (text) input = { kind: "text", text };
    else return fail("Paste your resume text or choose a PDF or Word file.");
    const outcome = await importResume(requireDatabase(), userId, input);
    if (!outcome.ok) {
      revalidatePath("/profile/import");
      return fail(outcome.error);
    }
    id = outcome.id;
  } catch (error) {
    return fail(careerErrorMessage(error, "Couldn't read that resume. Please try again."));
  }
  revalidatePath("/profile/import");
  redirect(`/profile/import/${id}`);
}

export async function acceptImportAction(_: Prev, formData: FormData): Promise<ActionResult> {
  const userId = await requireOwnerId();
  const id = field(formData, "id");
  const accepted = formData.getAll("accept").filter((value): value is string => typeof value === "string");
  let query: string;
  try {
    const summary = await acceptImport(requireDatabase(), userId, id, accepted);
    query = new URLSearchParams({
      roles: String(summary.rolesCreated),
      reused: String(summary.rolesReused),
      achievements: String(summary.achievements),
      skipped: String(summary.achievementsSkipped),
      skills: String(summary.skills),
      credentials: String(summary.credentials),
      profile: String(summary.profileFields),
    }).toString();
  } catch (error) {
    return fail(careerErrorMessage(error, "Couldn't add these to your library. Please try again."));
  }
  revalidatePath("/profile");
  revalidatePath("/achievements");
  revalidatePath("/profile/import");
  redirect(`/profile/import/${id}?${query}`);
}

export async function discardImportAction(_: Prev, formData: FormData): Promise<ActionResult> {
  const userId = await requireOwnerId();
  try {
    await discardImport(requireDatabase(), userId, field(formData, "id"));
  } catch (error) {
    return fail(careerErrorMessage(error));
  }
  revalidatePath("/profile/import");
  redirect("/profile/import");
}
