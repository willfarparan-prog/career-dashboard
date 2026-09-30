import Form from "next/form";
import Link from "next/link";
import type { ReactNode } from "react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, ButtonLink, Card, EmptyState, Notice, PageHeader, buttonClass, cx } from "@/components/ui";
import { getDatabase } from "@/db";
import { LEAD_SOURCES, type LeadSource } from "@/db/schema";
import { aiConfigured } from "@/lib/ai/run";
import { requireViewer } from "@/lib/auth/owner";
import { getProfile } from "@/lib/career/profile";
import { leadCounts, listLeads, sourceStatuses, type LeadListItem } from "@/lib/discover/leads";
import { listSearches, suggestedSearches, type JobSearch } from "@/lib/discover/searches";
import { getSource, SOURCES } from "@/lib/discover/sources";
import { addSuggestedSearchesAction, deleteSearchAction, dismissLeadsAction, refreshAction, setSearchActiveAction } from "./actions";
import { BookmarkletLink } from "./bookmarklet-link";
import { GOOD_MATCH_SCORE, inboxHref, maxAgeLabel, parseInboxQuery, SOURCE_LABELS, timeAgo, type InboxQuery, type InboxStatus } from "./format";
import { LeadRow } from "./lead-row";
import { bookmarkletHref } from "./origin";
import { SearchForm, type SourceOption } from "./search-form";
import { SourceStrip } from "./source-strip";

// "Refresh now" and "Save to pipeline" (with analysis) run as this page's server actions.
export const maxDuration = 300;

export const metadata = { title: "Discover" };

function sourceLabel(id: LeadSource) {
  return getSource(id)?.label ?? SOURCE_LABELS[id];
}

function sourceOptions(): SourceOption[] {
  const ids = SOURCES.length ? SOURCES.map((s) => s.id) : [...LEAD_SOURCES];
  return ids.map((id) => {
    const source = getSource(id);
    return { id, label: sourceLabel(id), configured: source ? source.configured() : false, remoteOnly: source?.remoteOnly ?? false };
  });
}

function RefreshButton({ searchId, label = "Refresh now", variant = "primary" }: { searchId?: string; label?: string; variant?: "primary" | "secondary" }) {
  return (
    <ActionForm action={refreshAction} className="min-w-0 max-w-md">
      {searchId ? <input type="hidden" name="searchId" value={searchId} /> : null}
      <SubmitButton size={searchId ? "sm" : "md"} variant={variant} pending={searchId ? "Running…" : "Refreshing…"}>
        {label}
      </SubmitButton>
    </ActionForm>
  );
}

