import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Disclosure } from "@/app/(app)/profile/fields";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, EmptyState, Notice, PageHeader, formatDate } from "@/components/ui";
import { getDatabase } from "@/db";
import { INTERVIEW_OUTCOMES, INTERVIEW_STAGES, type PrepContent } from "@/db/schema";
import { competency } from "@/content/interview/competencies";
import { todayIso } from "@/lib/applications/dates";
import { aiConfigured } from "@/lib/ai/run";
import { requireViewer } from "@/lib/auth/owner";
import { isUuid } from "@/lib/export/formats";
import { listInterviews, OUTCOME_LABELS, STAGE_LABELS, type Interview } from "@/lib/interview/interviews";
import { practiceHref } from "@/lib/interview/links";
import { getPrep } from "@/lib/interview/prep";
import { listStories, type Story } from "@/lib/interview/stories";
import { jobTitle } from "@/lib/jobs/format";
import { getJobDetail } from "@/lib/jobs/jobs";
import { addRoundAction, deleteRoundAction, generatePrepAction, saveCompanyNotesAction, updateRoundAction } from "@/app/(app)/interview/actions";

export const metadata: Metadata = { title: "Interview prep" };
export const maxDuration = 300;

export default async function JobInterviewPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, { userId }] = await Promise.all([params, requireViewer()]);
  const db = getDatabase();
  if (!db) return <Notice tone="warn">No database is connected yet.</Notice>;
  if (!isUuid(id)) notFound();
  const detail = await getJobDetail(db, userId, id);
  if (!detail) notFound();
  const { job } = detail;
  const [rounds, prep, stories] = await Promise.all([listInterviews(db, userId, id), getPrep(db, userId, id), listStories(db, userId)]);
  const storyById = new Map(stories.map((story) => [story.id, story]));
  const ai = aiConfigured();

  return (
    <>
      <PageHeader
        title={`Interview prep: ${jobTitle(job)}`}
        description={job.company || undefined}
        back={{ href: `/jobs/${id}`, label: jobTitle(job) }}
      />
      <div className="space-y-4">
        <RoundsCard jobId={id} rounds={rounds} />

        <Card
          title="Prep pack"
          description={
            prep?.generatedAt
              ? `Built ${formatDate(prep.generatedAt)} from this posting, its requirements and your story bank.`
              : "Likely questions for this posting, which of your stories answer each, honest framing for the gaps, and questions to ask."
          }
          actions={
            ai ? (
              <ActionForm action={generatePrepAction.bind(null, id)}>
                <SubmitButton variant={prep?.content ? "secondary" : "primary"} size="sm" pending="Building… (up to a minute)">
                  {prep?.content ? "Rebuild" : "Build prep pack"}
                </SubmitButton>
              </ActionForm>
            ) : null
          }
        >
          {!ai ? <Notice tone="warn">Claude isn&apos;t connected (ANTHROPIC_API_KEY), so the prep pack is unavailable.</Notice> : null}
          {!job.analyzedAt ? <Notice>Analyze the posting and run Match evidence on the job page first, so the pack knows your strengths and gaps.</Notice> : null}
          {prep?.content ? (
            <PrepView content={prep.content} storyById={storyById} jobId={id} />
          ) : ai ? (
            <EmptyState title="No prep pack yet">
              {stories.length ? "Build one to see the questions this posting is likely to produce." : "Tip: add a few stories to your story bank first, so the pack can match them to questions."}
            </EmptyState>
          ) : null}
        </Card>

        <Card title="Your company research" description="What you find out about the company, product and interviewers. Your notes; Claude doesn't write here.">
          <ActionForm action={saveCompanyNotesAction.bind(null, id)} className="grid gap-2">
            <textarea className="input" name="companyNotes" rows={6} defaultValue={prep?.companyNotes ?? ""} placeholder="Product, customers, recent news, the CS model, who you're meeting…" />
            <div>
              <SubmitButton variant="secondary" size="sm">
                Save notes
              </SubmitButton>
            </div>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}

