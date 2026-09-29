import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, ButtonLink, Card, Notice, PageHeader, formatDate } from "@/components/ui";
import { getDatabase } from "@/db";
import type { ExtractedAchievement } from "@/lib/ai/tasks/extract";
import { requireViewer } from "@/lib/auth/owner";
import { formatMetricValue } from "@/lib/career/achievements";
import { acceptKey, buildImportReview, getImport, importSourceLabel, PERSON_FIELDS, type ImportReview, type PersonField } from "@/lib/career/imports";
import { CREDENTIAL_KIND_LABELS, SKILL_CATEGORY_LABELS, formatRange } from "@/lib/career/labels";
import { StickyForm, StickySubmit } from "../../sticky-form";
import { acceptImportAction, discardImportAction } from "../actions";

export const metadata: Metadata = { title: "Review import" };
export const maxDuration = 60;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const PERSON_LABELS: Record<PersonField, string> = {
  fullName: "Full name",
  headline: "Headline",
  email: "Email",
  phone: "Phone",
  location: "Location",
  links: "Links",
};

function Choice({ value, children, disabled, note }: { value: string; children: ReactNode; disabled?: boolean; note?: ReactNode }) {
  return (
    <li>
      <label className={`flex gap-3 rounded-lg border border-border p-3 ${disabled ? "opacity-70" : "cursor-pointer has-[:checked]:bg-muted/40"}`}>
        <input type="checkbox" name="accept" value={value} defaultChecked={!disabled} disabled={disabled} className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]" />
        <div className="min-w-0 flex-1 text-sm">
          {children}
          {note ? <div className="mt-1 text-xs text-muted-foreground">{note}</div> : null}
        </div>
      </label>
    </li>
  );
}

function Section({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <fieldset className="grid gap-2">
      <legend className="text-base font-semibold">{title}</legend>
      {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      <ul className="grid gap-2">{children}</ul>
    </fieldset>
  );
}

function AchievementChoice({ index, achievement: a, roleLabel, flags, check }: { index: number; achievement: ExtractedAchievement; roleLabel: string; flags: string[]; check: ImportReview["numberCheck"] }) {
  return (
    <Choice value={acceptKey.achievement(index)}>
      <p className="font-medium break-words">{a.headline || a.action}</p>
      <p className="text-xs text-muted-foreground">{roleLabel}</p>
      {a.outcome ? <p className="mt-1 break-words">{a.outcome}</p> : a.action && a.action !== a.headline ? <p className="mt-1 break-words text-muted-foreground">{a.action}</p> : null}
      {a.metrics.length || a.scale ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {a.scale ? <span className="rounded-md bg-muted px-2 py-0.5 text-xs">Scale: {a.scale}</span> : null}
          {a.metrics.map((m, i) => (
            <span key={i} className="rounded-md bg-muted px-2 py-0.5 text-xs">
              <span className="font-semibold tabular-nums">{formatMetricValue(m)}</span> {m.label}
            </span>
          ))}
        </div>
      ) : null}
      {flags.length ? (
        <p className="mt-2">
          <Badge tone="bad">Number not in your resume: {flags.join(", ")}</Badge>
        </p>
      ) : null}
      {check === "pdf" && a.metrics.length ? <p className="mt-1 text-xs text-warn">Check these numbers against your PDF.</p> : null}
      {a.tags.length ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {a.tags.map((tag) => (
            <Badge key={tag} tone="primary">
              {tag}
            </Badge>
          ))}
        </div>
      ) : null}
      {a.sourceQuote ? <blockquote className="mt-2 border-l-2 border-border pl-3 text-xs break-words text-muted-foreground">“{a.sourceQuote}”</blockquote> : null}
      {a.missingMetrics.length ? (
        <p className="mt-2 text-xs text-warn">
          <span className="font-medium">Add a number for:</span> {a.missingMetrics.join(", ")}
        </p>
      ) : null}
    </Choice>
  );
}

function AddedSummary({ params }: { params: Record<string, string | string[] | undefined> }) {
  const n = (key: string) => Number(Array.isArray(params[key]) ? params[key]?.[0] : params[key]) || 0;
  if (!("achievements" in params)) return null;
  const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
  const parts = [
    n("roles") ? plural(n("roles"), "new role", "new roles") : null,
    n("reused") ? `${plural(n("reused"), "role", "roles")} matched to ones you had` : null,
    plural(n("achievements"), "achievement", "achievements"),
    n("skipped") ? `${plural(n("skipped"), "duplicate", "duplicates")} skipped` : null,
    n("skills") ? plural(n("skills"), "skill", "skills") : null,
    n("credentials") ? plural(n("credentials"), "credential", "credentials") : null,
    n("profile") ? plural(n("profile"), "profile field", "profile fields") : null,
  ].filter(Boolean);
  return <Notice tone="ok">Added: {parts.join(", ")}.</Notice>;
}

