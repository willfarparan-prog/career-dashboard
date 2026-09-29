import type { ResumeDocument } from "@/lib/resume/document";

/*
 * What a snapshot's `content` holds, by kind. Snapshots are rendered back to
 * TXT/DOCX/PDF from this content, so these shapes must stay backward compatible.
 */

export type PostingSnapshot = {
  company: string;
  title: string;
  location: string;
  compText: string;
  sourceUrl: string;
  requisitionId: string;
  capturedAt: string;
  postingText: string;
};

export type CoverLetterDocument = {
  person: ResumeDocument["person"];
  company: string;
  jobTitle: string;
  paragraphs: string[];
};

export type SnapshotContent =
  | { kind: "resume"; document: ResumeDocument }
  | { kind: "cover_letter"; document: CoverLetterDocument }
  | { kind: "posting"; document: PostingSnapshot };
