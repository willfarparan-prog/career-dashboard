import { eq } from "drizzle-orm";
import type { Database } from "@/db";
import { profiles, type CareerPath, type FitWeights } from "@/db/schema";
import type { Profile } from "@/lib/ai/library";
import { DEFAULT_FIT_WEIGHTS, FIT_WEIGHT_KEYS, isCareerPath } from "./labels";
import { CareerInputError, cleanList } from "./util";

export type ContactInput = {
  fullName: string;
  headline: string;
  email: string;
  phone: string;
  location: string;
  links: string[];
};

export type SearchSettingsInput = {
  targetRoles: CareerPath[];
  targetLocations: string[];
  remoteOk: boolean;
  compMin: number | null;
  fitWeights: FitWeights;
};

export async function getProfile(db: Database, userId: string): Promise<Profile | null> {
  const [row] = await db.select().from(profiles).where(eq(profiles.userId, userId));
  return row ?? null;
}

/** The owner's profile row, created with defaults the first time it's needed. */
export async function ensureProfile(db: Database, userId: string): Promise<Profile> {
  const existing = await getProfile(db, userId);
  if (existing) return existing;
  await db.insert(profiles).values({ userId }).onConflictDoNothing();
  const created = await getProfile(db, userId);
  if (!created) throw new Error("Couldn't create the profile row.");
  return created;
}

/** Stored weights, or the defaults (all 3) when the owner hasn't set any. */
export function fitWeightsOf(profile: Pick<Profile, "fitWeights"> | null): FitWeights {
  return { ...DEFAULT_FIT_WEIGHTS, ...(profile?.fitWeights ?? {}) };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateContact(input: ContactInput): ContactInput {
  const email = input.email.trim();
  if (email && !EMAIL.test(email)) throw new CareerInputError("That email address doesn't look right.");
  return {
    fullName: input.fullName.trim(),
    headline: input.headline.trim(),
    email,
    phone: input.phone.trim(),
    location: input.location.trim(),
    links: cleanList(input.links),
  };
}

export async function saveContact(db: Database, userId: string, input: ContactInput): Promise<Profile> {
  const values = validateContact(input);
  const [row] = await db
    .insert(profiles)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: profiles.userId, set: { ...values, updatedAt: new Date() } })
    .returning();
  return row;
}

const clampWeight = (value: number) => (Number.isFinite(value) ? Math.min(5, Math.max(0, Math.round(value))) : 3);

export function validateSearchSettings(input: SearchSettingsInput): SearchSettingsInput {
  if (input.compMin != null && (input.compMin < 0 || input.compMin > 10_000_000)) {
    throw new CareerInputError("Enter the minimum as a yearly amount in US dollars, like 85000.");
  }
  const fitWeights = { ...DEFAULT_FIT_WEIGHTS };
  for (const key of FIT_WEIGHT_KEYS) fitWeights[key] = clampWeight(input.fitWeights[key]);
  return {
    targetRoles: [...new Set(input.targetRoles.filter(isCareerPath))],
    targetLocations: cleanList(input.targetLocations),
    remoteOk: input.remoteOk,
    compMin: input.compMin,
    fitWeights,
  };
}

export async function saveSearchSettings(db: Database, userId: string, input: SearchSettingsInput): Promise<Profile> {
  const values = validateSearchSettings(input);
  const [row] = await db
    .insert(profiles)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: profiles.userId, set: { ...values, updatedAt: new Date() } })
    .returning();
  return row;
}
