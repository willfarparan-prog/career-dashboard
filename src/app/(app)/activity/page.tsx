import { Badge, Card, EmptyState, PageHeader, Stat, cx } from "@/components/ui";
import { requireDatabase } from "@/db";
import { formatDateTime, formatDuration, formatTokens, formatUsd } from "@/lib/overview/format";
import { recentRuns, spendSummary, type AiRun } from "@/lib/overview/spend";
import { requireViewer } from "@/lib/auth/owner";

export const metadata = { title: "Claude activity" };

const STATUS: Record<AiRun["status"], { tone: "ok" | "bad" | "warn"; label: string }> = {
  ok: { tone: "ok", label: "OK" },
  error: { tone: "bad", label: "Error" },
  refused: { tone: "warn", label: "Refused" },
  blocked: { tone: "warn", label: "Over budget" },
  truncated: { tone: "warn", label: "Cut off" },
};

const LIMIT = 200;

function BudgetMeter({ spent, budget }: { spent: number; budget: number }) {
  const share = budget > 0 ? Math.min(spent / budget, 1) : 0;
  return (
    <span className="mt-2 block h-1.5 w-full overflow-hidden rounded-full bg-muted" role="presentation">
      <span className={cx("block h-full rounded-full", share >= 1 ? "bg-bad" : share >= 0.8 ? "bg-warn" : "bg-primary")} style={{ width: `${Math.round(share * 100)}%` }} />
    </span>
  );
}

export default async function ActivityPage() {
  const { userId } = await requireViewer();
  const db = requireDatabase();
  const now = new Date();
  const [runs, spend] = await Promise.all([recentRuns(db, userId, LIMIT), spendSummary(db, userId, now)]);
  const monthName = now.toLocaleString("en-US", { month: "long", timeZone: "UTC" });

  return (
    <>
      <PageHeader title="Claude activity" description="Every call to Claude: what it was for, the tokens it used and what it cost. Costs are estimates from Anthropic's list prices." />

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Stat
          label="Spent today"
          value={formatUsd(spend.today)}
          hint={
            <>
              of {formatUsd(spend.dailyBudget)} daily budget · resets midnight UTC
              <BudgetMeter spent={spend.today} budget={spend.dailyBudget} />
            </>
          }
        />
        <Stat label={`Spent in ${monthName}`} value={formatUsd(spend.month)} hint={`${spend.runsMonth.toLocaleString("en-US")} ${spend.runsMonth === 1 ? "call" : "calls"} this month`} />
        <Stat label="Calls today" value={spend.runsToday.toLocaleString("en-US")} hint="Including errors and blocked calls" />
      </div>

      {runs.length ? (
        <Card title="Recent calls" description={runs.length === LIMIT ? `The latest ${LIMIT}. Times are UTC.` : "Newest first. Times are UTC."}>
          <div className="-mx-4 overflow-x-auto md:-mx-5">
            <table className="w-full min-w-[56rem] text-left text-sm">
              <thead className="border-b border-border text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-2 font-medium md:pl-5">Time</th>
                  <th scope="col" className="px-2 py-2 font-medium">Task</th>
                  <th scope="col" className="px-2 py-2 font-medium">Model</th>
                  <th scope="col" className="px-2 py-2 font-medium">Status</th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">Input</th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">Output</th>
                  <th scope="col" className="px-2 py-2 text-right font-medium" title="Cache reads / cache writes">Cache r/w</th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">Cost</th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">Time taken</th>
                  <th scope="col" className="px-4 py-2 font-medium md:pr-5">Error</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {runs.map((run) => (
                  <tr key={run.id} className="align-top">
                    <td className="px-4 py-2 whitespace-nowrap tabular-nums md:pl-5">{formatDateTime(run.createdAt)}</td>
                    <td className="px-2 py-2">
                      <span className="font-medium">{run.task}</span>
                      <span className="block text-xs text-muted-foreground">{run.promptVersion}</span>
                    </td>
                    <td className="px-2 py-2 text-xs whitespace-nowrap text-muted-foreground">{run.model}</td>
                    <td className="px-2 py-2">
                      <Badge tone={STATUS[run.status].tone}>{STATUS[run.status].label}</Badge>
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">{formatTokens(run.inputTokens)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{formatTokens(run.outputTokens)}</td>
                    <td className="px-2 py-2 text-right whitespace-nowrap tabular-nums text-muted-foreground">
                      {formatTokens(run.cacheReadTokens)} / {formatTokens(run.cacheWriteTokens)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">{formatUsd(run.costUsd, { precise: true })}</td>
                    <td className="px-2 py-2 text-right whitespace-nowrap tabular-nums">{formatDuration(run.durationMs)}</td>
                    <td className="max-w-[18rem] px-4 py-2 text-xs break-words text-bad md:pr-5">{run.error ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <EmptyState title="No Claude calls yet">
          When Claude reads an import, analyzes a posting or drafts a resume, each call shows up here with its tokens and cost.
        </EmptyState>
      )}
    </>
  );
}
