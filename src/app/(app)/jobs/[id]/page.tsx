import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { ApplicationSection } from "@/app/(app)/applications/section";
import { CoverLetterSection } from "@/app/(app)/jobs/[id]/cover-letter/section";
import { DraftsSection } from "@/app/(app)/jobs/[id]/resume/section";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, buttonClass, Card, EvidenceBadge, formatDate, Notice, PageHeader, StatusBadge } from "@/components/ui";
import { getDatabase } from "@/db";
import { CAREER_PATHS, type RequirementKind } from "@/db/schema";
import { aiConfigured } from "@/lib/ai/run";
import { requireViewer } from "@/lib/auth/owner";
import {
  CAREER_PATH_LABELS,
  COMPANY_SIZE_LABELS,
  COMPANY_SIZES,
  formatComp,
  jobCompany,
  jobTitle,
  KIND_LABELS,
  KIND_SINGULAR,
  MATCHED_KINDS,
  POSTING_STATUS_LABELS,
  POSTING_STATUSES,
  REMOTE_LABELS,
  todayIso,
} from "@/lib/jobs/format";
import { getJobDetail, type JobDetail, type JobRequirement } from "@/lib/jobs/jobs";
import { analyzeJobAction, deleteJobAction, matchEvidenceAction, overrideLabelAction, postingStatusAction, updateFitAction } from "../actions";
import { AutoSubmitSelect } from "./auto-submit-select";
import { FitBreakdown, FitScore } from "./fit-breakdown";

export const maxDuration = 300;

const RATINGS = ["1", "2", "3", "4", "5"];

const LABEL_OPTIONS = [
  { value: "auto", label: "Use match result" },
  { value: "strong", label: "Strong (my call)" },
  { value: "transferable", label: "Transferable (my call)" },
  { value: "gap", label: "Gap (my call)" },
];

export default async function JobPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, query, { userId }] = await Promise.all([params, searchParams, requireViewer()]);
  const db = getDatabase();
  if (!db) return <Notice tone="warn">The database isn&apos;t connected yet. Set DATABASE_URL and reload.</Notice>;
  const detail = await getJobDetail(db, userId, id);
  if (!detail) notFound();

  const { job, application, alerts } = detail;
  const error = typeof query.error === "string" ? query.error : "";
  const subtitle = [jobCompany(job), job.location, job.remoteType === "unknown" ? "" : REMOTE_LABELS[job.remoteType]].filter(Boolean).join(" · ");

  return (
    <>
      <PageHeader
        title={jobTitle(job)}
        description={subtitle}
        back={{ href: "/jobs", label: "Jobs" }}
        actions={application ? <StatusBadge status={application.status} /> : null}
      />

      <div className="space-y-4">
        {error && !job.analyzedAt ? (
          <Notice tone="bad">
            Analysis didn&apos;t finish: {error} The job is saved — try <strong>Analyze posting</strong> below.
          </Notice>
        ) : null}
        {alerts.map((alert) => (
          <Notice key={`${alert.kind}-${alert.message}`} tone={alert.kind === "closed" ? "neutral" : "warn"}>
            <strong>{alert.label}.</strong> {alert.message}{" "}
            {alert.relatedJobId ? (
              <Link href={`/jobs/${alert.relatedJobId}`} className="underline">
                View the other job
              </Link>
            ) : null}
          </Notice>
        ))}

        <div className="grid gap-4 lg:grid-cols-2">
          <PostingCard detail={detail} />
          <FitCard detail={detail} />
        </div>

        <AnalysisCard detail={detail} />
        <GapsCard requirements={detail.requirements} analyzed={Boolean(job.analyzedAt)} />
        <RequirementsCard detail={detail} />
        <ScreeningCard requirements={detail.requirements} />

        <details className="rounded-xl border border-border bg-card p-4 md:p-5">
          <summary className="cursor-pointer text-base font-semibold">Full posting</summary>
          <pre className="mt-3 font-sans text-sm leading-relaxed break-words whitespace-pre-wrap">{job.postingText}</pre>
        </details>
      </div>

      <div className="mt-6 space-y-4">
        <ApplicationSection jobId={id} />
        <DraftsSection jobId={id} />
        <CoverLetterSection jobId={id} />
      </div>
    </>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  );
}