export default async function ReviewImportPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { userId } = await requireViewer();
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const db = getDatabase();
  if (!db) notFound();
  const row = await getImport(db, userId, id);
  if (!row) notFound();
  const review = await buildImportReview(db, userId, row);
  const { extraction, profile, numberCheck, numberFlags, roleMatches, existingSkills } = review;

  const header = (
    <PageHeader
      title={row.status === "pending" ? "Review import" : "Import"}
      description={`${importSourceLabel(row)} · ${formatDate(row.createdAt)}`}
      back={{ href: "/profile/import", label: "Imports" }}
    />
  );

  if (row.status !== "pending") {
    return (
      <>
        {header}
        <div className="grid gap-4">
          {row.status === "reviewed" ? (
            <>
              <AddedSummary params={query} />
              <Notice tone="info">Everything you accepted is marked Needs confirmation. Check each item and mark it verified.</Notice>
              <div className="flex flex-wrap gap-2">
                <ButtonLink href="/achievements?status=needs_confirmation">Review achievements</ButtonLink>
                <ButtonLink href="/profile" variant="secondary">
                  Review roles and skills
                </ButtonLink>
              </div>
              {extraction?.questions.length ? (
                <Card title="Claude's questions" description="Worth answering in your library.">
                  <ul className="grid list-disc gap-1 pl-5 text-sm">
                    {extraction.questions.map((q, i) => (
                      <li key={i}>{q}</li>
                    ))}
                  </ul>
                </Card>
              ) : null}
            </>
          ) : row.status === "discarded" ? (
            <Notice tone="neutral">Discarded. Nothing from this import was added.</Notice>
          ) : (
            <Notice tone="bad">This import failed{row.error ? `: ${row.error}` : "."}</Notice>
          )}
          <p>
            <Link href="/profile/import" className="text-sm font-medium text-primary hover:underline">
              Import another resume
            </Link>
          </p>
        </div>
      </>
    );
  }

  const discard = (
    <ActionForm action={discardImportAction}>
      <input type="hidden" name="id" value={row.id} />
      <SubmitButton variant="danger" confirm="Discard this import? Nothing will be added." pending="Discarding…">
        Discard
      </SubmitButton>
    </ActionForm>
  );

  if (!extraction) {
    return (
      <>
        {header}
        <div className="grid gap-4">
          <Notice tone="bad">This import can&apos;t be read. Discard it and try again.</Notice>
          <div>{discard}</div>
        </div>
      </>
    );
  }

  const roleLabel = new Map(extraction.roles.map((r) => [r.key, `${r.title} — ${r.employer}`]));
  const flaggedCount = numberFlags.filter((flags) => flags.length).length;
  const personFields = PERSON_FIELDS.filter((field) => (field === "links" ? extraction.person.links.length > 0 : extraction.person[field].trim()));
  const nothingFound = !personFields.length && !extraction.roles.length && !extraction.achievements.length && !extraction.skills.length && !extraction.credentials.length;

  return (
    <>
      {header}
      <div className="grid gap-5">
        <Notice tone="info">
          Uncheck anything that&apos;s wrong. What you accept is added as <strong>Needs confirmation</strong>, so you can verify each item later. Roles and skills you already have are reused, and only empty profile fields are filled.
        </Notice>

        {numberCheck === "pdf" ? (
          <Notice tone="warn">Number check skipped: a PDF is read directly, so there&apos;s no text to compare against. Check every number yourself.</Notice>
        ) : numberCheck === "cleared" ? (
          <Notice tone="warn">Number check skipped: the resume text is no longer stored.</Notice>
        ) : flaggedCount ? (
          <Notice tone="bad">
            {flaggedCount === 1 ? "1 achievement has" : `${flaggedCount} achievements have`} a number that isn&apos;t in your resume. Uncheck it, or fix the number after adding.
          </Notice>
        ) : extraction.achievements.length ? (
          <Notice tone="ok">Every number matches your resume text.</Notice>
        ) : null}

        {extraction.questions.length ? (
          <Card title="Claude's questions" description="Answer these by editing your library after you add things.">
            <ul className="grid list-disc gap-1 pl-5 text-sm">
              {extraction.questions.map((q, i) => (
                <li key={i}>{q}</li>
              ))}
            </ul>
          </Card>
        ) : null}

        {nothingFound ? (
          <Notice tone="warn">Claude didn&apos;t find anything to add. Discard this and try pasting the text instead.</Notice>
        ) : (
          <Card>
            <StickyForm action={acceptImportAction} className="grid gap-6">
              <input type="hidden" name="id" value={row.id} />

              {personFields.length ? (
                <Section title="About you">
                  {personFields.map((field) => {
                    const value = field === "links" ? extraction.person.links.join(", ") : extraction.person[field];
                    const current = field === "links" ? (profile?.links.join(", ") ?? "") : (profile?.[field] ?? "");
                    return (
                      <Choice key={field} value={acceptKey.person(field)} disabled={Boolean(current.trim())} note={current.trim() ? `Keeping your current ${PERSON_LABELS[field].toLowerCase()}: ${current}` : undefined}>
                        <span className="text-muted-foreground">{PERSON_LABELS[field]}: </span>
                        <span className="break-words">{value}</span>
                      </Choice>
                    );
                  })}
                </Section>
              ) : null}

              {extraction.roles.length ? (
                <Section title={`Roles (${extraction.roles.length})`} description="Titles exactly as written on your resume.">
                  {extraction.roles.map((role) => (
                    <Choice key={role.key} value={acceptKey.role(role.key)} note={roleMatches[role.key] ? "You already have this role. It will be reused, not duplicated." : undefined}>
                      <p className="font-medium break-words">
                        {role.title} <span className="font-normal text-muted-foreground">— {role.employer}</span>
                      </p>
                      <p className="text-xs break-words text-muted-foreground">
                        {[formatRange(role.start, role.end, role.isCurrent) || "Dates not found", role.location, role.employmentType].filter(Boolean).join(" · ")}
                      </p>
                      {role.summary ? <p className="mt-1 break-words">{role.summary}</p> : null}
                    </Choice>
                  ))}
                </Section>
              ) : null}

              {extraction.achievements.length ? (
                <Section title={`Achievements (${extraction.achievements.length})`} description="If you leave an achievement's role unchecked, it's added without a role.">
                  {extraction.achievements.map((a, index) => (
                    <AchievementChoice
                      key={index}
                      index={index}
                      achievement={a}
                      roleLabel={a.roleKey ? (roleLabel.get(a.roleKey) ?? "No role") : "Not tied to a role"}
                      flags={numberFlags[index] ?? []}
                      check={numberCheck}
                    />
                  ))}
                </Section>
              ) : null}

              {extraction.skills.length ? (
                <fieldset className="grid gap-2">
                  <legend className="text-base font-semibold">Skills and tools ({extraction.skills.length})</legend>
                  <ul className="flex flex-wrap gap-2">
                    {extraction.skills.map((skill, index) => {
                      const have = existingSkills.has(skill.name.trim().toLowerCase());
                      return (
                        <li key={index}>
                          <label className={`inline-flex max-w-full items-center gap-2 rounded-full border border-border px-3 py-1 text-sm ${have ? "opacity-70" : "cursor-pointer"}`}>
                            <input type="checkbox" name="accept" value={acceptKey.skill(index)} defaultChecked={!have} disabled={have} className="size-4 shrink-0 accent-[var(--primary)]" />
                            <span className="min-w-0 break-words">{skill.name}</span>
                            <span className="text-xs text-muted-foreground">{have ? "already added" : SKILL_CATEGORY_LABELS[skill.category].toLowerCase()}</span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </fieldset>
              ) : null}

              {extraction.credentials.length ? (
                <Section title={`Education, certifications and awards (${extraction.credentials.length})`}>
                  {extraction.credentials.map((c, index) => (
                    <Choice key={index} value={acceptKey.credential(index)}>
                      <p className="font-medium break-words">{c.name}</p>
                      <p className="text-xs break-words text-muted-foreground">{[CREDENTIAL_KIND_LABELS[c.kind], c.issuer, c.date, c.detail].filter(Boolean).join(" · ")}</p>
                    </Choice>
                  ))}
                </Section>
              ) : null}

              <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
                <StickySubmit pending="Adding…">Add selected to library</StickySubmit>
                <span className="text-xs text-muted-foreground">Everything is added as Needs confirmation.</span>
              </div>
            </StickyForm>
          </Card>
        )}

        <div className="flex flex-wrap items-center gap-3">
          {discard}
          <span className="text-xs text-muted-foreground">Throws this proposal away and deletes the stored resume text.</span>
        </div>
      </div>
    </>
  );
}
