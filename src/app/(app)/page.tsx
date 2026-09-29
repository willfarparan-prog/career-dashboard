import { ArrowRight, Briefcase, CalendarClock, Check, Circle, CircleCheck, CircleDollarSign, Send, Sparkles } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { BarList, Meter, type BarDatum } from "@/components/charts";
import { Badge, ButtonLink, Card, PageHeader, StatusBadge, cx, formatDate } from "@/components/ui";
import { requireDatabase } from "@/db";
import { listApplications, groupByStatus } from "@/lib/applications/queries";
import { requireViewer } from "@/lib/auth/owner";
import { listJobs } from "@/lib/jobs/jobs";
import { gettingStarted, needsAttention, nextActions, overviewStats, upcomingDeadlines, type ChecklistStep } from "@/lib/overview/dashboard";
import { formatUsd } from "@/lib/overview/format";
import { spendSummary } from "@/lib/overview/spend";

export const metadata = { title: "Home" };

function relativeDays(days: number) {
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "1 day overdue";
  return days < 0 ? `${-days} days overdue` : `In ${days} days`;
}

function greeting(now: Date) {
  const hour = now.getUTCHours() - 5; // US-ish; only sets the tone
  const h = (hour + 24) % 24;
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

function Checklist({ steps }: { steps: ChecklistStep[] }) {
  const doneCount = steps.filter((step) => step.done).length;
  const next = steps.find((step) => !step.done);
  return (
    <Card
      title="Getting started"
      description="From your real history to a tracked application. Each step links to where you do it."
      actions={
        <span className="text-xs font-semibold text-muted-foreground tabular-nums">
          {doneCount} of {steps.length} complete
        </span>
      }
    >
      <ol className="path mb-1" aria-label="Getting started progress">
        {steps.map((step, index) => {
          const state = step.done ? "complete" : step === next ? "current" : "incomplete";
          return (
            <li key={step.key} className="path-step min-w-[7.5rem]" data-state={state}>
              <Link href={step.href} className="flex items-center gap-1 hover:underline">
                {step.done ? <Check aria-hidden size={13} strokeWidth={3} /> : <span className="tabular-nums">{index + 1}.</span>}
                {step.label}
                <span className="sr-only">{step.done ? " (done)" : " (to do)"}</span>
              </Link>
            </li>
          );
        })}
      </ol>
      {next ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md bg-info-soft px-3 py-2 text-[0.8125rem]">
          <span>
            <span className="font-semibold">Next: {next.label}.</span> <span className="text-muted-foreground">{next.description}</span>
          </span>
          <ButtonLink href={next.href} size="sm">
            Go
          </ButtonLink>
        </div>
      ) : null}
    </Card>
  );
}

function ListCard({ title, description, empty, action, children }: { title: string; description?: string; empty: string | null; action?: ReactNode; children?: ReactNode }) {
  return (
    <Card title={title} description={description} actions={action}>
      {empty ? <p className="rounded-md bg-muted px-3 py-4 text-center text-[0.8125rem] text-muted-foreground">{empty}</p> : <ul className="-my-1 divide-y divide-border">{children}</ul>}
    </Card>
  );
}

function RowLink({ href, children, aside }: { href: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <li>
      <Link href={href} className="group -mx-2 flex items-center justify-between gap-3 rounded px-2 py-2 hover:bg-muted">
        <span className="min-w-0 flex-1">{children}</span>
        {aside ? <span className="shrink-0 text-right">{aside}</span> : null}
        <ArrowRight aria-hidden size={14} className="shrink-0 text-muted-foreground group-hover:text-primary" />
      </Link>
    </li>
  );
}

/** Dashboard metric: icon chip, label, big number. */
function Metric({ icon, color, label, value, children }: { icon: ReactNode; color: string; label: string; value: ReactNode; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3 shadow-card">
      <div className="flex items-center gap-2">
        <span aria-hidden className="inline-flex size-6 items-center justify-center rounded text-white" style={{ backgroundColor: color }}>
          {icon}
        </span>
        <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      </div>
      <p className="mt-2 text-[2rem] leading-none font-light tabular-nums">{value}</p>
      {children ? <div className="mt-2 text-xs text-muted-foreground">{children}</div> : null}
    </div>
  );
}

