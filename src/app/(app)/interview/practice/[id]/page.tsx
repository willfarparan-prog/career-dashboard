import { Check, X } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, ButtonLink, Card, Notice, PageHeader, formatDate } from "@/components/ui";
import { getDatabase } from "@/db";
import type { PracticeRating } from "@/db/schema";
import { competency } from "@/content/interview/competencies";
import { requireViewer } from "@/lib/auth/owner";
import { isUuid } from "@/lib/export/formats";
import { practiceHref } from "@/lib/interview/links";
import { answerLength, getPracticeAttempt, listPracticeAttempts } from "@/lib/interview/prep";

export const metadata: Metadata = { title: "Feedback · Interview" };

const RATING_TONE: Record<PracticeRating, "ok" | "warn" | "bad"> = { strong: "ok", ok: "warn", weak: "bad" };
const RATING_LABEL: Record<PracticeRating, string> = { strong: "Strong", ok: "OK", weak: "Needs work" };
const STAR_LABELS = { situation: "Situation", task: "Task", action: "Action", result: "Result" } as const;

export default async function AttemptPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, { userId }] = await Promise.all([params, requireViewer()]);
  const db = getDatabase();
  if (!db) return <Notice tone="warn">No database is connected yet.</Notice>;
  if (!isUuid(id)) notFound();
  const attempt = await getPracticeAttempt(db, userId, id);
  if (!attempt) notFound();
  const history = (await listPracticeAttempts(db, userId, { question: attempt.question, limit: 10 })).filter((a) => a.id !== attempt.id);
  const { feedback } = attempt;
  const length = answerLength(attempt.answer);
  const known = competency(attempt.competency);
  const retry = practiceHref(attempt.question, { competency: attempt.competency || null, jobId: attempt.jobId });

  return (
    <>
      <PageHeader
        title={attempt.question}
        back={{ href: "/interview", label: "Interview" }}
        description={`${formatDate(attempt.createdAt)}${known ? ` · ${known.label}` : ""}`}
        actions={<ButtonLink href={retry}>Try again</ButtonLink>}
      />
      <div className="space-y-4">
        <Card title="Feedback">
          <div className="space-y-4">
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground">STAR structure</h3>
              <ul className="mt-1.5 flex flex-wrap gap-1.5">
                {(Object.keys(STAR_LABELS) as Array<keyof typeof STAR_LABELS>).map((part) => (
                  <li key={part}>
                    <Badge tone={feedback.star[part] ? "ok" : "bad"}>
                      {feedback.star[part] ? <Check aria-hidden size={11} /> : <X aria-hidden size={11} />}
                      {STAR_LABELS[part]}
                      <span className="sr-only">{feedback.star[part] ? " covered" : " missing"}</span>
                    </Badge>
                  </li>
                ))}
              </ul>
            </div>
            <dl className="grid gap-3 sm:grid-cols-3">
              {(["specificity", "result", "relevance"] as const).map((aspect) => (
                <div key={aspect} className="rounded-md border border-border p-3">
                  <dt className="flex items-center justify-between gap-2 text-sm font-semibold capitalize">
                    {aspect}
                    <Badge tone={RATING_TONE[feedback[aspect].rating]}>{RATING_LABEL[feedback[aspect].rating]}</Badge>
                  </dt>
                  <dd className="mt-1 text-sm">{feedback[aspect].note}</dd>
                </div>
              ))}
            </dl>
            <p className="text-sm">
              <span className="font-semibold">Length: </span>
              {length.words} words, about {Math.max(1, Math.round(length.seconds / 15) * 15)} seconds spoken. {length.note}
            </p>
            {feedback.unsupportedClaims.length ? (
              <Notice tone="warn">
                <span className="font-medium">Not backed by your library.</span> An interviewer could ask you to prove these. Correct them, or add the evidence to your{" "}
                <Link href="/achievements" className="underline">
                  achievements
                </Link>
                :
                <ul className="mt-1 list-disc pl-5">
                  {feedback.unsupportedClaims.map((claim) => (
                    <li key={claim}>{claim}</li>
                  ))}
                </ul>
              </Notice>
            ) : null}
            <Notice tone="primary">
              <span className="font-medium">Biggest improvement: </span>
              {feedback.rewriteTip}
            </Notice>
          </div>
        </Card>

        <Card title="Your answer">
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{attempt.answer}</p>
        </Card>

        {history.length ? (
          <Card title="Earlier attempts">
            <ul className="divide-y divide-border">
              {history.map((other) => (
                <li key={other.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-sm">
                  <Link href={`/interview/practice/${other.id}`} className="text-primary hover:underline">
                    {formatDate(other.createdAt)}
                  </Link>
                  <span className="text-xs text-muted-foreground">
                    {answerLength(other.answer).words} words · {Object.values(other.feedback.star).filter(Boolean).length}/4 STAR parts
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </div>
    </>
  );
}
