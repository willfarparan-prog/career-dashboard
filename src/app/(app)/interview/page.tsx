import type { Metadata } from "next";
import Link from "next/link";
import { Badge, ButtonLink, Card, EmptyState, FactBadge, Notice, PageHeader, formatDate } from "@/components/ui";
import { getDatabase } from "@/db";
import { COMPETENCIES, competency } from "@/content/interview/competencies";
import type { GuidePath } from "@/content/learn/types";
import { addDays, isoDay } from "@/lib/applications/dates";
import { requireViewer } from "@/lib/auth/owner";
import { getProfile } from "@/lib/career/profile";
import { interviewActions } from "@/lib/interview/interviews";
import { practiceHref } from "@/lib/interview/links";
import { answerLength, listPracticeAttempts } from "@/lib/interview/prep";
import { listStories, storyCoverage } from "@/lib/interview/stories";

export const metadata: Metadata = { title: "Interview" };

export default async function InterviewPage() {
  const { userId } = await requireViewer();
  const header = (
    <PageHeader
      title="Interview"
      description="Your story bank, the questions these roles ask, and practice with feedback. Each job has its own prep page too, with likely questions and your rounds."
      actions={
        <>
          <ButtonLink href="/interview/practice" variant="secondary">
            Practice
          </ButtonLink>
          <ButtonLink href="/interview/stories/new">New story</ButtonLink>
        </>
      }
    />
  );
  const db = getDatabase();
  if (!db) {
    return (
      <>
        {header}
        <Notice tone="warn">No database is connected yet.</Notice>
      </>
    );
  }

  const today = isoDay(new Date());
  const [profile, stories, attempts, upcoming] = await Promise.all([
    getProfile(db, userId),
    listStories(db, userId),
    listPracticeAttempts(db, userId, { limit: 8 }),
    interviewActions(db, userId, today, addDays(today, 30)),
  ]);
  const targets = (profile?.targetRoles ?? []).filter((path): path is GuidePath => path !== "other");
  const coverage = storyCoverage(stories, targets);
  const covered = coverage.filter((row) => row.stories.length).length;

  return (
    <>
      {header}
      <div className="space-y-4">
        {upcoming.length ? (
          <Card title="Coming up" description="Rounds in the next 30 days, and thank-you notes still to send.">
            <ul className="divide-y divide-border">
              {upcoming
                .sort((a, b) => a.date.localeCompare(b.date))
                .map((item) => (
                  <li key={`${item.interviewId}-${item.label}`} className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-sm">
                    <Link href={`/jobs/${item.jobId}/interview`} className="font-semibold text-primary hover:underline">
                      {item.label}
                    </Link>
                    <span className="text-xs text-muted-foreground">
                      {[item.title, item.company].filter(Boolean).join(" · ")} · {formatDate(item.date)}
                    </span>
                  </li>
                ))}
            </ul>
          </Card>
        ) : null}

        <Card
          title="Story coverage"
          description={
            targets.length
              ? "The competencies your target roles probe. Aim for a story for each; one good story can cover two or three."
              : "The competencies these roles probe. Set target roles on your profile to narrow this list."
          }
          actions={
            <span className="text-xs font-semibold text-muted-foreground tabular-nums">
              {covered} of {coverage.length} covered
            </span>
          }
        >
          <ul className="grid gap-2 sm:grid-cols-2">
            {coverage.map((row) => (
              <li key={row.key} className={`rounded-md border px-3 py-2 text-sm ${row.stories.length ? "border-border" : "border-bad/40 bg-bad-soft/40"}`}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-semibold">{row.label}</span>
                  {row.stories.length ? (
                    <Badge tone="ok">
                      {row.stories.length} stor{row.stories.length === 1 ? "y" : "ies"}
                    </Badge>
                  ) : (
                    <Link href="/interview/stories/new" className="text-xs font-semibold text-primary hover:underline">
                      Add a story
                    </Link>
                  )}
                </div>
                {row.stories.length ? (
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">{row.stories.map((s) => s.title).join(" · ")}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>

        <div id="stories" className="scroll-mt-20" />
        <Card title="Story bank" actions={<ButtonLink href="/interview/stories/new" size="sm" variant="secondary">New story</ButtonLink>}>
          {stories.length ? (
            <ul className="divide-y divide-border">
              {stories.map((story) => (
                <li key={story.id} className="py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <Link href={`/interview/stories/${story.id}`} className="min-w-[12rem] flex-1 text-sm font-semibold text-primary hover:underline">
                      {story.title}
                    </Link>
                    <FactBadge status={story.factStatus} />
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{story.format === "free" ? story.body : story.action}</p>
                  {story.competencies.length ? (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {story.competencies.map((key) => (
                        <Badge key={key}>{competency(key)?.label ?? key}</Badge>
                      ))}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No stories yet" action={<ButtonLink href="/interview/stories/new">Write your first story</ButtonLink>}>
              Start with &quot;Tell me about yourself&quot;, then turn your two or three strongest achievements into STAR stories. Claude can draft each one from an achievement.
            </EmptyState>
          )}
        </Card>

        <Card title="Question bank" description="Classic questions for each competency, and what a strong answer shows.">
          <div className="space-y-2">
            {COMPETENCIES.filter((c) => !targets.length || c.paths.some((path) => targets.includes(path))).map((c) => (
              <details key={c.key} className="rounded-md border border-border px-3 py-2">
                <summary className="cursor-pointer text-sm font-semibold">{c.label}</summary>
                <p className="mt-1 text-xs text-muted-foreground">Listen for: {c.listenFor}</p>
                <ul className="mt-2 space-y-1 text-sm">
                  {c.questions.map((q) => (
                    <li key={q} className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="min-w-[12rem] flex-1">{q}</span>
                      <Link href={practiceHref(q, { competency: c.key })} className="text-xs font-semibold text-primary hover:underline">
                        Practice
                      </Link>
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </div>
        </Card>

        <Card title="Recent practice">
          {attempts.length ? (
            <ul className="divide-y divide-border">
              {attempts.map((attempt) => (
                <li key={attempt.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-sm">
                  <Link href={`/interview/practice/${attempt.id}`} className="min-w-[12rem] flex-1 text-primary hover:underline">
                    {attempt.question}
                  </Link>
                  <span className="text-xs text-muted-foreground">
                    {formatDate(attempt.createdAt)} · {answerLength(attempt.answer).words} words · {Object.values(attempt.feedback.star).filter(Boolean).length}/4 STAR
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              Nothing yet.{" "}
              <Link href="/interview/practice" className="text-primary hover:underline">
                Pick a question
              </Link>{" "}
              and type your answer the way you&apos;d say it.
            </p>
          )}
        </Card>
      </div>
    </>
  );
}
