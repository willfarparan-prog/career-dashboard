"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireDatabase } from "@/db";
import { credentials, type LearningStatus } from "@/db/schema";
import { RESOURCES } from "@/content/learn/resources";
import { fail, field, ok, type ActionResult } from "@/lib/action-result";
import { requireOwnerId } from "@/lib/auth/owner";
import { createCredential } from "@/lib/career/credentials";
import { LearnInputError, setProgress } from "@/lib/learn/progress";

type Prev = ActionResult | null;

/** Sets (or, with an empty status, clears) progress on one piece of Learn content. */
export async function setProgressAction(_: Prev, formData: FormData): Promise<ActionResult> {
  const userId = await requireOwnerId();
  const status = field(formData, "status");
  try {
    // setProgress refuses anything that isn't a real status.
    await setProgress(requireDatabase(), userId, field(formData, "key"), status === "" ? null : (status as LearningStatus));
  } catch (error) {
    return fail(error instanceof LearnInputError ? error.message : "Couldn't save that. Please try again.");
  }
  revalidatePath("/learn", "layout");
  return ok();
}

/**
 * Adds a finished certificate to the career library as "needs confirmation",
 * so it only reaches a resume once the owner adds the date and verifies it.
 */
export async function addCertificateAction(_: Prev, formData: FormData): Promise<ActionResult> {
  const userId = await requireOwnerId();
  const resource = RESOURCES.find((r) => r.key === field(formData, "resource"));
  if (!resource?.certificate) return fail("That course doesn't award a certificate.");
  const db = requireDatabase();
  const existing = await db
    .select({ id: credentials.id })
    .from(credentials)
    .where(and(eq(credentials.userId, userId), eq(credentials.name, resource.title)))
    .limit(1);
  if (existing.length) return ok("Already on your profile.");
  await createCredential(db, userId, {
    kind: "certification",
    name: resource.title,
    issuer: resource.provider,
    date: "",
    detail: "",
    factStatus: "needs_confirmation",
  });
  revalidatePath("/profile");
  revalidatePath("/learn");
  return ok("Added to your profile. Add the date there and mark it verified.");
}
