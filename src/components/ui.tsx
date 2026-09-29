import { Check, CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import type { ApplicationStatus, EvidenceLabel, FactStatus } from "@/db/schema";
import { ObjectBreadcrumb, ObjectIcon } from "./nav";

/*
 * Server-safe building blocks styled after Salesforce Lightning (SLDS):
 * white cards on a gray canvas, brand and neutral buttons, pill badges, the
 * object-home page header and the stage Path. Interactive pieces live in
 * ./forms.tsx.
 */

export function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
const BUTTON: Record<ButtonVariant, string> = {
  // SLDS brand button
  primary: "border border-primary bg-primary text-primary-foreground hover:border-primary-hover hover:bg-primary-hover",
  // SLDS neutral button: white with brand-colored text
  secondary: "border border-input bg-card text-primary hover:bg-muted",
  // SLDS bare button
  ghost: "border border-transparent text-primary hover:bg-muted",
  // SLDS text-destructive button
  danger: "border border-input bg-card text-bad hover:bg-bad-soft",
};

export function buttonClass(variant: ButtonVariant = "primary", size: "sm" | "md" = "md") {
  return cx(
    "inline-flex items-center justify-center gap-1.5 rounded-[0.25rem] font-semibold whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50",
    size === "sm" ? "h-7 px-2.5 text-xs" : "h-8 px-4 text-[0.8125rem]",
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

/** SLDS page header: object icon, section breadcrumb, record title, actions. */
export function PageHeader({ title, description, actions, back }: { title: string; description?: ReactNode; actions?: ReactNode; back?: { href: string; label: string } }) {
  return (
    <header className="mb-3 rounded-lg border border-border bg-card px-4 py-3 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <ObjectIcon />
          <div className="min-w-0">
            <ObjectBreadcrumb back={back} />
            <h1 className="text-lg leading-tight font-bold break-words">{title}</h1>
          </div>
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {description ? <div className="mt-2 max-w-4xl text-[0.8125rem] text-muted-foreground">{description}</div> : null}
    </header>
  );
}

/** SLDS card: white, hairline border, soft shadow, bold small title. */
export function Card({ title, description, actions, children, className }: { title?: ReactNode; description?: ReactNode; actions?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <section className={cx("rounded-lg border border-border bg-card px-4 py-3 shadow-card", className)}>
      {title || actions ? (
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            {title ? <h2 className="text-sm leading-6 font-bold">{title}</h2> : null}
            {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
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
  neutral: "bg-muted text-foreground/80 ring-1 ring-inset ring-border",
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  bad: "bg-bad-soft text-bad",
  info: "bg-info-soft text-accent-foreground",
  primary: "bg-primary text-primary-foreground",
};

export function Badge({ tone = "neutral", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={cx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.6875rem] leading-4 font-semibold whitespace-nowrap", TONE[tone])}>
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
  ready: { tone: "info", label: "Ready" },
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

/** The stages a job moves through, in order (rejected and withdrawn close it instead). */
export const PATH_STAGES: ApplicationStatus[] = ["saved", "drafting", "ready", "applied", "interview", "offer"];

/** Salesforce's Path: chevron stages, green behind you, dark blue where you are. Display only. */
export function StatusPath({ status }: { status: ApplicationStatus }) {
  const closed = status === "rejected" || status === "withdrawn";
  const current = PATH_STAGES.indexOf(status);
  const steps = closed ? PATH_STAGES.slice(0, -1) : PATH_STAGES;
  return (
    <ol className="path" aria-label={`Stage: ${STATUS[status].label}`}>
      {steps.map((stage, index) => {
        const state = closed ? "incomplete" : index < current ? "complete" : index === current ? (stage === "offer" ? "won" : "current") : "incomplete";
        return (
          <li key={stage} className="path-step" data-state={state} aria-current={state === "current" || state === "won" ? "step" : undefined}>
            {state === "complete" ? <Check aria-hidden size={13} strokeWidth={3} /> : null}
            {STATUS[stage].label}
          </li>
        );
      })}
      {closed ? (
        <li className="path-step" data-state={status === "rejected" ? "lost" : "closed"} aria-current="step">
          Closed · {STATUS[status].label}
        </li>
      ) : null}
    </ol>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-input bg-muted/40 px-5 py-8 text-center">
      <p className="text-sm font-semibold">{title}</p>
      {children ? <div className="mx-auto mt-1 max-w-lg text-[0.8125rem] text-muted-foreground">{children}</div> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

const NOTICE_ICON: Record<Tone, typeof Info> = { neutral: Info, info: Info, primary: Info, ok: CircleCheck, warn: TriangleAlert, bad: CircleAlert };

/** SLDS scoped notification: tinted panel with a leading status icon. */
export function Notice({ tone = "info", children }: { tone?: Tone; children: ReactNode }) {
  const Icon = NOTICE_ICON[tone];
  const color = tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : tone === "bad" ? "text-bad" : "text-primary";
  const panel = tone === "primary" ? "bg-info-soft" : TONE[tone].split(" ")[0];
  return (
    <div className={cx("flex items-start gap-2 rounded-md px-3 py-2 text-[0.8125rem] text-foreground", panel, tone === "neutral" && "ring-1 ring-inset ring-border")}>
      <Icon aria-hidden size={16} className={cx("mt-0.5 shrink-0", color)} />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Dashboard metric tile. */
export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3 shadow-card">
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      <p className="mt-1 text-[1.75rem] leading-tight font-light tabular-nums">{value}</p>
      {hint ? <div className="mt-1 text-xs text-muted-foreground">{hint}</div> : null}
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
