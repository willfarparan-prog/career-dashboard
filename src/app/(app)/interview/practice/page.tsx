import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, Notice, PageHeader, formatDate } from "@/components/ui";
import { getDatabase } from "@/db";
import { COMPETENCIES, competency } from "@/content/interview/competencies";
import { aiConfigured } from "@/lib/ai/run";
import { requireViewer } from "@/lib/auth/owner";
import { isUuid } from "@/lib/export/formats";
import { practiceHref } from "@/lib/interview/links";
import { answerLength, listPracticeAttempts } from "@/lib/interview/prep";
import { listStories } from "@/lib/interview/stories";
import { jobTitle } from "@/lib/jobs/format";
import { getJobDetail } from "@/lib/jobs/jobs";
import { practiceAction } from "../actions";

export const metadata: Metadata = { title: "Practice · Interview" };
export const maxDuration = 300;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)?.trim() || "";

export default async function PracticePage({ searchParams }: { searchParams: SearchParams }) {
  const [{ userId }, params] = await Promise.all([requireViewer(), searchParams]);
  const question = one(params.q);
  const known = competency(one(params.competency));
  const jobParam = one(params.job);
  const db = getDatabase();
  const header = (
    <PageHeader
      title="Practice an answer"
      back={{ href: "/interview", label: "Interview" }}
      description="Type your answer the way you'd say it. Claude gives feedback as a fair, demanding interviewer, and flags anything your library doesn't back up."
    />
  );
  if (!db) {
    return (
      <>
        {header}
        <Notice tone="warn">No database is connected yet.</Notice>
      </>
    );
  }

  const [job, history, stories] = await Promise.all([
    isUuid(jobParam) ? getJobDetail(db, userId, jobParam) : Promise.resolve(null),
    question ? listPracticeAttempts(db, userId, { question, limit: 10 }) : Promise.resolve([]),
    listStories(db, userId),
  ]);
  const relevantStories = known ? stories.filter((story) => story.competencies.includes(known.key)) : [];
  const ai = aiConfigured();

  return (
    <>
      {header}
      <div className="space-y-4">
        {!question ? (
          <Card title="Pick a question" description="Or type your own below.">
            <div className="space-y-2">
              {COMPETENCIES.map((c) => (
                <details key={c.key} className="rounded-md border border-border px-3 py-2">
                  <summary className="cursor-pointer text-sm font-semibold">{c.label}</summary>
                  <p className="mt-1 text-xs text-muted-foreground">Listen for: {c.listenFor}</p>
                  <ul className="mt-2 space-y-1 text-sm">
                    {c.questions.map((q) => (
                      <li key={q}>
                        <Link href={practiceHref(q, { competency: c.key })} className="text-primary hover:underline">
                          {q}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </details>
              ))}
            </div>
          </Card>
        ) : null}

        {known ? (
          <Notice>
            <span className="font-medium">What they listen for:</span> {known.listenFor}
            {relevantStories.length ? (
              <span className="mt-1 block">
                Your stories for this:{" "}
                {relevantStories.map((story, index) => (
                  <span key={story.id}>
                    {index ? ", " : ""}
                    <Link href={`/interview/stories/${story.id}`} className="text-primary hover:underline" target="_blank">
                      {story.title}
                    </Link>
                  </span>
                ))}
              </span>
            ) : null}
          </Notice>
        ) : null}

        <Card>
          {!ai ? (
            <Notice tone="warn">Claude isn&apos;t connected (ANTHROPIC_API_KEY), so feedback is unavailable.</Notice>
          ) : (
            <ActionForm action={practiceAction} className="grid gap-3">
              <input type="hidden" name="competency" value={known?.key ?? ""} />
              {job ? <input type="hidden" name="jobId" value={job.job.id} /> : null}
              {job ? (
                <p className="text-xs text-muted-foreground">
                  For{" "}
                  <Link href={`/jobs/${job.job.id}/interview`} className="text-primary hover:underline">
                    {jobTitle(job.job)}
                    {job.job.company ? ` at ${job.job.company}` : ""}
                  </Link>
                </p>
              ) : null}
              <label className="field">
                <span>Question</span>
                <textarea className="input" name="question" rows={2} defaultValue={question} required />
              </label>
              <label className="field">
                <span>Your answer</span>
                <textarea className="input" name="answer" rows={12} required placeholder="Say it out loud first, then type what you said." />
                <small className="text-xs text-muted-foreground">Most behavioral answers land at 1.5–2 minutes spoken, about 200–260 words.</small>
              </label>
              <div>
                <SubmitButton pending="Getting feedback…">Get feedback</SubmitButton>
              </div>
            </ActionForm>
          )}
        </Card>

        {history.length ? (
          <Card title="Your earlier attempts at this question">
            <ul className="divide-y divide-border">
              {history.map((attempt) => {
                const length = answerLength(attempt.answer);
                return (
                  <li key={attempt.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-sm">
                    <Link href={`/interview/practice/${attempt.id}`} className="text-primary hover:underline">
                      {formatDate(attempt.createdAt)}
                    </Link>
                    <span className="text-xs text-muted-foreground">
                      {length.words} words · {Object.values(attempt.feedback.star).filter(Boolean).length}/4 STAR parts
                    </span>
                  </li>
                );
              })}
            </ul>
          </Card>
        ) : null}
      </div>
    </>
  );
}