export default async function DiscoverPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [params, { userId }] = await Promise.all([searchParams, requireViewer()]);
  const db = getDatabase();
  if (!db) return <Notice tone="warn">The database isn&apos;t connected yet. Set DATABASE_URL and reload.</Notice>;

  const query = parseInboxQuery(params);
  const now = new Date();
  const [searches, leads, counts, statuses, profile, bookmarklet] = await Promise.all([
    listSearches(db, userId),
    listLeads(db, userId, {
      status: query.status,
      source: query.source ?? undefined,
      searchId: query.searchId ?? undefined,
      minScore: query.good ? GOOD_MATCH_SCORE : undefined,
    }),
    leadCounts(db, userId),
    sourceStatuses(db, userId, now),
    getProfile(db, userId),
    bookmarkletHref(),
  ]);
  const ai = aiConfigured();
  const options = sourceOptions();
  const openNewSearch = params.form === "new" || !searches.length;

  return (
    <>
      <PageHeader
        title="Discover"
        description="New postings from your saved searches, best matches first. Save the good ones to your pipeline, then apply on the original site."
        actions={
          <>
            <ButtonLink href="/discover?form=new#new-search" variant="secondary">
              New search
            </ButtonLink>
            <RefreshButton />
          </>
        }
      />

      <div className="space-y-3">
        <SourceStrip statuses={statuses} now={now} />

        <div className="grid gap-3 lg:grid-cols-3">
          <div className="min-w-0 lg:col-span-2">
            <Inbox
              query={query}
              leads={leads}
              counts={counts}
              searches={searches}
              configuredSources={statuses.filter((s) => s.configured).length}
              registeredSources={statuses.length}
              now={now}
              ai={ai}
            />
          </div>

          <div className="min-w-0 space-y-3">
            <Card title="Saved searches" description="Each search asks the sources you pick for recent postings. Refresh now runs every active search.">
              {searches.length ? (
                <ul className="-my-1 divide-y divide-border">
                  {searches.map((search) => (
                    <SearchRow key={search.id} search={search} options={options} now={now} />
                  ))}
                </ul>
              ) : (
                <Suggestions suggestions={suggestedSearches(profile?.targetRoles ?? [], profile?.targetLocations ?? [])} />
              )}

              <details id="new-search" open={openNewSearch} className="group mt-3 border-t border-border pt-3">
                <summary className={cx(buttonClass("secondary", "sm"), "cursor-pointer list-none [&::-webkit-details-marker]:hidden")}>
                  <span className="group-open:hidden">New search</span>
                  <span className="hidden group-open:inline">Hide new search form</span>
                </summary>
                <div className="mt-3">
                  <SearchForm sources={options} />
                </div>
              </details>
            </Card>

            <Card title="Add from any job site" description="A bookmark that sends the job you're looking at to this app, one page at a time.">
              <BookmarkletLink href={bookmarklet} className={buttonClass("primary")} />
              <ol className="mt-3 list-decimal space-y-1 pl-5 text-[0.8125rem]">
                <li>Drag the button above to your bookmarks bar (show the bar with Ctrl+Shift+B, or ⌘+Shift+B on a Mac).</li>
                <li>Open a job on LinkedIn, Indeed, Glassdoor or any careers page.</li>
                <li>Click the bookmark. A new tab opens here with the posting filled in. Check it and press Save and analyze.</li>
              </ol>
              <p className="mt-2 text-xs text-muted-foreground">
                If it picks up the wrong text, select the job description first, then click the bookmark. It reads only the page you have open, only when you click it. This app never visits those sites itself. Works in desktop browsers.
              </p>
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}

/* ---------- Saved searches ---------- */

function SearchRow({ search, options, now }: { search: JobSearch; options: SourceOption[]; now: Date }) {
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[0.8125rem] font-semibold break-words">{search.name}</p>
          <p className="text-xs break-words text-muted-foreground">
            “{search.query}” · {search.location || "Anywhere"}
            {search.remoteOnly ? " · Remote only" : ""}
          </p>
        </div>
        <Badge tone={search.active ? "ok" : "neutral"}>{search.active ? "Active" : "Paused"}</Badge>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {search.sources.map((id) => (
          <Badge key={id}>{sourceLabel(id)}</Badge>
        ))}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {maxAgeLabel(search.maxAgeDays)} · {search.lastRunAt ? `Last run ${timeAgo(search.lastRunAt, now)}` : "Not run yet"}
      </p>
      <div className="mt-2 flex flex-wrap items-start gap-2">
        <RefreshButton searchId={search.id} label="Run now" variant="secondary" />
        <ActionForm action={setSearchActiveAction} className="min-w-0">
          <input type="hidden" name="searchId" value={search.id} />
          <input type="hidden" name="active" value={search.active ? "false" : "true"} />
          <SubmitButton size="sm" variant="ghost" pending="Saving…">
            {search.active ? "Pause" : "Turn on"}
          </SubmitButton>
        </ActionForm>
        <ActionForm action={deleteSearchAction} className="min-w-0">
          <input type="hidden" name="searchId" value={search.id} />
          <SubmitButton size="sm" variant="danger" pending="Deleting…" confirm={`Delete “${search.name}”? Postings it found stay in your inbox.`}>
            Delete
          </SubmitButton>
        </ActionForm>
      </div>
      <details className="mt-2">
        <summary className="cursor-pointer text-xs font-semibold text-primary hover:underline">Edit</summary>
        <div className="mt-2 rounded-md border border-border p-3">
          <SearchForm search={search} sources={options} />
        </div>
      </details>
    </li>
  );
}

