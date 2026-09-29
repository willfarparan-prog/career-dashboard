import Link from "next/link";
import { Badge, buttonClass } from "@/components/ui";
import type { CoverLetterStatus, EvidenceItem } from "@/lib/cover/letters";

/* Small server-safe pieces shared by the cover letter page and the job page card. */

export const TARGET_WORDS = { min: 250, max: 350 };

export function LetterStatusBadge({ status }: { status: CoverLetterStatus }) {
  return status === "approved" ? <Badge tone="ok">Approved</Badge> : <Badge>Draft</Badge>;
}

export function WordCount({ words }: { words: number }) {
  const outside = words < TARGET_WORDS.min || words > TARGET_WORDS.max;
  return (
    <span className="text-sm tabular-nums">
      {words} words
      {outside ? <span className="text-muted-foreground"> (aim for {TARGET_WORDS.min}–{TARGET_WORDS.max})</span> : null}
    </span>
  );
}

/** Download links for one saved letter (PDF, Word, text) plus an in-browser PDF preview. */
export function LetterDownloads({ letterId }: { letterId: string }) {
  const href = (format: "pdf" | "docx" | "txt") => `/api/export/cover-letter/${letterId}?format=${format}`;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <a href={href("pdf")} className={buttonClass("secondary", "sm")}>
        PDF
      </a>
      <a href={href("docx")} className={buttonClass("secondary", "sm")}>
        Word
      </a>
      <a href={href("txt")} className={buttonClass("secondary", "sm")}>
        Text
      </a>
      <a href={`${href("pdf")}&inline=1`} target="_blank" rel="noopener" className={buttonClass("ghost", "sm")}>
        Preview
      </a>
    </div>
  );
}

/** The achievements a paragraph was drafted from, or a warning when there are none. */
export function EvidenceChips({ ids, evidence }: { ids: string[]; evidence: Map<string, EvidenceItem> }) {
  const items = ids.map((id) => evidence.get(id)).filter((item): item is EvidenceItem => Boolean(item));
  if (!items.length) {
    return (
      <Badge tone="warn" title="Nothing in your library backs this paragraph. Check it says nothing you can't support.">
        No supporting achievement
      </Badge>
    );
  }
  return (
    <ul className="flex min-w-0 flex-wrap gap-1.5" aria-label="Supporting achievements">
      {items.map((item) => (
        <li key={item.id} className="min-w-0 max-w-full">
          <Link
            href={`/achievements/${item.id}`}
            title={item.headline}
            className="inline-flex max-w-full items-center rounded-full bg-ok-soft px-2 py-0.5 text-xs font-medium text-ok hover:underline"
          >
            <span className="truncate">{item.headline}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
