"use server";

import { revalidatePath } from "next/cache";
import { requireDatabase } from "@/db";
import { fail, field, ok, type ActionResult } from "@/lib/action-result";
import { requireOwnerId } from "@/lib/auth/owner";
import { createCredential, deleteCredential, updateCredential } from "@/lib/career/credentials";
import { setFactStatus } from "@/lib/career/facts";
import { parseContactForm, parseCredentialForm, parseFactForm, parseRoleForm, parseSearchSettingsForm, parseSkillForm } from "@/lib/career/forms";
import { saveContact, saveSearchSettings } from "@/lib/career/profile";
import { createRole, deleteRole, updateRole } from "@/lib/career/roles";
import { addSkill, deleteSkill, updateSkill } from "@/lib/career/skills";
import { careerErrorMessage } from "@/lib/career/util";

type Prev = ActionResult | null;

/** Runs one career change for the owner and refreshes the library pages. */
async function run(work: (userId: string) => Promise<string | undefined>): Promise<ActionResult> {
  const userId = await requireOwnerId();
  let message: string | undefined;
  try {
    message = await work(userId);
  } catch (error) {
    return fail(careerErrorMessage(error));
  }
  revalidatePath("/profile");
  revalidatePath("/achievements");
  return ok(message);
}

export async function saveContactAction(_: Prev, formData: FormData) {
  return run(async (userId) => {
    await saveContact(requireDatabase(), userId, parseContactForm(formData));
    return "Contact details saved.";
  });
}

export async function saveSearchSettingsAction(_: Prev, formData: FormData) {
  return run(async (userId) => {
    await saveSearchSettings(requireDatabase(), userId, parseSearchSettingsForm(formData));
    return "Search settings saved.";
  });
}

export async function createRoleAction(_: Prev, formData: FormData) {
  return run(async (userId) => {
    const role = await createRole(requireDatabase(), userId, parseRoleForm(formData));
    return `Added ${role.title} at ${role.employer}.`;
  });
}

export async function updateRoleAction(_: Prev, formData: FormData) {
  return run(async (userId) => {
    await updateRole(requireDatabase(), userId, field(formData, "id"), parseRoleForm(formData));
    return "Role saved.";
  });
}

export async function deleteRoleAction(_: Prev, formData: FormData) {
  return run(async (userId) => {
    await deleteRole(requireDatabase(), userId, field(formData, "id"));
    return "Role deleted.";
  });
}

export async function createCredentialAction(_: Prev, formData: FormData) {
  return run(async (userId) => {
    const credential = await createCredential(requireDatabase(), userId, parseCredentialForm(formData));
    return `Added ${credential.name}.`;
  });
}

export async function updateCredentialAction(_: Prev, formData: FormData) {
  return run(async (userId) => {
    await updateCredential(requireDatabase(), userId, field(formData, "id"), parseCredentialForm(formData));
    return "Saved.";
  });
}

export async function deleteCredentialAction(_: Prev, formData: FormData) {
  return run(async (userId) => {
    await deleteCredential(requireDatabase(), userId, field(formData, "id"));
    return "Deleted.";
  });
}

export async function addSkillAction(_: Prev, formData: FormData) {
  return run(async (userId) => {
    const { skill, created } = await addSkill(requireDatabase(), userId, parseSkillForm(formData));
    return created ? `Added ${skill.name}.` : `You already have ${skill.name}.`;
  });
}

export async function updateSkillAction(_: Prev, formData: FormData) {
  return run(async (userId) => {
    await updateSkill(requireDatabase(), userId, field(formData, "id"), parseSkillForm(formData));
    return "Saved.";
  });
}

export async function deleteSkillAction(_: Prev, formData: FormData) {
  return run(async (userId) => {
    await deleteSkill(requireDatabase(), userId, field(formData, "id"));
    return "Deleted.";
  });
}

/** The quick "Mark verified" buttons (roles, credentials, skills and achievements). */
export async function setFactStatusAction(_: Prev, formData: FormData) {
  return run(async (userId) => {
    const { kind, id, status } = parseFactForm(formData);
    await setFactStatus(requireDatabase(), userId, kind, id, status);
    return undefined;
  });
}
