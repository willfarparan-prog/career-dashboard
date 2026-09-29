import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "./ui";

/*
 * Lightweight dashboard charts: server-rendered HTML, no chart library.
 * Horizontal bars with direct value labels (the labels are the data, so the
 * chart reads without color), 4px rounded data ends anchored to the baseline,
 * a recessive track, and a hover/focus tooltip per bar. Colors come from the
 * --viz-* tokens in globals.css (validated ramps, stepped separately for dark).
 */

export type BarDatum = {
  key: string;
  label: string;
  value: number;
  /** CSS color, normally var(--viz-…). */
  color: string;
  href?: string;
  /** Shown in the tooltip under the headline. */
  detail?: ReactNode;
  /** A glyph shown before the label (e.g. a check for "Offer") so meaning never rides on color alone. */
  marker?: ReactNode;
  /** Right-hand value text; defaults to the value. */
  display?: string;
};

export function BarList({ data, max, unit, emptyLabel, showShare = false, labelWidth = "8rem" }: { data: BarDatum[]; max?: number; unit: string; emptyLabel: string; showShare?: boolean; labelWidth?: string }) {
  const top = Math.max(max ?? 0, ...data.map((d) => d.value), 1);
  const total = data.reduce((sum, d) => sum + d.value, 0);
  if (!data.length) return <p className="rounded-md bg-muted px-3 py-6 text-center text-[0.8125rem] text-muted-foreground">{emptyLabel}</p>;
  return (
    <ul className="grid gap-1.5" style={{ ["--label-w" as string]: labelWidth }}>
      {data.map((d) => {
        const width = d.value > 0 ? Math.max((d.value / top) * 100, 1.5) : 0;
        const inner = (
          <>
            <span className="flex min-w-0 items-center gap-1.5 text-[0.8125rem] sm:w-[var(--label-w)] sm:shrink-0">
              {d.marker}
              <span className="min-w-0 truncate">{d.label}</span>
            </span>
            <span className="relative flex h-5 w-full min-w-0 shrink-0 items-center sm:w-auto sm:flex-1">
              <span className="absolute inset-y-0 left-0 right-0 rounded-r bg-[var(--viz-track)]" aria-hidden />
              <span className="relative h-full rounded-r-[4px]" style={{ width: `${width}%`, backgroundColor: d.color }} aria-hidden />
              <span className="relative ml-2 shrink-0 text-xs font-semibold tabular-nums">{d.display ?? d.value}</span>
            </span>
            <span
              role="tooltip"
              className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden w-max max-w-64 -translate-x-1/2 rounded-md bg-[#181818] px-2.5 py-1.5 text-xs text-white shadow-lg group-hover:block group-focus-visible:block"
            >
              <span className="block font-semibold">
                {d.label}: {d.display ?? d.value} {unit}
              </span>
              {showShare && total > 0 ? <span className="block text-white/80">{Math.round((d.value / total) * 100)}% of all</span> : null}
              {d.detail ? <span className="block text-white/80">{d.detail}</span> : null}
            </span>
          </>
        );
        const row = "group relative flex flex-col gap-0.5 rounded px-1 py-1 sm:flex-row sm:items-center sm:gap-3";
        return (
          <li key={d.key}>
            {d.href ? (
              <Link href={d.href} className={cx(row, "hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring")}>
                {inner}
              </Link>
            ) : (
              <div className={row} tabIndex={0}>
                {inner}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** A thin meter against a limit (e.g. today's Claude spend vs the budget). */
export function Meter({ value, max, label }: { value: number; max: number; label: string }) {
  const share = max > 0 ? Math.min(value / max, 1) : 0;
  const color = share >= 1 ? "var(--bad)" : share >= 0.8 ? "#dd7a01" : "var(--viz-series-1)";
  return (
    <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-[var(--viz-track)]" role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-label={label}>
      <span className="block h-full rounded-full" style={{ width: `${Math.round(share * 100)}%`, backgroundColor: color }} />
    </span>
  );
}
