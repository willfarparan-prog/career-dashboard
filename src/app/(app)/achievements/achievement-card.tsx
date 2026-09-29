import Link from "next/link";
import { Badge, FactBadge } from "@/components/ui";
import type { Achievement } from "@/lib/ai/library";
import { formatMetricValue, metricPrompts } from "@/lib/career/achievements";
import { VerifyButton } from "../profile/item-controls";

export function MetricPrompt({ prompts }: { prompts: string[] }) {
  if (!prompts.length) return null;
  return (
    <p className="text-xs text-warn">
      <span className="font-medium">Add a number for:</span> {prompts.join(", ")}
    </p>
  );
}

export function AchievementCard({ achievement: a }: { achievement: Achievement }) {
  const prompts = metricPrompts(a);
  return (
    <article className="grid gap-2 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="min-w-0 font-medium break-words">
          <Link href={`/achievements/${a.id}`} className="hover:underline">
            {a.headline}
          </Link>
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          <FactBadge status={a.factStatus} />
          <VerifyButton kind="achievement" id={a.id} status={a.factStatus} />
        </div>
      </div>
      {a.outcome ? <p className="text-sm break-words">{a.outcome}</p> : a.action ? <p className="text-sm break-words text-muted-foreground">{a.action}</p> : null}
      {a.metrics.length ? (
        <ul className="flex flex-wrap gap-2" aria-label="Numbers">
          {a.metrics.map((m, i) => (
            <li key={i} className="inline-flex max-w-full flex-wrap items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs">
              <span className="font-semibold tabular-nums">{formatMetricValue(m)}</span>
              <span className="break-words text-muted-foreground">{m.label}</span>
              {m.status !== "verified" ? <FactBadge status={m.status} /> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {a.tags.length ? (
        <div className="flex flex-wrap gap-1.5">
          {a.tags.map((tag) => (
            <Link key={tag} href={`/achievements?tag=${encodeURIComponent(tag)}`} className="rounded-full hover:opacity-80">
              <Badge tone="primary">{tag}</Badge>
            </Link>
          ))}
        </div>
      ) : null}
      <MetricPrompt prompts={prompts} />
    </article>
  );
}
