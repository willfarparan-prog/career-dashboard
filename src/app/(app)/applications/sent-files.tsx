import { formatDate } from "@/components/ui";
import type { Snapshot } from "@/lib/snapshots/create";

/* Links to the frozen copies of what was sent, rendered by /api/snapshots/[id]. */

type Format = "pdf" | "docx" | "txt";

const FILES = [
  { key: "resume", label: "Resume", formats: ["pdf", "docx", "txt"] },
  { key: "coverLetter", label: "Cover letter", formats: ["pdf", "docx", "txt"] },
  { key: "posting", label: "Job posting", formats: ["txt"] },
] as const satisfies ReadonlyArray<{ key: string; label: string; formats: readonly Format[] }>;

type Ids = { resume: string | null; coverLetter: string | null; posting: string | null };

export const snapshotUrl = (id: string, format: Format) => `/api/snapshots/${id}?format=${format}`;

function FormatLinks({ id, formats, label }: { id: string; formats: readonly Format[]; label: string }) {
  return (
    <span className="inline-flex flex-wrap gap-x-2">
      {formats.map((format) => (
        <a key={format} href={snapshotUrl(id, format)} className="font-medium text-primary hover:underline" aria-label={`${label} as ${format.toUpperCase()}`}>
          {format.toUpperCase()}
        </a>
      ))}
    </span>
  );
}

/** One line per file: "Resume  PDF DOCX TXT". */
export function SentFileLinks({ ids }: { ids: Ids }) {
  const present = FILES.filter((file) => ids[file.key]);
  if (!present.length) return null;
  return (
    <ul className="space-y-0.5 text-xs">
      {present.map((file) => (
        <li key={file.key} className="flex flex-wrap items-baseline justify-between gap-x-2">
          <span className="text-muted-foreground">{file.label}</span>
          <FormatLinks id={ids[file.key]!} formats={file.formats} label={file.label} />
        </li>
      ))}
    </ul>
  );
}

/** Fuller list for detail pages: when each copy was saved and a short fingerprint. */
export function SentFileList({ sent }: { sent: { resume: Snapshot | null; coverLetter: Snapshot | null; posting: Snapshot | null } }) {
  const present = FILES.map((file) => ({ ...file, snapshot: sent[file.key] })).filter((file) => file.snapshot);
  if (!present.length) return null;
  return (
    <ul className="divide-y divide-border rounded-lg border border-border">
      {present.map(({ key, label, formats, snapshot }) => (
        <li key={key} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 py-2.5 text-sm">
          <div className="min-w-0">
            <p className="font-medium">{label}</p>
            <p className="text-xs text-muted-foreground">
              Saved {formatDate(snapshot!.createdAt)} · fingerprint <span className="font-mono">{snapshot!.contentHash.slice(0, 10)}</span>
            </p>
          </div>
          <FormatLinks id={snapshot!.id} formats={formats} label={label} />
        </li>
      ))}
    </ul>
  );
}
