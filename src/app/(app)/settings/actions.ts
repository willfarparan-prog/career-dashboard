"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireDatabase } from "@/db";
import { fail, field, ok, type ActionResult } from "@/lib/action-result";
import { requireOwnerId } from "@/lib/auth/owner";
import { purgeUserData } from "@/lib/settings/data";
import { clearImportText, updatePrivacySettings } from "@/lib/settings/privacy";

export async function savePrivacyAction(_: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const userId = await requireOwnerId();
  await updatePrivacySettings(requireDatabase(), userId, {
    sendPrivateToClaude: formData.get("sendPrivateToClaude") === "on",
    keepImportText: formData.get("keepImportText") === "on",
  });
  revalidatePath("/settings");
  return ok("Privacy settings saved.");
}

export async function clearImportTextAction(): Promise<ActionResult> {
  const userId = await requireOwnerId();
  const cleared = await clearImportText(requireDatabase(), userId);
  revalidatePath("/settings");
  revalidatePath("/profile/import");
  return ok(cleared ? `Cleared the stored text of ${cleared} ${cleared === 1 ? "import" : "imports"}.` : "There was no stored import text.");
}

export async function deleteEverythingAction(_: ActionResult | null, formData: FormData): Promise<ActionResult> {
  if (field(formData, "confirm") !== "DELETE") return fail("Type DELETE in capitals to confirm.");
  const userId = await requireOwnerId();
  await purgeUserData(requireDatabase(), userId);
  revalidatePath("/", "layout");
  redirect("/");
}
