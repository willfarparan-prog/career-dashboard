import { and, eq } from "drizzle-orm";
import type { Database } from "@/db";
import { jobs, profiles, type EvidencedText } from "@/db/schema";
import type { Profile } from "@/lib/ai/library";
import type { CoverLetterDocument } from "@/lib/snapshots/types";
import { getCoverLetter, type CoverLetter } from "./letters";

/** The format-neutral letter every export and snapshot renders from. */
export function coverLetterDocument(
  profile: Pick<Profile, "fullName" | "headline" | "email" | "phone" | "location" | "links"> | null,
  job: { company: string; title: string },
  paragraphs: EvidencedText[],
): CoverLetterDocument {
  return {
    person: {
      fullName: profile?.fullName ?? "",
      headline: profile?.headline ?? "",
      email: profile?.email ?? "",
      phone: profile?.phone ?? "",
      location: profile?.location ?? "",
      links: profile?.links ?? [],
    },
    company: job.company,
    jobTitle: job.title,
    paragraphs: paragraphs.map((paragraph) => paragraph.text.trim()).filter(Boolean),
  };
}

/** Loads a letter with its job and the owner's profile; null unless all belong to `userId`. */
export async function loadCoverLetterDocument(
  db: Database,
  userId: string,
  id: string,
): Promise<{ letter: CoverLetter; document: CoverLetterDocument } | null> {
  const letter = await getCoverLetter(db, userId, id);
  if (!letter) return null;
  const [[job], [profile]] = await Promise.all([
    db.select({ company: jobs.company, title: jobs.title }).from(jobs).where(and(eq(jobs.id, letter.jobId), eq(jobs.userId, userId))),
    db.select().from(profiles).where(eq(profiles.userId, userId)),
  ]);
  if (!job) return null;
  return { letter, document: coverLetterDocument(profile ?? null, job, letter.paragraphs) };
}