const missing = <span className="text-muted-foreground">Not stated</span>;

function PostingCard({ detail }: { detail: JobDetail }) {
  const { job } = detail;
  const comp = formatComp(job);
  const deadlinePassed = Boolean(job.deadline) && job.deadline < todayIso();
  const link = /^https?:\/\//i.test(job.sourceUrl) ? job.sourceUrl : "";
  return (
    <Card title="Posting">
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-4 gap-y-2 text-sm">
        <Fact label="Company">{job.company || missing}</Fact>
        <Fact label="Title">{job.title || missing}</Fact>
        <Fact label="Location">{job.location || missing}</Fact>
        <Fact label="Work setup">{REMOTE_LABELS[job.remoteType]}</Fact>
        <Fact label="Pay">
          {comp || missing}
          {comp && job.compText && job.compText !== comp ? <span className="block text-xs text-muted-foreground">“{job.compText}”</span> : null}
        </Fact>
        <Fact label="Deadline">
          {job.deadline ? (
            <>
              {formatDate(job.deadline)} {deadlinePassed ? <Badge tone="bad">Passed</Badge> : null}
            </>
          ) : (
            missing
          )}
        </Fact>
        {job.requisitionId ? <Fact label="Requisition">{job.requisitionId}</Fact> : null}
        <Fact label="Source">
          {link ? (
            <a href={link} target="_blank" rel="noopener noreferrer" className="break-all text-primary hover:underline">
              {link}
            </a>
          ) : (
            <span className="text-muted-foreground">No link saved</span>
          )}
        </Fact>
        <Fact label="Saved">{formatDate(job.capturedAt)}</Fact>
        <Fact label="Status">
          <ActionForm action={postingStatusAction}>
            <input type="hidden" name="jobId" value={job.id} />
            <AutoSubmitSelect
              name="postingStatus"
              label="Posting status"
              defaultValue={job.postingStatus}
              options={POSTING_STATUSES.map((s) => ({ value: s, label: POSTING_STATUS_LABELS[s] }))}
            />
          </ActionForm>
        </Fact>
      </dl>
      <ActionForm action={deleteJobAction} className="mt-4 border-t border-border pt-4">
        <input type="hidden" name="jobId" value={job.id} />
        <SubmitButton variant="danger" size="sm" pending="Deleting…" confirm="Delete this job with its requirements, drafts and tracking? This can't be undone.">
          Delete job
        </SubmitButton>
      </ActionForm>
    </Card>
  );
}

