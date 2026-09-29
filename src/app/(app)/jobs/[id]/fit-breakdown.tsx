import { cx } from "@/components/ui";
import type { FitResult } from "@/lib/jobs/fit";

/** The fit score as a number with a readable tone. */
export function FitScore({ score, title, size = "md" }: { score: number; title?: string; size?: "md" | "lg" }) {
  const tone = score >= 70 ? "bg-ok-soft text-ok" : score >= 45 ? "bg-warn-soft text-warn" : "bg-bad-soft text-bad";
  return (
    <span
      title={title}
      className={cx(
        "inline-flex shrink-0 flex-col items-center justify-center rounded-xl font-semibold tabular-nums",
        size === "lg" ? "h-16 w-16 text-2xl" : "h-12 w-12 text-lg",
        tone,
      )}
    >
      {score}
      <span className="text-[10px] font-medium opacity-80">fit</span>
    </span>
  );
}

/** Each component, its weight, and the points it adds. */
export function FitBreakdown({ fit }: { fit: FitResult }) {
  return (
    <div>
      <ul className="divide-y divide-border text-sm">
        {fit.components.map((c) => (
          <li key={c.key} className="py-2">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-medium">{c.label}</span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {c.points} of {c.maxPoints} pts
              </span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
              <div className="h-full rounded-full bg-primary" style={{ width: `${Math.round(c.value * 100)}%` }} />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {c.detail} Weight {c.weight}.
            </p>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted-foreground">
        Score = sum of the points above ({fit.score}/100). Unknowns count as half. Weights come from your fit settings (3 each by default). This is your own ranking, not an ATS score.
      </p>
    </div>
  );
}
