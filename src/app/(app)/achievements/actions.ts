"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireDatabase } from "@/db";
import { fail, field, ok, type ActionResult } from "@/lib/action-result";
import { requireOwnerId } from "@/lib/auth/owner";
import { createAchievement, deleteAchievement, updateAchievement } from "@/lib/career/achievements";
import { parseAchievementForm } from "@/lib/career/forms";
import { careerErrorMessage } from "@/lib/career/util";

type Prev = ActionResult | null;

function refresh() {
  revalidatePath("/achievements");
  revalidatePath("/profile");
}

export async function createAchievementAction(_: Prev, formData: FormData): Promise<ActionResult> {
  const userId = await requireOwnerId();
  try {
    await createAchievement(requireDatabase(), userId, parseAchievementForm(formData));
  } catch (error) {
    return fail(careerErrorMessage(error));
  }
  refresh();
  redirect("/achievements");
}

export async function updateAchievementAction(_: Prev, formData: FormData): Promise<ActionResult> {
  const userId = await requireOwnerId();
  const id = field(formData, "id");
  try {
    await updateAchievement(requireDatabase(), userId, id, parseAchievementForm(formData));
  } catch (error) {
    return fail(careerErrorMessage(error));
  }
  refresh();
  revalidatePath(`/achievements/${id}`);
  return ok("Saved.");
}

export async function deleteAchievementAction(_: Prev, formData: FormData): Promise<ActionResult> {
  const userId = await requireOwnerId();
  try {
    await deleteAchievement(requireDatabase(), userId, field(formData, "id"));
  } catch (error) {
    return fail(careerErrorMessage(error, "Couldn't delete that. Please try again."));
  }
  refresh();
  redirect("/achievements");
}
