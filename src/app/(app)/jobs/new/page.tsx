import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, Notice, PageHeader } from "@/components/ui";
import { aiConfigured } from "@/lib/ai/run";
import { COMPANY_SIZE_LABELS, COMPANY_SIZES } from "@/lib/jobs/format";
import { createJobAction } from "../actions";

export const metadata = { title: "Add a job" };
export const maxDuration = 300;

const RATINGS = [
  { value: "1", label: "1 — Low" },
  { value: "2", label: "2" },
  { value: "3", label: "3 — Neutral" },
  { value: "4", label: "4" },
  { value: "5", label: "5 — High" },
];

export default function NewJobPage() {
  const ai = aiConfigured();
  return (
    <>
      <PageHeader
        title="Add a job"
        description="Paste the posting. Claude pulls out the requirements and fills in any details you leave blank — it never overwrites what you type."
        back={{ href: "/jobs", label: "Jobs" }}
      />
      <ActionForm action={createJobAction} className="space-y-4">
        {ai ? null : <Notice tone="warn">Claude isn&apos;t connected, so the job will be saved without analysis. You can analyze it later.</Notice>}

        <Card title="Job description">
          <label className="field">
            <span>Posting text</span>
            <textarea name="postingText" required rows={14} className="input" placeholder="Paste the full job description…" />
            <small>Paste the text itself. Nothing is fetched from the web.</small>
          </label>
        </Card>

        <Card title="Details" description="Optional. Anything you fill in here is kept as-is.">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="field">
              <span>Company</span>
              <input name="company" className="input" autoComplete="off" />
            </label>
            <label className="field">
              <span>Job title</span>
              <input name="title" className="input" autoComplete="off" />
            </label>
            <label className="field">
              <span>Location</span>
              <input name="location" className="input" placeholder="e.g. Denver, CO or Remote (US)" autoComplete="off" />
            </label>
            <label className="field">
              <span>Compensation</span>
              <input name="compText" className="input" placeholder="e.g. $85,000–$100,000" autoComplete="off" />
            </label>
            <label className="field">
              <span>Deadline</span>
              <input name="deadline" type="date" className="input" />
            </label>
            <label className="field">
              <span>Requisition ID</span>
              <input name="requisitionId" className="input" autoComplete="off" />
            </label>
            <label className="field sm:col-span-2">
              <span>Source link</span>
              <input name="sourceUrl" type="url" inputMode="url" className="input" placeholder="https://" autoComplete="off" />
              <small>Stored for reference only.</small>
            </label>
          </div>
        </Card>

        <Card title="Your read" description="Optional. These feed the fit score, and you can change them later.">
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="field">
              <span>Interest</span>
              <select name="interest" defaultValue="3" className="input">
                {RATINGS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Growth potential</span>
              <select name="growth" defaultValue="3" className="input">
                {RATINGS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Company size</span>
              <select name="companySize" defaultValue="unknown" className="input">
                {COMPANY_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {COMPANY_SIZE_LABELS[size]}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </Card>

        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton pending={ai ? "Saving and analyzing…" : "Saving…"}>{ai ? "Save and analyze" : "Save job"}</SubmitButton>
          {ai ? <span className="text-xs text-muted-foreground">Analysis usually takes under a minute.</span> : null}
        </div>
      </ActionForm>
    </>
  );
}
