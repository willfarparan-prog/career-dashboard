import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, EmptyState, Notice, PageHeader, formatDate } from "@/components/ui";
import { requireDatabase } from "@/db";
import { jobs, resumeDrafts } from "@/db/schema";
import { aiConfigured } from "@/lib/ai/run";
import { COVER_TONES } from "@/lib/ai/tasks/cover";
import { requireViewer } from "@/lib/auth/owner";
import { countWords, listCoverLetters, loadEvidence, type CoverLetter, type EvidenceItem } from "@/lib/cover/letters";
import { isUuid } from "@/lib/export/formats";
import { deleteCoverLetterAction, generateCoverLetterAction, saveCoverLetterAction, setCoverLetterStatusAction } from "./actions";
import { EvidenceChips, LetterDownloads, LetterStatusBadge, WordCount } from "./parts";

export const metadata = { title: "Cover letter" };
export const maxDuration = 300;

const TONE_LABELS: Record<(typeof COVER_TONES)[number], string> = { warm: "Warm", direct: "Direct", formal: "Formal" };

export default async function CoverLetterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const { userId } = await requireViewer();
  const db = requireDatabase();

  const [job] = await db.select().from(jobs).where(and(eq(jobs.id, id), eq(jobs.userId, userId)));
  if (!job) notFound();

  const [drafts, letters] = await Promise.all([
    db
      .select({ id: resumeDrafts.id, name: resumeDrafts.name, status: resumeDrafts.status })
      .from(resumeDrafts)
      .where(and(eq(resumeDrafts.userId, userId), eq(resumeDrafts.jobId, id)))
      .orderBy(desc(resumeDrafts.updatedAt)),
    listCoverLetters(db, userId, id),
  ]);
  const evidence = await loadEvidence(db, userId, letters);
  const draftNames = new Map(drafts.map((draft) => [draft.id, draft.name]));
  const [latest, ...earlier] = letters;
  const defaultDraft = drafts.find((draft) => draft.status === "approved")?.id ?? drafts[0]?.id ?? "none";
  const jobLabel = [job.title, job.company].filter(Boolean).join(" at ") || "This job";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cover letter"
        description={jobLabel}
        back={{ href: `/jobs/${id}`, label: job.title || "Job" }}
      />

      <Card
        title={latest ? "Draft a new version" : "Draft a letter"}
        description="Claude writes 3–4 short paragraphs from your achievements and this job's matched requirements. Earlier versions are kept."
      >
        <div className="space-y-3">
          {!aiConfigured() ? <Notice tone="warn">Claude isn&apos;t connected yet. Add ANTHROPIC_API_KEY to draft letters.</Notice> : null}
          {!job.matchedAt ? (
            <Notice>
              This job hasn&apos;t been matched to your achievements yet, so the letter will have less to go on.{" "}
              <Link href={`/jobs/${id}`} className="underline">
                Match it first
              </Link>{" "}
              for a stronger letter.
            </Notice>
          ) : null}
          <ActionForm action={generateCoverLetterAction.bind(null, id)} className="grid gap-3 sm:grid-cols-2">
            <label className="field min-w-0">
              <span>Resume draft</span>
              <select name="draftId" className="input" defaultValue={defaultDraft}>
                {drafts.map((draft) => (
                  <option key={draft.id} value={draft.id}>
                    {draft.name}
                    {draft.status === "approved" ? " (approved)" : ""}
                  </option>
                ))}
                <option value="none">None</option>
              </select>
              <small>The letter stays consistent with the draft&apos;s summary.</small>
            </label>
            <label className="field min-w-0">
              <span>Tone</span>
              <select name="tone" className="input" defaultValue="warm">
                {COVER_TONES.map((tone) => (
                  <option key={tone} value={tone}>
                    {TONE_LABELS[tone]}
                  </option>
                ))}
              </select>
            </label>
            <div className="sm:col-span-2">
              <SubmitButton pending="Drafting… this can take a minute">{latest ? "Generate new version" : "Generate letter"}</SubmitButton>
            </div>
          </ActionForm>
        </div>
      </Card>

      {latest ? (
        <LatestLetter letter={latest} evidence={evidence} draftName={latest.draftId ? draftNames.get(latest.draftId) : undefined} />
      ) : (
        <EmptyState title="No letter yet">Pick a tone and generate a draft. You can edit every paragraph before approving it.</EmptyState>
      )}

      {earlier.length ? (
        <Card title="Earlier versions">
          <ul className="divide-y divide-border">
            {earlier.map((letter) => (
              <EarlierLetter key={letter.id} letter={letter} evidence={evidence} />
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}

function LatestLetter({ letter, evidence, draftName }: { letter: CoverLetter; evidence: Map<string, EvidenceItem>; draftName?: string }) {
  const approved = letter.status === "approved";
  return (
    <Card
      title="Latest letter"
      description={[`Drafted ${formatDate(letter.createdAt)}`, draftName ? `based on “${draftName}”` : null].filter(Boolean).join(" · ")}
      actions={<LetterStatusBadge status={letter.status} />}
    >
      <ActionForm key={`${letter.id}:${letter.updatedAt.getTime()}`} action={saveCoverLetterAction.bind(null, letter.id)} className="space-y-4">
        {letter.paragraphs.map((paragraph, index) => (
          <div key={index} className="space-y-2">
            <label className="field">
              <span>Paragraph {index + 1}</span>
              <textarea name="paragraph" rows={5} className="input" defaultValue={paragraph.text} />
            </label>
            <EvidenceChips ids={paragraph.evidence} evidence={evidence} />
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton pending="Saving…">Save changes</SubmitButton>
          <WordCount words={countWords(letter.paragraphs)} />
        </div>
        <p className="text-xs text-muted-foreground">
          Clear a paragraph to remove it. Edited paragraphs keep their supporting achievements{approved ? "; saving a change moves the letter back to draft" : ""}.
        </p>
      </ActionForm>

      <div className="mt-5 flex flex-wrap items-start justify-between gap-3 border-t border-border pt-4">
        <LetterDownloads letterId={letter.id} />
        <div className="flex flex-wrap items-start gap-2">
          <ActionForm action={setCoverLetterStatusAction.bind(null, letter.id, approved ? "draft" : "approved")}>
            <SubmitButton variant={approved ? "secondary" : "primary"} size="sm" pending="Saving…">
              {approved ? "Unapprove" : "Approve"}
            </SubmitButton>
          </ActionForm>
          <ActionForm action={deleteCoverLetterAction.bind(null, letter.id)}>
            <SubmitButton variant="danger" size="sm" pending="Deleting…" confirm="Delete this letter? This can't be undone.">
              Delete
            </SubmitButton>
          </ActionForm>
        </div>
      </div>
    </Card>
  );
}

function EarlierLetter({ letter, evidence }: { letter: CoverLetter; evidence: Map<string, EvidenceItem> }) {
  const approved = letter.status === "approved";
  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <details className="group">
        <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 text-sm [&::-webkit-details-marker]:hidden">
          <span className="font-medium">{formatDate(letter.createdAt)}</span>
          <LetterStatusBadge status={letter.status} />
          <span className="text-muted-foreground">{countWords(letter.paragraphs)} words</span>
          <span className="ml-auto text-xs text-muted-foreground group-open:hidden">Show</span>
          <span className="ml-auto hidden text-xs text-muted-foreground group-open:inline">Hide</span>
        </summary>
        <div className="mt-3 space-y-3">
          {letter.paragraphs.map((paragraph, index) => (
            <div key={index} className="space-y-1.5">
              <p className="text-sm leading-relaxed whitespace-pre-line">{paragraph.text}</p>
              <EvidenceChips ids={paragraph.evidence} evidence={evidence} />
            </div>
          ))}
          <div className="flex flex-wrap items-start justify-between gap-3 pt-1">
            <LetterDownloads letterId={letter.id} />
            <div className="flex flex-wrap items-start gap-2">
              <ActionForm action={setCoverLetterStatusAction.bind(null, letter.id, approved ? "draft" : "approved")}>
                <SubmitButton variant="secondary" size="sm" pending="Saving…">
                  {approved ? "Unapprove" : "Approve this version"}
                </SubmitButton>
              </ActionForm>
              <ActionForm action={deleteCoverLetterAction.bind(null, letter.id)}>
                <SubmitButton variant="danger" size="sm" pending="Deleting…" confirm="Delete this version? This can't be undone.">
                  Delete
                </SubmitButton>
              </ActionForm>
            </div>
          </div>
        </div>
      </details>
    </li>
  );
}