function Suggestions({ suggestions }: { suggestions: ReturnType<typeof suggestedSearches> }) {
  return (
    <div className="rounded-md bg-muted/60 px-3 py-3 text-[0.8125rem]">
      <p className="font-semibold">No saved searches yet</p>
      <p className="mt-0.5 text-xs text-muted-foreground">Start with these, based on the target roles and places in your profile. You can edit them after.</p>
      <ul className="mt-2 space-y-0.5 text-xs">
        {suggestions.map((s) => (
          <li key={`${s.query}|${s.location}`} className="break-words">
            <span className="font-semibold">{s.query}</span> · {s.location || "Anywhere"}
          </li>
        ))}
      </ul>
      <ActionForm action={addSuggestedSearchesAction} className="mt-3">
        <SubmitButton size="sm" pending="Adding…">
          Add suggested searches
        </SubmitButton>
      </ActionForm>
    </div>
  );
}

/* ---------- Inbox ---------- */

const TABS: Array<{ status: InboxStatus; label: string }> = [
  { status: "new", label: "New" },
  { status: "saved", label: "Saved" },
  { status: "dismissed", label: "Dismissed" },
  { status: "all", label: "All" },
];

function Inbox({ query, leads, counts, searches, configuredSources, registeredSources, now, ai }: {
  query: InboxQuery;
  leads: LeadListItem[];
  counts: Record<"new" | "saved" | "dismissed", number>;
  searches: JobSearch[];
  configuredSources: number;
  registeredSources: number;
  now: Date;
  ai: boolean;
}) {
  const total = counts.new + counts.saved + counts.dismissed;
  const filtered = Boolean(query.source || query.searchId || query.good);
  const clearHref = inboxHref(query, { source: null, searchId: null, good: false });

  return (
    <Card
      title="Postings"
      description="Open posting is where you apply. Save to pipeline adds the job here and, when Claude is connected, analyzes it."
    >
      <nav aria-label="Posting status" className="-mx-4 mb-3 flex overflow-x-auto border-b border-border px-4">
        {TABS.map((tab) => {
          const active = query.status === tab.status;
          const n = tab.status === "all" ? total : counts[tab.status];
          return (
            <Link
              key={tab.status}
              href={inboxHref(query, { status: tab.status })}
              aria-current={active ? "page" : undefined}
              className={cx(
                "-mb-px shrink-0 border-b-[3px] px-3 py-2 text-[0.8125rem] whitespace-nowrap",
                active ? "border-primary font-semibold text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label} <span className="tabular-nums">({n})</span>
            </Link>
          );
        })}
      </nav>

      <Form action="/discover" className="mb-3 flex flex-wrap items-end gap-2">
        {query.status !== "new" ? <input type="hidden" name="status" value={query.status} /> : null}
        <label className="field min-w-0">
          <span>Source</span>
          <select name="source" defaultValue={query.source ?? ""} className="input w-auto max-w-full">
            <option value="">All sources</option>
            {LEAD_SOURCES.map((id) => (
              <option key={id} value={id}>
                {sourceLabel(id)}
              </option>
            ))}
          </select>
        </label>
        {searches.length ? (
          <label className="field min-w-0">
            <span>Search</span>
            <select name="search" defaultValue={query.searchId ?? ""} className="input w-auto max-w-full">
              <option value="">All searches</option>
              {searches.map((search) => (
                <option key={search.id} value={search.id}>
                  {search.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="flex h-8 items-center gap-2 text-[0.8125rem]">
          <input type="checkbox" name="good" value="1" defaultChecked={query.good} className="size-4 accent-primary" />
          Good matches only ({GOOD_MATCH_SCORE}+)
        </label>
        <button type="submit" className={buttonClass("secondary")}>
          Apply
        </button>
        {filtered ? (
          <Link href={clearHref} className="flex h-8 items-center text-xs font-semibold text-primary hover:underline">
            Clear filters
          </Link>
        ) : null}
      </Form>

      {leads.length ? (
        <>
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
            <p className="text-xs text-muted-foreground">
              Showing {leads.length}
              {leads.length >= 200 ? " (the top 200)" : ""}
            </p>
            {query.status === "new" ? (
              <ActionForm action={dismissLeadsAction} className="min-w-0">
                {leads.map((lead) => (
                  <input key={lead.id} type="hidden" name="leadId" value={lead.id} />
                ))}
                <SubmitButton size="sm" variant="ghost" pending="Dismissing…" confirm={`Dismiss all ${leads.length} postings shown? You can restore them from the Dismissed tab.`}>
                  Dismiss all shown
                </SubmitButton>
              </ActionForm>
            ) : null}
          </div>
          <ul className="divide-y divide-border">
            {leads.map((lead) => {
              const source = getSource(lead.source);
              return (
                <LeadRow
                  key={lead.id}
                  lead={lead}
                  sourceLabel={sourceLabel(lead.source)}
                  attribution={source?.attribution ?? null}
                  now={now}
                  ai={ai}
                  showStatus={query.status === "all"}
                />
              );
            })}
          </ul>
        </>
      ) : (
        <InboxEmpty
          query={query}
          filtered={filtered}
          clearHref={clearHref}
          total={total}
          searches={searches.length}
          configuredSources={configuredSources}
          registeredSources={registeredSources}
        />
      )}
    </Card>
  );
}

function InboxEmpty({ query, filtered, clearHref, total, searches, configuredSources, registeredSources }: {
  query: InboxQuery;
  filtered: boolean;
  clearHref: string;
  total: number;
  searches: number;
  configuredSources: number;
  registeredSources: number;
}) {
  let title: string;
  let body: ReactNode;
  let action: ReactNode = null;
  if (filtered) {
    title = "Nothing matches these filters";
    body = "Try another source or search, or turn off Good matches only.";
    action = <ButtonLink href={clearHref} variant="secondary">Clear filters</ButtonLink>;
  } else if (query.status === "saved") {
    title = "Nothing saved yet";
    body = "Save to pipeline turns a posting into a job you can analyze, tailor a resume for and track.";
  } else if (query.status === "dismissed") {
    title = "Nothing dismissed";
    body = "Postings you dismiss land here, so you can bring them back.";
  } else if (total > 0 && query.status === "new") {
    title = "You're all caught up";
    body = "No new postings. Refresh now checks for more; saved ones are under Saved.";
    action = <RefreshButton />;
  } else if (!searches) {
    title = "No postings yet";
    body = "Add a saved search (or the suggested ones), then press Refresh now. You can also send any job page here with the bookmark.";
    action = <ButtonLink href="/discover?form=new#new-search">New search</ButtonLink>;
  } else if (!registeredSources) {
    title = "Job sources aren't connected yet";
    body = (
      <>
        Your searches are saved and will run once sources are available. Meanwhile, send a job page here with the bookmark, or{" "}
        <Link href="/jobs/new" className="font-semibold text-primary hover:underline">
          paste a posting
        </Link>
        .
      </>
    );
  } else if (!configuredSources) {
    title = "Set up a source first";
    body = "None of the sources above are set up yet. Add the environment variables they list in Vercel, redeploy, then press Refresh now.";
  } else {
    title = "No postings yet";
    body = `Press Refresh now to check your ${searches} saved search${searches === 1 ? "" : "es"}.`;
    action = <RefreshButton />;
  }
  return (
    <EmptyState title={title} action={action}>
      {body}
    </EmptyState>
  );
}
