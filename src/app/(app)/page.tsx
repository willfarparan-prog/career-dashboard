import { ArrowRight, Circle, CircleCheck } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Badge, ButtonLink, Card, PageHeader, Stat, StatusBadge, cx, formatDate } from "@/components/ui";
import { requireDatabase } from "@/db";
import { requireViewer } from "@/lib/auth/owner";
import { gettingStarted, needsAttention, nextActions, overviewStats, upcomingDeadlines, type ChecklistStep } from "@/lib/overview/dashboard";
import { formatUsd } from "@/lib/overview/format";
import { spendSummary } from "@/lib/overview/spend";

export const metadata = { title: "Overview" };

function relativeDays(days: number) {
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "1 day overdue";
  return days < 0 ? `${-days} days overdue` : `In ${days} days`;
}

function Checklist({ steps }: { steps: ChecklistStep[] }) {
  const doneCount = steps.filter((step) => step.done).length;
  const next = steps.find((step) => !step.done);
  return (
    <Card
      title="Getting started"
      description="From your real history to a tracked application. Each step links to where you do it."
      actions={
        <span className="text-sm text-muted-foreground tabular-nums">
          {doneCount} of {steps.length} done
        </span>
      }
    >
      <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={doneCount} aria-label="Getting started progress">
        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.round((doneCount / steps.length) * 100)}%` }} />
      </div>
      <ol className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {steps.map((step, index) => {
          const isNext = step === next;
          return (
            <li key={step.key}>
              <Link
                href={step.href}
                className={cx(
                  "flex h-full items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-muted",
                  isNext ? "border-primary/50 bg-accent/40" : "border-border",
                )}
              >
                {step.done ? (
                  <CircleCheck aria-hidden size={18} className="mt-0.5 shrink-0 text-ok" />
                ) : (
                  <Circle aria-hidden size={18} className={cx("mt-0.5 shrink-0", isNext ? "text-primary" : "text-muted-foreground")} />
                )}
                <span className="min-w-0">
                  <span className={cx("block text-sm font-medium", step.done && "text-muted-foreground line-through decoration-muted-foreground/50")}>
                    {index + 1}. {step.label}
                    <span className="sr-only">{step.done ? " (done)" : " (to do)"}</span>
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{step.description}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

function ListCard({ title, description, empty, action, children }: { title: string; description?: string; empty: string | null; action?: ReactNode; children?: ReactNode }) {
  return (
    <Card title={title} description={description} actions={action}>
      {empty ? <p className="rounded-lg bg-muted px-3 py-4 text-center text-sm text-muted-foreground">{empty}</p> : <ul className="-my-1 divide-y divide-border">{children}</ul>}
    </Card>
  );
}

function RowLink({ href, children, aside }: { href: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <li>
      <Link href={href} className="group -mx-2 flex items-center justify-between gap-3 rounded-md px-2 py-2.5 hover:bg-muted">
        <span className="min-w-0 flex-1">{children}</span>
        {aside ? <span className="shrink-0 text-right">{aside}</span> : null}
        <ArrowRight aria-hidden size={14} className="shrink-0 text-muted-foreground group-hover:text-foreground" />
      </Link>
    </li>
  );
}

export default async function Overview() {
  const { userId } = await requireViewer();
  const db = requireDatabase();
  const now = new Date();
  const [checklist, stats, spend, actions, deadlines, attention] = await Promise.all([
    gettingStarted(db, userId),
    overviewStats(db, userId, now),
    spendSummary(db, userId, now),
    nextActions(db, userId, now),
    upcomingDeadlines(db, userId, now),
    needsAttention(db, userId),
  ]);
  const budgetShare = spend.dailyBudget > 0 ? Math.min(spend.today / spend.dailyBudget, 1) : 0;

  return (
    <>
      <PageHeader title="Overview" description="Pipeline, next actions and Claude spend." actions={<ButtonLink href="/jobs" variant="secondary">Add a job</ButtonLink>} />

      <div className="space-y-6">
        {!checklist.done ? <Checklist steps={checklist.steps} /> : null}

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Active applications" value={stats.active} hint="Not rejected or withdrawn" />
          <Stat label="Applied this month" value={stats.appliedThisMonth} />
          <Stat label="Interviews" value={stats.interviews} />
          <Stat
            label="Claude today"
            value={formatUsd(spend.today)}
            hint={
              <>
                <Link href="/activity" className="hover:text-foreground hover:underline">
                  of {formatUsd(spend.dailyBudget)} budget
                </Link>
                <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-muted" role="presentation">
                  <span
                    className={cx("block h-full rounded-full", budgetShare >= 1 ? "bg-bad" : budgetShare >= 0.8 ? "bg-warn" : "bg-primary")}
                    style={{ width: `${Math.round(budgetShare * 100)}%` }}
                  />
                </span>
              </>
            }
          />
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <ListCard
            title="Next actions"
            description="Overdue or due in the next 7 days."
            empty={actions.length ? null : "Nothing due this week. Set a next action on any application to see it here."}
            action={
              <Link href="/applications" className="text-sm font-medium text-primary hover:underline">
                All applications
              </Link>
            }
          >
            {actions.map((item) => (
              <RowLink
                key={item.applicationId}
                href={`/applications/${item.applicationId}`}
                aside={
                  <span className={cx("text-xs font-medium", item.daysLeft < 0 ? "text-bad" : item.daysLeft === 0 ? "text-warn" : "text-muted-foreground")}>
                    {relativeDays(item.daysLeft)}
                  </span>
                }
              >
                <span className="block truncate text-sm font-medium">{item.nextAction || "Follow up"}</span>
                <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                  <span className="min-w-0 truncate">{[item.title, item.company].filter(Boolean).join(" · ") || "Untitled job"}</span>
                  <StatusBadge status={item.status} />
                </span>
              </RowLink>
            ))}
          </ListCard>

          <ListCard
            title="Upcoming deadlines"
            description="Jobs you haven't applied to that close in the next 14 days."
            empty={deadlines.length ? null : "No deadlines in the next two weeks."}
          >
            {deadlines.map((item) => (
              <RowLink
                key={item.jobId}
                href={`/jobs/${item.jobId}`}
                aside={
                  <span className="block text-xs">
                    <span className={cx("block font-medium", item.daysLeft <= 2 ? "text-bad" : item.daysLeft <= 5 ? "text-warn" : "text-muted-foreground")}>
                      {relativeDays(item.daysLeft)}
                    </span>
                    <span className="text-muted-foreground">{formatDate(item.date)}</span>
                  </span>
                }
              >
                <span className="block truncate text-sm font-medium">{item.title || "Untitled job"}</span>
                <span className="block truncate text-xs text-muted-foreground">{item.company || "Company not set"}</span>
              </RowLink>
            ))}
          </ListCard>
        </div>

        <ListCard title="Needs attention" description="Unfinished work that blocks a good application." empty={attention.length ? null : "All clear. Nothing is waiting on you."}>
          {attention.map((item) => (
            <RowLink key={item.key} href={item.href} aside={<Badge tone={item.tone}>{item.kind.startsWith("achievements") ? "Library" : item.kind === "draft" ? "Draft" : "Job"}</Badge>}>
              <span className="block text-sm font-medium break-words">{item.label}</span>
              <span className="block text-xs text-muted-foreground">{item.detail}</span>
            </RowLink>
          ))}
        </ListCard>
      </div>
    </>
  );
}
