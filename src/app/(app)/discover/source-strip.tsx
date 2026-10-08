import { Meter } from "@/components/charts";
import { Badge, Card } from "@/components/ui";
import type { SourceStatus } from "@/lib/discover/leads";
import { safeHref, timeAgo } from "./format";

const RUN_LABEL = { ok: "OK", error: "Failed", skipped: "Skipped" } as const;
const RUN_TONE = { ok: "ok", error: "bad", skipped: "neutral" } as const;

function Quota({ status }: { status: SourceStatus }) {
  const lines: Array<{ key: string; text: string; used: number; max: number | null; label: string }> = [];
  if (status.monthlyQuota) lines.push({ key: "month", text: `${status.usedThisMonth} / ${status.monthlyQuota} this month`, used: status.usedThisMonth, max: status.monthlyQuota, label: `${status.label} requests this month` });
  if (status.dailyQuota) lines.push({ key: "day", text: `${status.usedToday} / ${status.dailyQuota} today`, used: status.usedToday, max: status.dailyQuota, label: `${status.label} requests today` });
  if (!lines.length) {
    return <p className="text-xs text-muted-foreground">{status.usedThisMonth ? `${status.usedThisMonth} request${status.usedThisMonth === 1 ? "" : "s"} this month · no quota` : "No quota"}</p>;
  }
  return (
    <div className="space-y-1">
      {lines.map((line) => (
        <div key={line.key}>
          <p className="text-xs text-muted-foreground tabular-nums">{line.text}</p>
          {line.max ? <Meter value={line.used} max={line.max} label={line.label} /> : null}
        </div>
      ))}
    </div>
  );
}

function SourceCard({ status, now }: { status: SourceStatus; now: Date }) {
  const run = status.lastRun;
  const credit = status.attribution ? safeHref(status.attribution.href) : null;
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-md border border-border bg-card p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 text-[0.8125rem] font-semibold break-words">{status.label}</p>
        {status.configured ? <Badge tone="ok">Configured</Badge> : <Badge tone="warn">Not set up</Badge>}
      </div>
      <p className="text-xs break-words text-muted-foreground">{status.description}</p>
      {status.configured ? (
        <>
          <Quota status={status} />
          <p className="text-xs break-words">
            {run ? (
              <>
                <Badge tone={RUN_TONE[run.status]}>{RUN_LABEL[run.status]}</Badge>{" "}
                <span className="text-muted-foreground">
                  {timeAgo(run.at, now)}
                  {run.message ? ` · ${run.message}` : run.status === "ok" ? ` · found ${run.found}, ${run.added} new` : ""}
                </span>
              </>
            ) : (
              <span className="text-muted-foreground">Not run yet.</span>
            )}
          </p>
        </>
      ) : (
        <p className="text-xs break-words">
          {status.envVars.length ? (
            <>
              Add{" "}
              {status.envVars.map((name, index) => (
                <span key={name}>
                  {index ? (index === status.envVars.length - 1 ? " and " : ", ") : null}
                  <code className="rounded bg-muted px-1 font-mono text-[0.6875rem] whitespace-nowrap">{name}</code>
                </span>
              ))}{" "}
              in Vercel → Settings → Environment Variables, then redeploy. Signing up is free.
            </>
          ) : (
            "This source isn't available right now."
          )}
        </p>
      )}
      {status.attribution ? (
        <p className="mt-auto text-[0.6875rem] text-muted-foreground">
          {credit ? (
            <a href={credit} target="_blank" rel="noopener noreferrer" className="hover:text-foreground hover:underline">
              {status.attribution.text}
            </a>
          ) : (
            status.attribution.text
          )}
        </p>
      ) : null}
    </div>
  );
}

/** A source to look at: not set up, its last fetch failed, or its quota is nearly spent. */
export function needsAttention(status: SourceStatus): boolean {
  if (!status.configured || status.lastRun?.status === "error") return true;
  const nearly = (used: number, max: number | null) => max != null && max > 0 && used >= 0.9 * max;
  return nearly(status.usedThisMonth, status.monthlyQuota) || nearly(status.usedToday, status.dailyQuota);
}

/** "5 working · 1 failed": what the collapsed panel says. */
export function sourceSummary(statuses: SourceStatus[]): string {
  const failed = statuses.filter((s) => s.configured && s.lastRun?.status === "error").length;
  const missing = statuses.filter((s) => !s.configured).length;
  const parts = [`${statuses.length - failed - missing} working`];
  if (failed) parts.push(`${failed} failed`);
  if (missing) parts.push(`${missing} not set up`);
  return parts.join(" · ");
}

/**
 * One small card per source: set up or not, quota used, last fetch. Collapsed
 * to one line so postings come first; opens by itself when a source needs
 * attention. Renders nothing without sources.
 */
export function SourceStrip({ statuses, now }: { statuses: SourceStatus[]; now: Date }) {
  if (!statuses.length) return null;
  const attention = statuses.some(needsAttention);
  return (
    <Card>
      <details open={attention}>
        <summary className="cursor-pointer text-[0.8125rem]">
          <span className="font-semibold">Sources</span>
          <span className="text-muted-foreground"> · {sourceSummary(statuses)}</span>
        </summary>
        <p className="mt-1 text-xs text-muted-foreground">Discover only reads listings; it never applies anywhere for you.</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {statuses.map((status) => (
            <SourceCard key={status.id} status={status} now={now} />
          ))}
        </div>
      </details>
    </Card>
  );
}