function PrepView({ content, storyById, jobId }: { content: PrepContent; storyById: Map<string, Story>; jobId: string }) {
  return (
    <div className="space-y-5">
      {content.pivotAngle ? (
        <Notice tone="primary">
          <span className="font-medium">Your angle for this job: </span>
          {content.pivotAngle}
        </Notice>
      ) : null}

      <section>
        <h3 className="text-sm font-semibold">Likely questions</h3>
        <ol className="mt-2 space-y-3">
          {content.likelyQuestions.map((q, index) => {
            const known = q.competency ? competency(q.competency) : undefined;
            const linked = q.storyIds.map((sid) => storyById.get(sid)).filter((story): story is Story => Boolean(story));
            return (
              <li key={`${index}-${q.question}`} className="rounded-md border border-border p-3 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="min-w-[12rem] flex-1 font-semibold">{q.question}</p>
                  <Link href={practiceHref(q.question, { competency: q.competency, jobId })} className="text-xs font-semibold text-primary hover:underline">
                    Practice
                  </Link>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {q.why}
                  {known ? ` · ${known.label}` : ""}
                </p>
                {linked.length ? (
                  <p className="mt-1.5">
                    <span className="font-medium">Use: </span>
                    {linked.map((story, i) => (
                      <span key={story.id}>
                        {i ? ", " : ""}
                        <Link href={`/interview/stories/${story.id}`} className="text-primary hover:underline">
                          {story.title}
                        </Link>
                      </span>
                    ))}
                  </p>
                ) : q.competency && !known?.narrative ? (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    No story fits yet.{" "}
                    <Link href="/interview/stories/new" className="text-primary hover:underline">
                      Add one
                    </Link>
                  </p>
                ) : null}
                {q.gapAdvice ? (
                  <div className="mt-2">
                    <Notice tone="warn">
                      <span className="font-medium">Gap. Answer honestly: </span>
                      {q.gapAdvice}
                    </Notice>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <section>
          <h3 className="text-sm font-semibold">Questions to ask them</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {content.questionsToAsk.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </section>
        <section>
          <h3 className="text-sm font-semibold">Research before the interview</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {content.researchChecklist.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

const STAGE_OPTIONS = INTERVIEW_STAGES.map((value) => ({ value, label: STAGE_LABELS[value] }));
const OUTCOME_OPTIONS = INTERVIEW_OUTCOMES.map((value) => ({ value, label: OUTCOME_LABELS[value] }));

function RoundFields({ round }: { round?: Interview }) {
  return (
    <div className="grid gap-3">
      {round ? <input type="hidden" name="id" value={round.id} /> : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="field">
          <span>Stage</span>
          <select className="input" name="stage" defaultValue={round?.stage ?? "recruiter_screen"}>
            {STAGE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Date</span>
          <input className="input" type="date" name="date" defaultValue={round?.date ?? ""} />
        </label>
        <label className="field">
          <span>Outcome</span>
          <select className="input" name="outcome" defaultValue={round?.outcome ?? "pending"}>
            {OUTCOME_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="field">
        <span>Interviewers</span>
        <input className="input" name="interviewers" defaultValue={round?.interviewers ?? ""} placeholder="Names and roles" />
      </label>
      <label className="field">
        <span>Prep notes</span>
        <textarea className="input" name="notes" rows={2} defaultValue={round?.notes ?? ""} placeholder="Format, what to bring, the case brief…" />
      </label>
      {round ? (
        <>
          <label className="field">
            <span>Debrief</span>
            <textarea className="input" name="debrief" rows={3} defaultValue={round.debrief} placeholder="What they asked, what went well, what to fix next time" />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="thankYouSent" defaultChecked={round.thankYouSent} className="size-4 accent-primary" />
            Thank-you note sent
          </label>
        </>
      ) : null}
    </div>
  );
}

function RoundsCard({ jobId, rounds }: { jobId: string; rounds: Interview[] }) {
  const today = todayIso();
  return (
    <Card title="Rounds" description="Upcoming rounds and unsent thank-you notes show on Home.">
      {rounds.length ? (
        <ul className="divide-y divide-border">
          {rounds.map((round) => (
            <li key={round.id} className="py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-semibold">
                  {STAGE_LABELS[round.stage]}
                  <span className="ml-2 font-normal text-muted-foreground">{round.date ? formatDate(round.date) : "Not scheduled"}</span>
                </p>
                <div className="flex flex-wrap gap-1.5">
                  <Badge tone={round.outcome === "rejected" ? "bad" : round.outcome === "pending" ? "neutral" : "ok"}>{OUTCOME_LABELS[round.outcome]}</Badge>
                  {round.date && round.date < today && !round.thankYouSent && round.outcome !== "rejected" ? <Badge tone="warn">Thank-you not sent</Badge> : null}
                </div>
              </div>
              {round.interviewers ? <p className="mt-0.5 text-xs text-muted-foreground">With {round.interviewers}</p> : null}
              {round.debrief ? <p className="mt-1 text-sm whitespace-pre-wrap">{round.debrief}</p> : null}
              {/* Keyed on updatedAt so the form shows saved values after a save. */}
              <Disclosure key={round.updatedAt.toISOString()} summary="Edit" className="mt-2">
                <ActionForm action={updateRoundAction} className="grid gap-3">
                  <RoundFields round={round} />
                  <div>
                    <SubmitButton size="sm">Save</SubmitButton>
                  </div>
                </ActionForm>
                <ActionForm action={deleteRoundAction} className="mt-3 border-t border-border pt-3">
                  <input type="hidden" name="id" value={round.id} />
                  <SubmitButton variant="danger" size="sm" confirm="Delete this round?" pending="Deleting…">
                    Delete round
                  </SubmitButton>
                </ActionForm>
              </Disclosure>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No rounds logged yet.</p>
      )}
      <Disclosure summary="Add a round" className="mt-3 border-t border-border pt-3" open={!rounds.length}>
        <ActionForm action={addRoundAction.bind(null, jobId)} className="grid gap-3" resetOnSuccess>
          <RoundFields />
          <div>
            <SubmitButton size="sm">Add round</SubmitButton>
          </div>
        </ActionForm>
      </Disclosure>
    </Card>
  );
}
