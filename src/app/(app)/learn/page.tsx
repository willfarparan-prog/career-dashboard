import type { Metadata } from "next";
import Link from "next/link";
import { Badge, ButtonLink, Card, EmptyState, Notice, PageHeader, Stat } from "@/components/ui";
import { getDatabase } from "@/db";
import { GUIDE_ORDER, GUIDES, guideTargets } from "@/content/learn/guides";
import { RESOURCES, RESOURCES_CHECKED_ON } from "@/content/learn/resources";
import { GUIDE_SECTIONS } from "@/content/learn/types";
import { requireViewer } from "@/lib/auth/owner";
import { getProfile } from "@/lib/career/profile";
import { gapRoadmap, type GapTopic } from "@/lib/learn/gaps";
import { guideKey, listProgress, summarize, termKey, type Progress } from "@/lib/learn/progress";
import { ResourceItem } from "./parts";

export const metadata: Metadata = { title: "Learn" };

const ROADMAP_LIMIT = 8;

export default async function LearnPage() {
  const { userId } = await requireViewer();
  const header = (
    <PageHeader
      title="Learn"
      description="How the roles you're targeting actually work: the workflow, vocabulary, metrics, tools and interviews. Plus what to learn next, based on the gaps in the jobs you've saved."
      actions={<ButtonLink href="/learn/glossary" variant="secondary">Glossary</ButtonLink>}
    />
  );
  const db = getDatabase();
  if (!db) {
    return (
      <>
        {header}
        <Notice tone="warn">No database is connected yet. Set DATABASE_URL to track your progress.</Notice>
      </>
    );
  }

  const [profile, progress, roadmap] = await Promise.all([getProfile(db, userId), listProgress(db, userId), gapRoadmap(db, userId)]);
  const targets = guideTargets(profile?.targetRoles ?? []);
  const order = [...GUIDE_ORDER].sort((a, b) => Number(targets.includes(b)) - Number(targets.includes(a)));
  const summary = summarize(progress);
  const resources = [...RESOURCES].sort((a, b) => Number(b.paths.some((p) => targets.includes(p))) - Number(a.paths.some((p) => targets.includes(p))));

  return (
    <>
      {header}
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="Terms you know" value={`${summary.termsKnown} / ${summary.termsTotal}`} hint={<Link href="/learn/glossary?show=unknown" className="text-primary hover:underline">Practice the rest</Link>} />
          <Stat label="Guide sections understood" value={summary.sectionsDone} hint={`of ${GUIDE_ORDER.length * GUIDE_SECTIONS.length} across all guides`} />
          <Stat label="Courses" value={summary.resourcesDone} hint={summary.resourcesStarted ? `done · ${summary.resourcesStarted} in progress` : "done"} />
        </div>

        <section aria-labelledby="guides-heading">
          <h2 id="guides-heading" className="sr-only">Field guides</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {order.map((path) => {
              const guide = GUIDES[path];
              const done = GUIDE_SECTIONS.filter((section) => progress.get(guideKey(path, section)) === "done").length;
              return (
                <Card
                  key={path}
                  title={<Link href={`/learn/${path}`} className="hover:underline">{guide.title}</Link>}
                  actions={
                    <>
                      {targets.includes(path) ? <Badge tone="primary">Your target</Badge> : null}
                      <Badge>{guide.depth === "full" ? "In depth" : "Essentials"}</Badge>
                    </>
                  }
                >
                  <p className="text-sm">{guide.oneLiner}</p>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {done} of {GUIDE_SECTIONS.length} sections understood
                    </span>
                    <ButtonLink href={`/learn/${path}`} size="sm" variant={done ? "secondary" : "primary"}>
                      {done ? "Continue" : "Read the guide"}
                    </ButtonLink>
                  </div>
                </Card>
              );
            })}
          </div>
        </section>

        <Card
          title="Your gap roadmap"
          description={
            roadmap.jobsConsidered
              ? `What your library can't yet back up, across ${roadmap.jobsConsidered} open job${roadmap.jobsConsidered === 1 ? "" : "s"}. Most common first.`
              : undefined
          }
        >
          {roadmap.topics.length ? (
            <>
              <ol className="divide-y divide-border">
                {roadmap.topics.slice(0, ROADMAP_LIMIT).map((topic) => (
                  <GapRow key={topic.id} topic={topic} progress={progress} />
                ))}
              </ol>
              {roadmap.topics.length > ROADMAP_LIMIT ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  {roadmap.topics.length - ROADMAP_LIMIT} more, each in fewer jobs. The job pages list every gap.
                </p>
              ) : null}
              <p className="mt-3 text-xs text-muted-foreground">
                If you do have the experience, add it as an achievement and re-run Match evidence on the job. A gap closes with evidence, not wording.
              </p>
            </>
          ) : (
            <EmptyState title="No gaps to plan around yet" action={<ButtonLink href="/jobs" variant="secondary">Go to Jobs</ButtonLink>}>
              Analyze a few postings and run Match evidence. The requirements your library can&apos;t back up will be grouped here, with courses that cover them.
            </EmptyState>
          )}
        </Card>

        <Card title="Courses and certificates" description={`Checked against each provider's site on ${RESOURCES_CHECKED_ON}. Prices change, so confirm before you pay.`}>
          <ul className="divide-y divide-border">
            {resources.map((resource) => (
              <ResourceItem key={resource.key} resource={resource} progress={progress} />
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}

function jobList(jobs: GapTopic["gapJobs"]) {
  return jobs.map((job, index) => (
    <span key={job.id}>
      {index ? ", " : ""}
      <Link href={`/jobs/${job.id}`} className="hover:underline">
        {job.company || job.title || "Untitled job"}
      </Link>
    </span>
  ));
}

function GapRow({ topic, progress }: { topic: GapTopic; progress: Progress }) {
  const known = topic.termKey ? progress.get(termKey(topic.termKey)) === "confident" : false;
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="min-w-[12rem] flex-1 text-sm font-semibold">
          {topic.termKey ? (
            <Link href={`/learn/glossary#term-${topic.termKey}`} className="hover:underline">
              {topic.label}
            </Link>
          ) : (
            topic.label
          )}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {topic.gapJobs.length ? (
            <Badge tone="bad">
              Gap in {topic.gapJobs.length} job{topic.gapJobs.length === 1 ? "" : "s"}
            </Badge>
          ) : null}
          {topic.mustJobs ? <Badge tone="bad">{topic.mustJobs} must-have</Badge> : null}
          {topic.transferableJobs.length ? <Badge tone="warn">Transferable in {topic.transferableJobs.length}</Badge> : null}
          {known ? <Badge tone="ok">Term known</Badge> : null}
        </div>
      </div>
      {topic.termKey && topic.examples.length ? (
        <p className="mt-1 text-xs text-muted-foreground">Asked as: {topic.examples.map((text) => `“${text}”`).join(" · ")}</p>
      ) : null}
      <p className="mt-1 text-xs text-muted-foreground">
        {topic.gapJobs.length ? <>Gap at {jobList(topic.gapJobs)}</> : null}
        {topic.gapJobs.length && topic.transferableJobs.length ? " · " : null}
        {topic.transferableJobs.length ? <>Transferable at {jobList(topic.transferableJobs)}</> : null}
      </p>
      {topic.resources.length ? (
        <p className="mt-1.5 text-sm">
          <span className="font-medium">Learn it: </span>
          {topic.resources.map((resource, index) => (
            <span key={resource.key}>
              {index ? " · " : ""}
              <a href={resource.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                {resource.title}
              </a>{" "}
              <span className="text-xs text-muted-foreground">({resource.cost.split(";")[0]})</span>
            </span>
          ))}
        </p>
      ) : null}
    </li>
  );
}