function FitCard({ detail }: { detail: JobDetail }) {
  const { job, fit } = detail;
  return (
    <Card title="Fit" description="Your own ranking. Change the inputs below to re-rank." actions={<FitScore score={fit.score} size="lg" />}>
      <FitBreakdown fit={fit} />
      <ActionForm action={updateFitAction} className="mt-4 border-t border-border pt-4">
        <input type="hidden" name="jobId" value={job.id} />
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="field">
            <span>Interest (1–5)</span>
            <select name="interest" defaultValue={String(job.interest)} className="input">
              {RATINGS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Growth potential (1–5)</span>
            <select name="growth" defaultValue={String(job.growth)} className="input">
              {RATINGS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Company size</span>
            <select name="companySize" defaultValue={job.companySize} className="input">
              {COMPANY_SIZES.map((size) => (
                <option key={size} value={size}>
                  {COMPANY_SIZE_LABELS[size]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Career path</span>
            <select name="careerPath" defaultValue={job.careerPath} className="input">
              {CAREER_PATHS.map((path) => (
                <option key={path} value={path}>
                  {CAREER_PATH_LABELS[path]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-3">
          <SubmitButton variant="secondary" size="sm" pending="Saving…">
            Save fit inputs
          </SubmitButton>
        </div>
      </ActionForm>
    </Card>
  );
}

function AnalysisCard({ detail }: { detail: JobDetail }) {
  const { job, achievementCount } = detail;
  const ai = aiConfigured();
  const analysis = job.analysis;
  const matchBlocked = !ai
    ? "Claude isn't connected. Add ANTHROPIC_API_KEY to analyze and match."
    : !job.analyzedAt
      ? "Analyze the posting first — matching needs its requirements."
      : achievementCount === 0
        ? "Add achievements to your library first — there's nothing to match against yet."
        : "";
  return (
    <Card
      title="Analysis"
      description={
        job.analyzedAt
          ? `Analyzed ${formatDate(job.analyzedAt)}${job.model ? ` by ${job.model}` : ""}. ${job.matchedAt ? `Evidence matched ${formatDate(job.matchedAt)}.` : "Evidence not matched yet."}`
          : "Not analyzed yet."
      }
    >
      {analysis ? (
        <div className="space-y-2 text-sm">
          {analysis.summary ? <p>{analysis.summary}</p> : null}
          <p className="text-muted-foreground">
            {analysis.seniority ? `Level: ${analysis.seniority} · ` : ""}Path: {CAREER_PATH_LABELS[job.careerPath]}
          </p>
          {analysis.tools.length ? (
            <div className="flex flex-wrap gap-1.5">
              {analysis.tools.map((tool) => (
                <Badge key={tool}>{tool}</Badge>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-start gap-3">
        {ai ? (
          <ActionForm action={analyzeJobAction}>
            <input type="hidden" name="jobId" value={job.id} />
            <SubmitButton variant={job.analyzedAt ? "secondary" : "primary"} pending="Analyzing…">
              {job.analyzedAt ? "Analyze again" : "Analyze posting"}
            </SubmitButton>
          </ActionForm>
        ) : (
          <button type="button" disabled className={buttonClass("secondary")}>
            Analyze posting
          </button>
        )}
        {matchBlocked ? (
          <button type="button" disabled className={buttonClass(job.analyzedAt ? "primary" : "secondary")} aria-describedby="match-blocked">
            Match evidence
          </button>
        ) : (
          <ActionForm action={matchEvidenceAction}>
            <input type="hidden" name="jobId" value={job.id} />
            <SubmitButton variant={job.matchedAt ? "secondary" : "primary"} pending="Matching… (up to a few minutes)">
              {job.matchedAt ? "Match again" : "Match evidence"}
            </SubmitButton>
          </ActionForm>
        )}
      </div>
      {matchBlocked ? (
        <p id="match-blocked" className="mt-2 text-xs text-muted-foreground">
          {matchBlocked}{" "}
          {ai && job.analyzedAt && achievementCount === 0 ? (
            <Link href="/achievements" className="underline">
              Go to achievements
            </Link>
          ) : null}
        </p>
      ) : job.analyzedAt ? (
        <p className="mt-2 text-xs text-muted-foreground">Analyzing again replaces the requirements and clears matches. Labels you set yourself are kept.</p>
      ) : null}
    </Card>
  );
}

const matchable = (r: JobRequirement) => (MATCHED_KINDS as readonly RequirementKind[]).includes(r.kind);

function GapsCard({ requirements, analyzed }: { requirements: JobRequirement[]; analyzed: boolean }) {
  const rows = requirements.filter(matchable);
  if (!analyzed || !rows.length) return null;
  const count = (label: JobRequirement["label"]) => rows.filter((r) => r.label === label).length;
  const unmatched = count(null);
  const gaps = rows.filter((r) => r.label === "gap").sort((a, b) => Number(b.kind === "must") - Number(a.kind === "must"));
  return (
    <Card title="Gaps" description="Where your library doesn't yet back up what the posting asks for.">
      {unmatched === rows.length ? (
        <p className="text-sm text-muted-foreground">Run Match evidence to see which requirements your achievements cover.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5">
            <Badge tone="ok">{count("strong")} strong</Badge>
            <Badge tone="warn">{count("transferable")} transferable</Badge>
            <Badge tone="bad">
              {gaps.length} gap{gaps.length === 1 ? "" : "s"}
            </Badge>
            {unmatched ? <Badge>{unmatched} not matched</Badge> : null}
          </div>
          {gaps.length ? (
            <>
              <ul className="mt-3 space-y-1.5 text-sm">
                {gaps.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-baseline gap-2">
                    <Badge tone={r.kind === "must" ? "bad" : "neutral"}>{KIND_SINGULAR[r.kind]}</Badge>
                    <span className="min-w-[12rem] flex-1">{r.text}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-muted-foreground">Add a missing achievement to your library if you have one, or plan how you&apos;ll address the gap honestly.</p>
            </>
          ) : (
            <p className="mt-3 text-sm text-ok">No gaps — every requirement has evidence.</p>
          )}
        </>
      )}
    </Card>
  );
}

function RequirementsCard({ detail }: { detail: JobDetail }) {
  const { job, requirements } = detail;
  const groups = MATCHED_KINDS.map((kind) => ({ kind, rows: requirements.filter((r) => r.kind === kind) })).filter((g) => g.rows.length);
  return (
    <Card title="Requirements" description={job.analyzedAt ? "Each requirement with the achievements that back it. Set a label yourself if you disagree." : undefined}>
      {!groups.length ? (
        <p className="text-sm text-muted-foreground">
          {job.analyzedAt ? "No requirements were found in this posting." : "Requirements appear here once the posting is analyzed."}
        </p>
      ) : (
        <div className="space-y-5">
          {groups.map(({ kind, rows }) => (
            <section key={kind}>
              <h3 className="text-sm font-semibold">
                {KIND_LABELS[kind]} <span className="font-normal text-muted-foreground">({rows.length})</span>
              </h3>
              <ul className="mt-1 divide-y divide-border">
                {rows.map((r) => (
                  <RequirementRow key={r.id} requirement={r} detail={detail} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Card>
  );
}

function RequirementRow({ requirement: r, detail }: { requirement: JobRequirement; detail: JobDetail }) {
  const cited = r.achievementIds.map((id) => detail.achievements.get(id)).filter((a): a is { id: string; headline: string } => Boolean(a));
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-[12rem] flex-1 text-sm">{r.text}</p>
        <div className="flex flex-wrap items-center gap-2">
          <EvidenceBadge label={r.label} />
          <ActionForm action={overrideLabelAction}>
            <input type="hidden" name="requirementId" value={r.id} />
            <AutoSubmitSelect name="label" label={`Evidence label for: ${r.text}`} defaultValue={r.labelOverridden && r.label ? r.label : "auto"} options={LABEL_OPTIONS} />
          </ActionForm>
        </div>
      </div>
      {cited.length ? (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {cited.map((a) => (
            <li key={a.id}>
              <Link href={`/achievements/${a.id}`} className="inline-block rounded-md bg-muted px-2 py-0.5 text-xs text-foreground hover:bg-accent hover:text-accent-foreground">
                {a.headline}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      {r.rationale ? <p className="mt-1.5 text-sm text-muted-foreground">{r.rationale}</p> : null}
      {r.translation ? (
        <p className="mt-1 text-sm">
          <span className="font-medium">In their language: </span>
          {r.translation}
        </p>
      ) : null}
    </li>
  );
}

function ScreeningCard({ requirements }: { requirements: JobRequirement[] }) {
  const questions = requirements.filter((r) => r.kind === "screening");
  if (!questions.length) return null;
  return (
    <Card title="Screening questions" description="The posting asks these. Prepare answers before you apply.">
      <ol className="list-decimal space-y-1.5 pl-5 text-sm">
        {questions.map((q) => (
          <li key={q.id}>{q.text}</li>
        ))}
      </ol>
    </Card>
  );
}
