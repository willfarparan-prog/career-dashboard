import Link from "next/link";
import type { ReactNode } from "react";
import type { ApplicationStatus, EvidenceLabel, FactStatus } from "@/db/schema";

/* Server-safe building blocks. Interactive pieces live in ./forms.tsx. */

export function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
const BUTTON: Record<ButtonVariant, string> = {
  primary: "bg-primary text-primary-foreground hover:opacity-90",
  secondary: "border border-border bg-card text-foreground hover:bg-muted",
  ghost: "text-muted-foreground hover:bg-muted hover:text-foreground",
  danger: "border border-bad/40 bg-card text-bad hover:bg-bad-soft",
};

export function buttonClass(variant: ButtonVariant = "primary", size: "sm" | "md" = "md") {
  return cx(
    "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:pointer-events-none disabled:opacity-50",
    size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-2 text-sm",
    BUTTON[variant],
  );
}

export function ButtonLink({ href, children, variant = "primary", size = "md" }: { href: string; children: ReactNode; variant?: ButtonVariant; size?: "sm" | "md" }) {
  return (
    <Link href={href} className={buttonClass(variant, size)}>
      {children}
    </Link>
  );
}

export function PageHeader({ title, description, actions, back }: { title: string; description?: ReactNode; actions?: ReactNode; back?: { href: string; label: string } }) {
  return (
    <header className="mb-6">
      {back ? (
        <Link href={back.href} className="mb-2 inline-block text-sm text-muted-foreground hover:text-foreground">
          ← {back.label}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description ? <div className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</div> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}

export function Card({ title, description, actions, children, className }: { title?: ReactNode; description?: ReactNode; actions?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <section className={cx("rounded-xl border border-border bg-card p-4 md:p-5", className)}>
      {title || actions ? (
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            {title ? <h2 className="text-base font-semibold">{title}</h2> : null}
            {description ? <p className="mt-0.5 text-sm text-muted-foreground">{description}</p> : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

type Tone = "neutral" | "ok" | "warn" | "bad" | "info" | "primary";
const TONE: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground",
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  bad: "bg-bad-soft text-bad",
  info: "bg-info-soft text-foreground",
  primary: "bg-accent text-accent-foreground",
};

export function Badge({ tone = "neutral", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={cx("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", TONE[tone])}>
      {children}
    </span>
  );
}

const FACT: Record<FactStatus, { tone: Tone; label: string }> = {
  verified: { tone: "ok", label: "Verified" },
  approximate: { tone: "warn", label: "Approximate" },
  private: { tone: "neutral", label: "Private" },
  needs_confirmation: { tone: "bad", label: "Needs confirmation" },
};

export function FactBadge({ status }: { status: FactStatus }) {
  const { tone, label } = FACT[status];
  return <Badge tone={tone}>{label}</Badge>;
}

export const FACT_OPTIONS = Object.entries(FACT).map(([value, { label }]) => ({ value: value as FactStatus, label }));

const EVIDENCE: Record<EvidenceLabel, { tone: Tone; label: string }> = {
  strong: { tone: "ok", label: "Strong evidence" },
  transferable: { tone: "warn", label: "Transferable" },
  gap: { tone: "bad", label: "Gap" },
};

export function EvidenceBadge({ label }: { label: EvidenceLabel | null }) {
  if (!label) return <Badge>Not matched</Badge>;
  const { tone, label: text } = EVIDENCE[label];
  return <Badge tone={tone}>{text}</Badge>;
}

const STATUS: Record<ApplicationStatus, { tone: Tone; label: string }> = {
  saved: { tone: "neutral", label: "Saved" },
  drafting: { tone: "info", label: "Drafting" },
  ready: { tone: "primary", label: "Ready" },
  applied: { tone: "primary", label: "Applied" },
  interview: { tone: "ok", label: "Interview" },
  offer: { tone: "ok", label: "Offer" },
  rejected: { tone: "bad", label: "Rejected" },
  withdrawn: { tone: "neutral", label: "Withdrawn" },
};

export function StatusBadge({ status }: { status: ApplicationStatus }) {
  const { tone, label } = STATUS[status];
  return <Badge tone={tone}>{label}</Badge>;
}

export const STATUS_OPTIONS = Object.entries(STATUS).map(([value, { label }]) => ({ value: value as ApplicationStatus, label }));

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-border px-5 py-8 text-center">
      <p className="font-medium">{title}</p>
      {children ? <div className="mx-auto mt-1 max-w-lg text-sm text-muted-foreground">{children}</div> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: Tone; children: ReactNode }) {
  return <div className={cx("rounded-lg px-3 py-2 text-sm", TONE[tone])}>{children}</div>;
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function formatDate(value: Date | string | null | undefined) {
  if (!value) return "";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function formatMoney(value: number | null | undefined) {
  if (value == null) return "";
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}
