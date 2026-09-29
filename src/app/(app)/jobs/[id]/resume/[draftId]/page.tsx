import Link from "next/link";
import { notFound } from "next/navigation";
import { requireDatabase } from "@/db";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, FactBadge, Notice, PageHeader, buttonClass, cx, formatDate } from "@/components/ui";
import { aiConfigured } from "@/lib/ai/run";
import { CAREER_PATH_LABELS } from "@/lib/ai/tasks/draft";
import { EMPHASES, LENGTHS, TONES } from "@/lib/ai/tasks/regenerate";
import { requireViewer } from "@/lib/auth/owner";
import { wordDiff } from "@/lib/drafts/diff";
import { jobLine, loadDraftEditor, type Bullet, type DraftFinding } from "@/lib/drafts/service";
import { formatRange } from "@/lib/resume/document";
import {
  addBulletAction,
  approveAction,
  bulletStateAction,
  bulletTextAction,
  deleteDraftAction,
  duplicateAction,
  findingAction,
  moveBulletAction,
  regenerateBulletAction,
  renameAction,
  reopenAction,
  reviewAction,
  revertBulletAction,
  runChecksAction,
  skillsAction,
  summaryAction,
} from "../actions";

export const maxDuration = 300;

type Params = Promise<{ id: string; draftId: string }>;

const SEVERITY_TONE = { error: "bad", warning: "warn", info: "info" } as const;
const STATE_TONE = { proposed: "info", accepted: "ok", locked: "primary", rejected: "neutral" } as const;

