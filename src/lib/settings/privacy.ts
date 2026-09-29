import { and, count, eq, isNotNull } from "drizzle-orm";
import type { Database } from "@/db";
import { careerImports, profiles } from "@/db/schema";

export type PrivacySettings = {
  /** Include items marked private in what Claude sees. Off by default. */
  sendPrivateToClaude: boolean;
  /** Keep the raw text of imported resumes after review. Off by default. */
  keepImportText: boolean;
};

export const DEFAULT_PRIVACY: PrivacySettings = { sendPrivateToClaude: false, keepImportText: false };

export async function getPrivacySettings(db: Database, userId: string): Promise<PrivacySettings> {
  const [row] = await db
    .select({ sendPrivateToClaude: profiles.sendPrivateToClaude, keepImportText: profiles.keepImportText })
    .from(profiles)
    .where(eq(profiles.userId, userId));
  return row ?? DEFAULT_PRIVACY;
}

/** Saves the privacy toggles, creating the profile row if there isn't one yet. Other profile fields are left alone. */
export async function updatePrivacySettings(db: Database, userId: string, settings: PrivacySettings): Promise<PrivacySettings> {
  const values = { sendPrivateToClaude: Boolean(settings.sendPrivateToClaude), keepImportText: Boolean(settings.keepImportText) };
  await db
    .insert(profiles)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: profiles.userId, set: { ...values, updatedAt: new Date() } });
  return values;
}

/** How many imports still hold their original resume text. */
export async function countStoredImportText(db: Database, userId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(careerImports)
    .where(and(eq(careerImports.userId, userId), isNotNull(careerImports.rawText)));
  return Number(row?.n ?? 0);
}

/** Drops the stored text of every import. The extracted, reviewed results stay. Returns how many were cleared. */
export async function clearImportText(db: Database, userId: string): Promise<number> {
  const cleared = await db
    .update(careerImports)
    .set({ rawText: null })
    .where(and(eq(careerImports.userId, userId), isNotNull(careerImports.rawText)))
    .returning({ id: careerImports.id });
  return cleared.length;
}