const STAGES = [
  { status: "saved", label: "Saved", color: "var(--viz-stage-1)" },
  { status: "drafting", label: "Drafting", color: "var(--viz-stage-2)" },
  { status: "ready", label: "Ready", color: "var(--viz-stage-3)" },
  { status: "applied", label: "Applied", color: "var(--viz-stage-4)" },
  { status: "interview", label: "Interview", color: "var(--viz-stage-5)" },
] as const;

export default async function Home() {
  const viewer = await requireViewer();
  const { userId } = viewer;
  const db = requireDatabase();
  const now = new Date();
  const [checklist, stats, spend, actions, deadlines, attention, applications, jobs] = await Promise.all([
    gettingStarted(db, userId),
    overviewStats(db, userId, now),
    spendSummary(db, userId, now),
    nextActions(db, userId, now),
    upcomingDeadlines(db, userId, now),
    needsAttention(db, userId),
    listApplications(db, userId),
    listJobs(db, userId, now),
  ]);

  const groups = groupByStatus(applications);
  const pipeline: BarDatum[] = [
    ...STAGES.map(({ status, label, color }) => ({ key: status, label, value: groups[status].length, color, href: "/applications" })),
    {
      key: "offer",
      label: "Offer",
      value: groups.offer.length,
      color: "var(--viz-good)",
      href: "/applications",
      marker: <CircleCheck aria-hidden size={14} className="shrink-0 text-ok" />,
    },
    {
      key: "closed",
      label: "Closed",
      value: groups.rejected.length + groups.withdrawn.length,
      color: "var(--viz-closed)",
      href: "/applications",
      detail: `${groups.rejected.length} rejected · ${groups.withdrawn.length} withdrawn`,
    },
  ];
  const openJobs = jobs.filter((item) => item.job.postingStatus !== "closed" && item.applicationStatus !== "rejected" && item.applicationStatus !== "withdrawn");
  const topJobs: BarDatum[] = openJobs.slice(0, 6).map(({ job, fit }) => ({
    key: job.id,
    label: [job.title || "Untitled role", job.company].filter(Boolean).join(" · "),
    value: fit.score,
    display: String(fit.score),
    color: "var(--viz-series-1)",
    href: `/jobs/${job.id}`,
    detail: fit.components
      .slice()
      .sort((a, b) => b.points - a.points)
      .slice(0, 3)
      .map((c) => `${c.label} ${Math.round(c.points)}/${Math.round(c.maxPoints)}`)
      .join(" · "),
  }));
  const firstName = viewer.name.trim().split(/\s+/)[0];

  return (
    <>
      <PageHeader
        title={`${greeting(now)}${firstName ? `, ${firstName}` : ""}`}
        description="Your pipeline, what's due, and what needs attention."
        actions={
          <>
            <ButtonLink href="/profile/import" variant="secondary">
              Import resume
            </ButtonLink>
            <ButtonLink href="/jobs/new">New job</ButtonLink>
          </>
        }
      />

      <div className="space-y-3">
        {!checklist.done ? <Checklist steps={checklist.steps} /> : null}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Metric icon={<Briefcase size={14} />} color="#f4a24b" label="Active applications" value={stats.active}>
            Not rejected or withdrawn
          </Metric>
          <Metric icon={<Send size={14} />} color="#0176d3" label="Applied this month" value={stats.appliedThisMonth} />
          <Metric icon={<CalendarClock size={14} />} color="#3ba755" label="Interviews" value={stats.interviews} />
          <Metric icon={<CircleDollarSign size={14} />} color="#20b7a8" label="Claude today" value={formatUsd(spend.today)}>
            <Link href="/activity" className="hover:text-foreground hover:underline">
              of {formatUsd(spend.dailyBudget)} daily budget
            </Link>
            <Meter value={spend.today} max={spend.dailyBudget} label="Claude spend today against the daily budget" />
          </Metric>
        </div>

        <div className="grid gap-3 lg:grid-cols-3">
          <div className="min-w-0 space-y-3 lg:col-span-2">
            <Card
              title="Pipeline by stage"
              description={`${applications.length} job${applications.length === 1 ? "" : "s"} tracked · stages run top to bottom`}
              actions={
                <Link href="/applications" className="text-xs font-semibold text-primary hover:underline">
                  View report
                </Link>
              }
            >
              <BarList data={pipeline} unit="applications" showShare emptyLabel="No applications yet. Add a job to start your pipeline." />
            </Card>

            <Card
              title="Top jobs by fit"
              description="Your own ranking (0–100): pay, location, evidence, interest and growth."
              actions={
                <Link href="/jobs" className="text-xs font-semibold text-primary hover:underline">
                  All jobs
                </Link>
              }
            >
              <BarList data={topJobs} max={100} unit="/ 100 fit" labelWidth="14rem" emptyLabel="No open jobs yet. Paste a posting to see how well it fits." />
            </Card>

            <ListCard title="Needs attention" description="Unfinished work that blocks a good application." empty={attention.length ? null : "All clear. Nothing is waiting on you."}>
              {attention.map((item) => (
                <RowLink key={item.key} href={item.href} aside={<Badge tone={item.tone}>{item.kind.startsWith("achievements") ? "Library" : item.kind === "draft" ? "Draft" : "Job"}</Badge>}>
                  <span className="block text-[0.8125rem] font-semibold break-words">{item.label}</span>
                  <span className="block text-xs text-muted-foreground">{item.detail}</span>
                </RowLink>
              ))}
            </ListCard>
          </div>

          <div className="min-w-0 space-y-3">
            <ListCard
              title="Next actions"
              description="Overdue or due in the next 7 days."
              empty={actions.length ? null : "Nothing due this week. Set a next action on any application to see it here."}
              action={
                <Link href="/applications" className="text-xs font-semibold text-primary hover:underline">
                  All applications
                </Link>
              }
            >
              {actions.map((item) => (
                <RowLink
                  key={item.applicationId}
                  href={`/applications/${item.applicationId}`}
                  aside={
                    <span className={cx("text-xs font-semibold", item.daysLeft < 0 ? "text-bad" : item.daysLeft === 0 ? "text-warn" : "text-muted-foreground")}>
                      {relativeDays(item.daysLeft)}
                    </span>
                  }
                >
                  <span className="flex items-center gap-1.5 text-[0.8125rem] font-semibold">
                    <Circle aria-hidden size={12} className="shrink-0 text-muted-foreground" />
                    <span className="truncate">{item.nextAction || "Follow up"}</span>
                  </span>
                  <span className="flex min-w-0 items-center gap-2 pl-[18px] text-xs text-muted-foreground">
                    <span className="min-w-0 truncate">{[item.title, item.company].filter(Boolean).join(" · ") || "Untitled job"}</span>
                    <StatusBadge status={item.status} />
                  </span>
                </RowLink>
              ))}
            </ListCard>

            <ListCard title="Upcoming deadlines" description="Not applied yet; closing in the next 14 days." empty={deadlines.length ? null : "No deadlines in the next two weeks."}>
              {deadlines.map((item) => (
                <RowLink
                  key={item.jobId}
                  href={`/jobs/${item.jobId}`}
                  aside={
                    <span className="block text-xs">
                      <span className={cx("block font-semibold", item.daysLeft <= 2 ? "text-bad" : item.daysLeft <= 5 ? "text-warn" : "text-muted-foreground")}>
                        {relativeDays(item.daysLeft)}
                      </span>
                      <span className="text-muted-foreground">{formatDate(item.date)}</span>
                    </span>
                  }
                >
                  <span className="block truncate text-[0.8125rem] font-semibold">{item.title || "Untitled job"}</span>
                  <span className="block truncate text-xs text-muted-foreground">{item.company || "Company not set"}</span>
                </RowLink>
              ))}
            </ListCard>

            <Card title="Claude">
              <div className="flex items-start gap-3 text-[0.8125rem]">
                <span aria-hidden className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-info-soft text-primary">
                  <Sparkles size={16} />
                </span>
                <p className="text-muted-foreground">
                  {formatUsd(spend.today)} spent today of {formatUsd(spend.dailyBudget)}. Every call is logged with its tokens and cost.{" "}
                  <Link href="/activity" className="font-semibold text-primary hover:underline">
                    Open activity
                  </Link>
                </p>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}