export default async function DraftEditorPage({ params }: { params: Params }) {
  const { id: jobId, draftId } = await params;
  const viewer = await requireViewer();
  const editor = await loadDraftEditor(requireDatabase(), viewer.userId, draftId);
  if (!editor || editor.draft.jobId !== jobId) notFound();
  const { draft, job, bullets, findings, library } = editor;
  const claude = aiConfigured();

  const achievements = new Map(library.achievements.map((a) => [a.id, a]));
  const open = findings.filter((f) => !f.resolved);
  const dismissed = findings.filter((f) => f.resolved);
  const byBullet = new Map<string, DraftFinding[]>();
  for (const f of open) if (f.bulletId) byBullet.set(f.bulletId, [...(byBullet.get(f.bulletId) ?? []), f]);
  const draftLevel = open.filter((f) => !f.bulletId);
  const counts = { error: open.filter((f) => f.severity === "error").length, warning: open.filter((f) => f.severity === "warning").length, info: open.filter((f) => f.severity === "info").length };
  const proposed = bullets.filter((b) => b.state === "proposed").length;

  const roles = draft.roleOrder.map((rid) => library.roles.find((r) => r.id === rid)).filter((r): r is NonNullable<typeof r> => Boolean(r));
  const placed = new Set(roles.map((r) => r.id));
  const unplaced = bullets.filter((b) => !b.roleId || !placed.has(b.roleId));
  const used = new Set(bullets.filter((b) => b.state !== "rejected").map((b) => b.achievementId));
  const exportHref = (format: string, inline = false) => `/api/export/resume/${draft.id}?format=${format}${inline ? "&inline=1" : ""}`;

  return (
    <div>
      <PageHeader
        back={{ href: `/jobs/${jobId}`, label: job ? jobLine(job) : "Job" }}
        title={draft.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={draft.status === "approved" ? "ok" : "info"}>{draft.status === "approved" ? "Approved" : "Draft"}</Badge>
            <span>{CAREER_PATH_LABELS[draft.careerPath]} positioning</span>
            <span>· {draft.model === "library" ? "built from your library" : `drafted by ${draft.model}`} · {formatDate(draft.createdAt)}</span>
          </span>
        }
        actions={
          <>
            <a className={buttonClass("secondary", "sm")} href={exportHref("pdf", true)} target="_blank" rel="noreferrer">Preview PDF</a>
            <a className={buttonClass("secondary", "sm")} href={exportHref("docx")}>DOCX</a>
            <a className={buttonClass("secondary", "sm")} href={exportHref("pdf")}>PDF</a>
            <a className={buttonClass("secondary", "sm")} href={exportHref("txt")}>TXT</a>
            <ActionForm action={duplicateAction}>
              <input type="hidden" name="draftId" value={draft.id} />
              <input type="hidden" name="jobId" value={jobId} />
              <SubmitButton variant="secondary" size="sm" pending="Copying…">Duplicate</SubmitButton>
            </ActionForm>
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-5">
          <Card
            title="Approval"
            description={
              draft.status === "approved"
                ? `Approved ${formatDate(draft.approvedAt)}. Any edit sends it back to draft.`
                : "Accept or reject every bullet and clear the errors, then approve."
            }
            actions={
              draft.status === "approved" ? (
                <ActionForm action={reopenAction}>
                  <input type="hidden" name="draftId" value={draft.id} />
                  <SubmitButton variant="secondary" size="sm">Reopen</SubmitButton>
                </ActionForm>
              ) : (
                <ActionForm action={approveAction}>
                  <input type="hidden" name="draftId" value={draft.id} />
                  <SubmitButton size="sm" pending="Checking…">Approve draft</SubmitButton>
                </ActionForm>
              )
            }
          >
            <p className="text-sm text-muted-foreground">
              {proposed} to review · {counts.error} error{counts.error === 1 ? "" : "s"} · {counts.warning} warning{counts.warning === 1 ? "" : "s"}
            </p>
          </Card>

          <Card title="Summary" description={`${draft.summary.split(/\s+/).filter(Boolean).length} words`}>
            <ActionForm action={summaryAction} className="space-y-3">
              <input type="hidden" name="draftId" value={draft.id} />
              <textarea name="summary" className="input" rows={4} defaultValue={draft.summary} aria-label="Summary" />
              <Evidence ids={draft.summaryEvidence} achievements={achievements} />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="locked" defaultChecked={draft.summaryLocked} /> Locked
                </label>
                <SubmitButton size="sm" variant="secondary">Save summary</SubmitButton>
              </div>
            </ActionForm>
            <FindingList findings={draftLevel.filter((f) => ["invented_metric", "inflated_title", "saas_claim", "missing_summary"].includes(f.kind))} />
          </Card>

          <Card title="Skills" description="One per line. Only list what your library supports.">
            <ActionForm action={skillsAction} className="space-y-3">
              <input type="hidden" name="draftId" value={draft.id} />
              <textarea name="skills" className="input font-mono text-xs" rows={Math.min(12, Math.max(4, draft.skills.length + 1))} defaultValue={draft.skills.map((s) => s.name).join("\n")} aria-label="Skills" />
              <div className="flex justify-end">
                <SubmitButton size="sm" variant="secondary">Save skills</SubmitButton>
              </div>
            </ActionForm>
            <FindingList findings={draftLevel.filter((f) => f.kind === "unsupported_skill")} />
          </Card>

          {roles.map((role) => {
            const roleBullets = bullets.filter((b) => b.roleId === role.id);
            const live = roleBullets.filter((b) => b.state !== "rejected");
            const rejected = roleBullets.filter((b) => b.state === "rejected");
            const available = library.achievements.filter((a) => a.roleId === role.id && !used.has(a.id) && a.factStatus !== "private");
            return (
              <Card
                key={role.id}
                title={`${role.title} — ${role.employer}`}
                description={[role.location, formatRange(role.start, role.end, role.isCurrent)].filter(Boolean).join(" · ")}
                actions={role.factStatus !== "verified" ? <FactBadge status={role.factStatus} /> : null}
              >
                {live.length ? (
                  <ol className="space-y-3">
                    {live.map((bullet, index) => (
                      <BulletItem key={bullet.id} bullet={bullet} achievements={achievements} findings={byBullet.get(bullet.id) ?? []} first={index === 0} last={index === live.length - 1} claude={claude} />
                    ))}
                  </ol>
                ) : (
                  <p className="text-sm text-muted-foreground">No bullets for this role in this version.</p>
                )}
                {available.length ? (
                  <ActionForm action={addBulletAction} className="mt-4 flex flex-wrap items-end gap-2 border-t border-border pt-3">
                    <input type="hidden" name="draftId" value={draft.id} />
                    <label className="field min-w-0 flex-1">
                      <span className="text-xs">Add a bullet from an achievement</span>
                      <select name="achievementId" className="input" defaultValue="">
                        <option value="" disabled>Choose…</option>
                        {available.map((a) => (
                          <option key={a.id} value={a.id}>{a.headline}</option>
                        ))}
                      </select>
                    </label>
                    <SubmitButton size="sm" variant="secondary">Add</SubmitButton>
                  </ActionForm>
                ) : null}
                {rejected.length ? <RejectedList bullets={rejected} /> : null}
              </Card>
            );
          })}

          {unplaced.length ? (
            <Card title="Not placed under a role" description="These sentences aren't tied to a role in your library. Link them to a real achievement or reject them.">
              <ol className="space-y-3">
                {unplaced.filter((b) => b.state !== "rejected").map((bullet) => (
                  <BulletItem key={bullet.id} bullet={bullet} achievements={achievements} findings={byBullet.get(bullet.id) ?? []} first last claude={claude} />
                ))}
              </ol>
              <RejectedList bullets={unplaced.filter((b) => b.state === "rejected")} />
            </Card>
          ) : null}

          <Card title="Draft settings">
            <div className="grid gap-4 md:grid-cols-2">
              <ActionForm action={renameAction} className="flex items-end gap-2">
                <input type="hidden" name="draftId" value={draft.id} />
                <label className="field min-w-0 flex-1">
                  <span>Name</span>
                  <input name="name" className="input" defaultValue={draft.name} />
                </label>
                <SubmitButton size="sm" variant="secondary">Rename</SubmitButton>
              </ActionForm>
              <ActionForm action={deleteDraftAction} className="flex items-end justify-end">
                <input type="hidden" name="draftId" value={draft.id} />
                <input type="hidden" name="jobId" value={jobId} />
                <SubmitButton size="sm" variant="danger" confirm="Delete this draft? Anything already submitted stays frozen in its snapshot.">Delete draft</SubmitButton>
              </ActionForm>
            </div>
          </Card>
        </div>

        <aside className="min-w-0 space-y-4 lg:sticky lg:top-6 lg:self-start">
          <Card title="Checks" description={draft.checkedAt ? `Rules last run ${formatDate(draft.checkedAt)}` : undefined}>
            <div className="mb-3 flex flex-wrap gap-2">
              <Badge tone="bad">{counts.error} errors</Badge>
              <Badge tone="warn">{counts.warning} warnings</Badge>
              <Badge tone="info">{counts.info} notes</Badge>
            </div>
            <div className="flex flex-wrap gap-2">
              <ActionForm action={runChecksAction}>
                <input type="hidden" name="draftId" value={draft.id} />
                <SubmitButton size="sm" variant="secondary">Re-run rules</SubmitButton>
              </ActionForm>
              {claude ? (
                <ActionForm action={reviewAction}>
                  <input type="hidden" name="draftId" value={draft.id} />
                  <SubmitButton size="sm" variant="secondary" pending="Claude is reading…">Ask Claude to review</SubmitButton>
                </ActionForm>
              ) : null}
            </div>
            <ul className="mt-4 space-y-3">
              {open.length ? (
                open
                  .slice()
                  .sort((a, b) => ["error", "warning", "info"].indexOf(a.severity) - ["error", "warning", "info"].indexOf(b.severity))
                  .map((f) => (
                    <li key={f.id} className="text-sm">
                      <div className="flex items-start gap-2">
                        <Badge tone={SEVERITY_TONE[f.severity]}>{f.severity}</Badge>
                        <div className="min-w-0">
                          <p>{f.message}</p>
                          {f.suggestion ? <p className="text-xs text-muted-foreground">{f.suggestion}</p> : null}
                          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs">
                            {f.bulletId ? <a href={`#b-${f.bulletId}`} className="text-primary underline">Show bullet</a> : null}
                            <span className="text-muted-foreground">{f.source === "claude" ? "Claude" : "Rule"}</span>
                            <ActionForm action={findingAction}>
                              <input type="hidden" name="findingId" value={f.id} />
                              <input type="hidden" name="resolved" value="true" />
                              <button type="submit" className="text-muted-foreground underline hover:text-foreground">Dismiss</button>
                            </ActionForm>
                          </div>
                        </div>
                      </div>
                    </li>
                  ))
              ) : (
                <li className="text-sm text-ok">Nothing open. Still read it once as the hiring manager would.</li>
              )}
            </ul>
            {dismissed.length ? (
              <details className="mt-4 text-sm">
                <summary className="cursor-pointer text-muted-foreground">Dismissed ({dismissed.length})</summary>
                <ul className="mt-2 space-y-2">
                  {dismissed.map((f) => (
                    <li key={f.id} className="flex items-start justify-between gap-2">
                      <span className="text-muted-foreground line-through">{f.message}</span>
                      <ActionForm action={findingAction}>
                        <input type="hidden" name="findingId" value={f.id} />
                        <input type="hidden" name="resolved" value="false" />
                        <button type="submit" className="text-xs underline">Restore</button>
                      </ActionForm>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </Card>
          <Notice>
            Every bullet should answer: <strong>which real experience supports this sentence?</strong> The chip under each bullet shows it.
          </Notice>
        </aside>
      </div>
    </div>
  );
}

type AchievementMap = Map<string, { id: string; headline: string; factStatus: "verified" | "approximate" | "private" | "needs_confirmation" }>;

function Evidence({ ids, achievements }: { ids: string[]; achievements: AchievementMap }) {
  const items = ids.map((id) => achievements.get(id)).filter((a): a is NonNullable<typeof a> => Boolean(a));
  if (!items.length) return <p className="text-xs text-muted-foreground">No linked evidence.</p>;
  return (
    <div className="flex flex-wrap gap-1.5 text-xs">
      <span className="text-muted-foreground">Supported by:</span>
      {items.map((a) => (
        <Link key={a.id} href={`/achievements/${a.id}`} className="rounded-full bg-muted px-2 py-0.5 hover:underline">{a.headline}</Link>
      ))}
    </div>
  );
}

function FindingList({ findings }: { findings: DraftFinding[] }) {
  if (!findings.length) return null;
  return (
    <ul className="mt-3 space-y-1">
      {findings.map((f) => (
        <li key={f.id} className={cx("text-xs", f.severity === "error" ? "text-bad" : f.severity === "warning" ? "text-warn" : "text-muted-foreground")}>
          {f.message} {f.suggestion ? <span className="text-muted-foreground">— {f.suggestion}</span> : null}
        </li>
      ))}
    </ul>
  );
}

function BulletItem({ bullet, achievements, findings, first, last, claude }: { bullet: Bullet; achievements: AchievementMap; findings: DraftFinding[]; first: boolean; last: boolean; claude: boolean }) {
  const achievement = bullet.achievementId ? achievements.get(bullet.achievementId) : undefined;
  const changed = bullet.text !== bullet.originalText;
  const locked = bullet.state === "locked";
  return (
    <li id={`b-${bullet.id}`} className={cx("scroll-mt-6 rounded-lg border p-3", findings.some((f) => f.severity === "error") ? "border-bad/50" : "border-border")}>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge tone={STATE_TONE[bullet.state]}>{bullet.state}</Badge>
        {achievement ? (
          <Link href={`/achievements/${achievement.id}`} className="rounded-full bg-muted px-2 py-0.5 hover:underline" title="The achievement this sentence is written from">
            Supported by: {achievement.headline}
          </Link>
        ) : (
          <Badge tone="bad">Unsupported — no achievement</Badge>
        )}
        {achievement && achievement.factStatus !== "verified" ? <FactBadge status={achievement.factStatus} /> : null}
      </div>
      <p className="mt-2 text-sm leading-relaxed">{bullet.text}</p>
      {changed ? (
        <p className="mt-1 text-xs text-muted-foreground">
          <span className="mr-1">vs original:</span>
          {wordDiff(bullet.originalText, bullet.text).map((part, i) =>
            part.type === "same" ? <span key={i}>{part.text}</span> : part.type === "added" ? <ins key={i} className="bg-ok-soft text-ok no-underline">{part.text}</ins> : <del key={i} className="bg-bad-soft text-bad">{part.text}</del>,
          )}
        </p>
      ) : null}
      {findings.length ? <FindingList findings={findings} /> : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <ActionForm action={bulletStateAction} className="flex flex-wrap gap-1.5">
          <input type="hidden" name="bulletId" value={bullet.id} />
          {bullet.state !== "accepted" && !locked ? <SubmitButton size="sm" name="state" value="accepted">Accept</SubmitButton> : null}
          {!locked ? <SubmitButton size="sm" variant="secondary" name="state" value="rejected">Reject</SubmitButton> : null}
          <SubmitButton size="sm" variant="ghost" name="state" value={locked ? "accepted" : "locked"}>{locked ? "Unlock" : "Lock"}</SubmitButton>
        </ActionForm>
        <ActionForm action={moveBulletAction} className="flex gap-1">
          <input type="hidden" name="bulletId" value={bullet.id} />
          <SubmitButton size="sm" variant="ghost" name="direction" value="up">{first ? <span className="opacity-40">↑</span> : "↑"}</SubmitButton>
          <SubmitButton size="sm" variant="ghost" name="direction" value="down">{last ? <span className="opacity-40">↓</span> : "↓"}</SubmitButton>
        </ActionForm>
        {changed && !locked ? (
          <ActionForm action={revertBulletAction}>
            <input type="hidden" name="bulletId" value={bullet.id} />
            <SubmitButton size="sm" variant="ghost">Revert</SubmitButton>
          </ActionForm>
        ) : null}
      </div>

      {!locked ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">Edit or regenerate</summary>
          <div className="mt-2 grid gap-3">
            <ActionForm action={bulletTextAction} className="space-y-2">
              <input type="hidden" name="bulletId" value={bullet.id} />
              <textarea name="text" className="input" rows={3} defaultValue={bullet.text} aria-label="Bullet text" />
              <SubmitButton size="sm" variant="secondary">Save wording</SubmitButton>
            </ActionForm>
            {claude && bullet.achievementId ? (
              <ActionForm action={regenerateBulletAction} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="bulletId" value={bullet.id} />
                <Select name="tone" label="Tone" options={TONES} />
                <Select name="length" label="Length" options={LENGTHS} defaultValue="same" />
                <Select name="emphasis" label="Emphasis" options={EMPHASES} />
                <SubmitButton size="sm" variant="secondary" pending="Rewriting…">Regenerate</SubmitButton>
              </ActionForm>
            ) : null}
          </div>
        </details>
      ) : null}
    </li>
  );
}

function Select({ name, label, options, defaultValue }: { name: string; label: string; options: readonly string[]; defaultValue?: string }) {
  return (
    <label className="field">
      <span className="text-xs">{label}</span>
      <select name={name} className="input py-1.5 text-xs" defaultValue={defaultValue ?? options[0]}>
        {options.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    </label>
  );
}

function RejectedList({ bullets }: { bullets: Bullet[] }) {
  if (!bullets.length) return null;
  return (
    <details className="mt-3 text-sm">
      <summary className="cursor-pointer text-muted-foreground">Rejected ({bullets.length})</summary>
      <ul className="mt-2 space-y-2">
        {bullets.map((b) => (
          <li key={b.id} className="flex items-start justify-between gap-2">
            <span className="text-muted-foreground line-through">{b.text}</span>
            <ActionForm action={bulletStateAction}>
              <input type="hidden" name="bulletId" value={b.id} />
              <input type="hidden" name="state" value="proposed" />
              <button type="submit" className="text-xs whitespace-nowrap underline">Restore</button>
            </ActionForm>
          </li>
        ))}
      </ul>
    </details>
  );
}
