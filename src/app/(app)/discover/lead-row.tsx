import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, ButtonLink, buttonClass, cx } from "@/components/ui";
import type { LeadListItem } from "@/lib/discover/leads";
import { checkFitAction, saveLeadAction, setLeadStatusAction } from "./actions";
import { FitReviewDetails } from "./explore-panel";
import type { FitReview } from "@/lib/discover/explore-types";
import { placeLabel, previewText, safeHref, salaryLabel, scoreTone, timeAgo } from "./format";

const CHIP: Record<ReturnType<typeof scoreTone>, string> = {
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  neutral: "bg-muted text-foreground/80 ring-1 ring-inset ring-border",
};

function ScoreChip({ score, title }: { score: number; title: string }) {
  return (
    <span title={title} className={cx("inline-flex size-11 shrink-0 flex-col items-center justify-center rounded-lg text-base leading-none font-semibold tabular-nums", CHIP[scoreTone(score)])}>
      {score}
      <span className="mt-0.5 text-[0.5625rem] font-medium opacity-80">match</span>
    </span>
  );
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

const points = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "0");

/** One posting in the inbox: what it is, why it scored, and what to do with it. */
export function LeadRow({ lead, sourceLabel, attribution, now, ai, showStatus, explore = false, review }: {
  explore?: boolean;
  review?: { content: FitReview; stale: boolean };
  lead: LeadListItem;
  sourceLabel: string;
  attribution: { text: string; href: string } | null;
  now: Date;
  ai: boolean;
  showStatus: boolean;
}) {
  const posting = safeHref(lead.url);
  const place = placeLabel(lead);
  const salary = salaryLabel(lead);
  const preview = previewText(lead.description);
  const reasons = [...lead.scoreReasons].sort((a, b) => b.points - a.points);
  const reasonText = reasons.length ? reasons.map((r) => `${points(r.points)} ${r.label}`).join("\n") : "No score details";
  const credit = attribution ? safeHref(attribution.href) : null;
  const seen = new Set([lead.url]);
  const options = lead.applyOptions.filter((option) => {
    if (!safeHref(option.url) || seen.has(option.url)) return false;
    seen.add(option.url);
    return true;
  });
  const posted = lead.postedAt ? `Posted ${timeAgo(lead.postedAt, now)}` : `Found ${timeAgo(lead.firstSeenAt, now)}`;

  return (
    <li className="py-3 first:pt-1 last:pb-1">
      <article className="flex items-start gap-3">
        <ScoreChip score={lead.score} title={reasonText} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
            <div className="min-w-0">
              <h3 className="text-[0.8125rem] leading-snug font-semibold break-words">
                {lead.jobId ? (
                  <Link href={`/jobs/${lead.jobId}`} className="text-primary hover:underline">
                    {lead.title}
                  </Link>
                ) : (
                  lead.title
                )}
              </h3>
              <p className="text-xs break-words text-muted-foreground">{[lead.company || "Company not given", place].filter(Boolean).join(" · ")}</p>
            </div>
            {showStatus && lead.status !== "new" ? <Badge tone={lead.status === "saved" ? "ok" : "neutral"}>{lead.status === "saved" ? "Saved" : "Dismissed"}</Badge> : null}
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {salary ? <span className="min-w-0 text-xs font-semibold break-words">{salary}</span> : null}
            {lead.eligibility ? <><Badge tone={lead.eligibility.excluded ? "warn" : "neutral"}>{lead.eligibility.pay}</Badge><Badge>{lead.eligibility.work}</Badge></> : null}
            <Badge tone="info" title={`Found by ${sourceLabel}`}>
              via {clip(lead.publisher || sourceLabel, 32)}
            </Badge>
            {lead.inPipeline ? <Badge tone="ok">Already in pipeline</Badge> : null}
            <span className="text-xs text-muted-foreground">{posted}</span>
            {lead.searchName ? <span className="min-w-0 text-xs break-words text-muted-foreground">· {lead.searchName}</span> : null}
          </div>

          <div className="mt-1.5 space-y-1">
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Why {lead.score}?</summary>
              {reasons.length ? (
                <ul className="mt-1 space-y-0.5 pl-1">
                  {reasons.map((reason) => (
                    <li key={`${reason.label}-${reason.points}`} className="flex gap-2">
                      <span className={cx("w-8 shrink-0 text-right font-semibold tabular-nums", reason.points > 0 ? "text-ok" : reason.points < 0 ? "text-bad" : "text-muted-foreground")}>
                        {points(reason.points)}
                      </span>
                      <span className="min-w-0 break-words">{reason.label}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-muted-foreground">No score details for this posting.</p>
              )}
              <p className="mt-1 text-muted-foreground">A quick 0–100 match against your profile, from the listing alone. The job&apos;s full fit score comes after you save it.</p>
            </details>

            {preview.text ? (
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Description preview</summary>
                <p className="mt-1 break-words whitespace-pre-wrap">{preview.text}</p>
                {preview.truncated ? <p className="mt-1 text-muted-foreground">Open the posting for the full description.</p> : null}
              </details>
            ) : null}

            {options.length ? (
              <p className="text-xs break-words text-muted-foreground">
                Also on:{" "}
                {options.slice(0, 6).map((option, index) => (
                  <span key={option.url}>
                    {index ? " · " : null}
                    <a href={option.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                      {option.publisher || "Link"}
                      {option.isDirect ? " (direct)" : ""}
                    </a>
                  </span>
                ))}
              </p>
            ) : null}

            {attribution ? (
              <p className="text-[0.6875rem] text-muted-foreground">
                {credit ? (
                  <a href={credit} target="_blank" rel="noopener noreferrer" className="hover:text-foreground hover:underline">
                    {attribution.text}
                  </a>
                ) : (
                  attribution.text
                )}
              </p>
            ) : null}
          </div>

          <div className="mt-2 flex flex-wrap items-start gap-2">
            {explore && ai ? <ActionForm action={checkFitAction}>
              <input type="hidden" name="leadId" value={lead.id} />
              <SubmitButton size="sm" variant="secondary" pending="Checking your fit…">{review ? "Check my fit again" : "Check my fit"}</SubmitButton>
            </ActionForm> : null}
            {lead.jobId ? (
              <ButtonLink href={`/jobs/${lead.jobId}`} size="sm">
                Open in pipeline
              </ButtonLink>
            ) : (
              <ActionForm action={saveLeadAction} className="min-w-0">
                <input type="hidden" name="leadId" value={lead.id} />
                <SubmitButton size="sm" variant={lead.inPipeline ? "secondary" : "primary"} pending={ai ? "Saving and analyzing…" : "Saving…"}>
                  Save to pipeline
                </SubmitButton>
              </ActionForm>
            )}
            {posting ? (
              <a href={posting} target="_blank" rel="noopener noreferrer" className={buttonClass("secondary", "sm")}>
                Open posting <ExternalLink aria-hidden size={12} />
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            ) : null}
            {lead.status === "new" ? (
              <ActionForm action={setLeadStatusAction} className="min-w-0">
                <input type="hidden" name="leadId" value={lead.id} />
                <input type="hidden" name="status" value="dismissed" />
                <SubmitButton size="sm" variant="ghost" pending="Dismissing…">
                  Dismiss
                </SubmitButton>
              </ActionForm>
            ) : lead.status === "dismissed" ? (
              <ActionForm action={setLeadStatusAction} className="min-w-0">
                <input type="hidden" name="leadId" value={lead.id} />
                <input type="hidden" name="status" value="new" />
                <SubmitButton size="sm" variant="ghost" pending="Restoring…">
                  Restore
                </SubmitButton>
              </ActionForm>
            ) : null}
          </div>
          {review ? <FitReviewDetails review={review.content} stale={review.stale} /> : null}
        </div>
      </article>
    </li>
  );
}
