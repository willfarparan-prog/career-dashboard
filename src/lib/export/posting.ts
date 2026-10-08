import type { PostingSnapshot } from "@/lib/snapshots/types";
import { localDay } from "@/lib/time";

/** Plain-text copy of a job posting as it was captured (postings export as TXT only). */
export function renderPostingText(posting: PostingSnapshot): string {
  const heading = [posting.title, posting.company].map((part) => part.trim()).filter(Boolean).join(" — ");
  const captured = posting.capturedAt ? new Date(posting.capturedAt) : null;
  const facts = [
    ["Location", posting.location],
    ["Compensation", posting.compText],
    ["Requisition", posting.requisitionId],
    ["Source", posting.sourceUrl],
    ["Captured", captured && !Number.isNaN(captured.getTime()) ? localDay(captured) : posting.capturedAt],
  ]
    .filter(([, value]) => value && value.trim())
    .map(([label, value]) => `${label}: ${value.trim()}`);
  const header = [heading, ...facts].filter(Boolean).join("\n");
  return `${[header, posting.postingText.trim()].filter(Boolean).join("\n\n")}\n`;
}
