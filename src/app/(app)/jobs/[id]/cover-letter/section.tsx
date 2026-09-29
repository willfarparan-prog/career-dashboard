import { ButtonLink, Card, EmptyState, formatDate } from "@/components/ui";
import { getDatabase } from "@/db";
import { requireViewer } from "@/lib/auth/owner";
import { countWords, listCoverLetters } from "@/lib/cover/letters";
import { LetterStatusBadge, WordCount } from "./parts";

/** The cover letter card on the job page: latest letter at a glance, with a link to the full page. */
export async function CoverLetterSection({ jobId }: { jobId: string }) {
  const { userId } = await requireViewer();
  const db = getDatabase();
  if (!db) return null;
  const letters = await listCoverLetters(db, userId, jobId);
  const [latest] = letters;
  const approved = letters.find((letter) => letter.status === "approved");
  const href = `/jobs/${jobId}/cover-letter`;

  return (
    <Card title="Cover letter" actions={latest ? <ButtonLink href={href} variant="secondary" size="sm">Open</ButtonLink> : null}>
      {latest ? (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <LetterStatusBadge status={latest.status} />
            <WordCount words={countWords(latest.paragraphs)} />
          </div>
          <p className="text-xs text-muted-foreground">
            Updated {formatDate(latest.updatedAt)}
            {letters.length > 1 ? ` · ${letters.length} versions` : ""}
            {approved && approved.id !== latest.id ? " · an earlier version is approved" : ""}
          </p>
        </div>
      ) : (
        <EmptyState title="No cover letter yet" action={<ButtonLink href={href} size="sm">Draft a letter</ButtonLink>}>
          Claude drafts one from your achievements and this job&apos;s requirements.
        </EmptyState>
      )}
    </Card>
  );
}
