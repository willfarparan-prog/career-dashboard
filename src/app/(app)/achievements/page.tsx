import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { ButtonLink, EmptyState, FACT_OPTIONS, Notice, PageHeader, buttonClass } from "@/components/ui";
import { getDatabase } from "@/db";
import { requireViewer } from "@/lib/auth/owner";
import { allTags, groupByRole, listAchievements, needsMetrics, type AchievementFilters } from "@/lib/career/achievements";
import { formatRange, isFactStatus } from "@/lib/career/labels";
import { listRoles } from "@/lib/career/roles";
import { AchievementCard } from "./achievement-card";

export const metadata: Metadata = { title: "Achievements" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)?.trim() || "";

export default async function AchievementsPage({ searchParams }: { searchParams: SearchParams }) {
  const { userId } = await requireViewer();
  const params = await searchParams;
  const status = one(params.status);
  const filters: AchievementFilters = {
    role: one(params.role) || undefined,
    tag: one(params.tag) || undefined,
    status: isFactStatus(status) ? status : undefined,
    missingMetrics: one(params.missing) === "1",
  };
  const filtered = Boolean(filters.role || filters.tag || filters.status || filters.missingMetrics);

  const header = (
    <PageHeader
      title="Achievements"
      description="Your bank of real accomplishments. Every resume bullet is written from one of these."
      actions={
        <>
          <ButtonLink href="/profile/import" variant="secondary">
            Import a resume
          </ButtonLink>
          <ButtonLink href={filters.role && filters.role !== "none" ? `/achievements/new?role=${filters.role}` : "/achievements/new"}>Add achievement</ButtonLink>
        </>
      }
    />
  );
  const db = getDatabase();
  if (!db) {
    return (
      <>
        {header}
        <Notice tone="warn">No database is connected yet. Set DATABASE_URL to start your library.</Notice>
      </>
    );
  }

  const [roles, everything] = await Promise.all([listRoles(db, userId), listAchievements(db, userId)]);
  const list = filtered ? await listAchievements(db, userId, filters) : everything;
  const groups = groupByRole(list, roles);
  const tags = allTags(everything);
  const missingCount = everything.filter(needsMetrics).length;
  const unconfirmed = everything.filter((a) => a.factStatus === "needs_confirmation").length;

  if (!everything.length) {
    return (
      <>
        {header}
        <EmptyState
          title="Your achievement bank is empty"
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <ButtonLink href="/achievements/new">Add an achievement</ButtonLink>
              <ButtonLink href="/profile/import" variant="secondary">
                Import a resume
              </ButtonLink>
            </div>
          }
        >
          Add the things you&apos;ve done: programs you ran, people you coached, results you can point to. Numbers help, but only ones you can back up.
        </EmptyState>
      </>
    );
  }

  return (
    <>
      {header}
      <div className="grid gap-5">
        <p className="text-sm text-muted-foreground">
          {everything.length} total ·{" "}
          <Link href="/achievements?missing=1" className="hover:text-foreground hover:underline">
            {missingCount} missing numbers
          </Link>{" "}
          ·{" "}
          <Link href="/achievements?status=needs_confirmation" className="hover:text-foreground hover:underline">
            {unconfirmed} need confirmation
          </Link>
        </p>

        <Form action="/achievements" className="grid gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-[repeat(3,minmax(0,1fr))_auto] lg:items-end">
          <label className="field">
            <span>Role</span>
            <select className="input" name="role" defaultValue={filters.role ?? ""}>
              <option value="">All roles</option>
              {roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.title} — {role.employer}
                </option>
              ))}
              <option value="none">No role</option>
            </select>
          </label>
          <label className="field">
            <span>Tag</span>
            <select className="input" name="tag" defaultValue={filters.tag?.toLowerCase() ?? ""}>
              <option value="">All tags</option>
              {tags.map((tag) => (
                <option key={tag} value={tag}>
                  {tag}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Fact status</span>
            <select className="input" name="status" defaultValue={filters.status ?? ""}>
              <option value="">Any status</option>
              {FACT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-1">
            <label className="flex items-center gap-2 text-sm whitespace-nowrap">
              <input type="checkbox" name="missing" value="1" defaultChecked={filters.missingMetrics} className="size-4 accent-[var(--primary)]" />
              Missing numbers
            </label>
            <button type="submit" className={buttonClass("secondary")}>
              Filter
            </button>
            {filtered ? (
              <Link href="/achievements" className="text-sm text-muted-foreground hover:text-foreground">
                Clear
              </Link>
            ) : null}
          </div>
        </Form>

        {groups.length ? (
          groups.map((group) => (
            <section key={group.role?.id ?? "none"} className="grid gap-3">
              <div className="min-w-0">
                <h2 className="text-base font-semibold break-words">{group.role ? `${group.role.title} — ${group.role.employer}` : "Not tied to a role"}</h2>
                <p className="text-xs text-muted-foreground">
                  {group.role ? formatRange(group.role.start, group.role.end, group.role.isCurrent) || "Dates not set" : "Projects, volunteering and other work"}
                </p>
              </div>
              <div className="grid gap-3 lg:grid-cols-2">
                {group.items.map((a) => (
                  <AchievementCard key={a.id} achievement={a} />
                ))}
              </div>
            </section>
          ))
        ) : (
          <EmptyState title="Nothing matches these filters" action={<ButtonLink href="/achievements" variant="secondary">Clear filters</ButtonLink>} />
        )}
      </div>
    </>
  );
}
