import Link from "next/link";
import { and, eq, sql } from "drizzle-orm";
import { requireDatabase } from "@/db";
import { CAREER_PATHS, jobRequirements, jobs } from "@/db/schema";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, EmptyState, formatDate } from "@/components/ui";
import { aiConfigured } from "@/lib/ai/run";
import { CAREER_PATH_LABELS } from "@/lib/ai/tasks/draft";
import { getViewer } from "@/lib/auth/owner";
import { listDraftsForJob } from "@/lib/drafts/service";
import { generateDraftAction } from "./actions";

/** The job page's resume panel: this job's drafts and the form that starts a new one. */
export async function DraftsSection({ jobId }: { jobId: string }) {
  const viewer = await getViewer();
  if (!viewer) return null;
  const db = requireDatabase();
  const [job] = await db.select().from(jobs).where(and(eq(jobs.id, jobId), eq(jobs.userId, viewer.userId)));
  if (!job) return null;
  const [drafts, [{ count }]] = await Promise.all([
    listDraftsForJob(db, viewer.userId, jobId),
    db.select({ count: sql<number>`count(*)::int` }).from(jobRequirements).where(eq(jobRequirements.jobId, jobId)),
  ]);
  const claude = aiConfigured();

  return (
    <Card title="Resume drafts" description="Each draft is built only from your library. Every bullet links to the achievement behind it.">
      {drafts.length ? (
        <ul className="mb-5 divide-y divide-border">
          {drafts.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <div className="min-w-0">
                <Link href={`/jobs/${jobId}/resume/${d.id}`} className="font-medium hover:underline">{d.name}</Link>
                <p className="text-xs text-muted-foreground">
                  {formatDate(d.createdAt)} · {d.bulletCount} bullets{d.proposedCount ? ` · ${d.proposedCount} to review` : ""}
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {d.openErrors ? <Badge tone="bad">{d.openErrors} errors</Badge> : null}
                <Badge tone={d.status === "approved" ? "ok" : "info"}>{d.status === "approved" ? "Approved" : "Draft"}</Badge>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mb-5">
          <EmptyState title="No drafts yet">Start one below. You review every bullet before anything is exported.</EmptyState>
        </div>
      )}

      <ActionForm action={generateDraftAction} className="grid gap-3 md:grid-cols-2">
        <input type="hidden" name="jobId" value={jobId} />
        <label className="field">
          <span>Positioning</span>
          <select name="careerPath" className="input" defaultValue={job.careerPath}>
            {CAREER_PATHS.map((path) => (
              <option key={path} value={path}>{CAREER_PATH_LABELS[path]}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Emphasis (optional)</span>
          <input name="emphasis" className="input" placeholder="e.g. onboarding and retention results" />
        </label>
        <div className="flex flex-wrap items-center gap-2 md:col-span-2">
          <SubmitButton name="mode" value="claude" pending="Claude is drafting… (up to a minute)">
            {claude ? "Draft with Claude" : "Draft with Claude (not connected)"}
          </SubmitButton>
          <SubmitButton name="mode" value="library" variant="secondary">Start from my library</SubmitButton>
        </div>
        <p className="text-xs text-muted-foreground md:col-span-2">
          {Number(count) === 0
            ? "Analyze the posting first for a tailored draft; without it Claude writes a general version."
            : job.matchedAt
              ? "Uses the matched evidence above."
              : "Tip: run Match evidence first so the draft leans on your strongest proof."}
          {!claude ? " Claude isn't connected, so only the library draft works right now." : ""}
        </p>
      </ActionForm>
    </Card>
  );
}
