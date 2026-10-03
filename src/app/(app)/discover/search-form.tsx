import { ActionForm, SubmitButton } from "@/components/forms";
import type { DiscoverMode, LeadSource } from "@/db/schema";
import type { JobSearch } from "@/lib/discover/searches";
import { createSearchAction, updateSearchAction } from "./actions";
import { MAX_AGE_OPTIONS } from "./format";

export type SourceOption = { id: LeadSource; label: string; configured: boolean; remoteOnly: boolean };

/** Create or edit a saved search. Validation lives in src/lib/discover/searches.ts. */
export function SearchForm({ search, sources, mode = "priority", defaults }: { search?: JobSearch; sources: SourceOption[]; mode?: DiscoverMode; defaults?: { query?: string; location?: string; terms?: string[] } }) {
  const editing = Boolean(search);
  const days = search?.maxAgeDays ?? 7;
  return (
    <ActionForm action={editing ? updateSearchAction : createSearchAction} resetOnSuccess={!editing} className="space-y-3">
      {search ? <input type="hidden" name="searchId" value={search.id} /> : null}
      <input type="hidden" name="mode" value={search?.mode ?? mode} />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="field">
          <span>What</span>
          <input name="query" required maxLength={120} defaultValue={search?.query ?? defaults?.query ?? ""} className="input" placeholder={mode === "explore" ? "e.g. program coordinator" : "e.g. customer success manager"} autoComplete="off" />
        </label>
        <label className="field">
          <span>Where</span>
          <input name="location" defaultValue={search?.location ?? defaults?.location ?? ""} className="input" placeholder="e.g. Tampa, FL — blank for anywhere" autoComplete="off" />
        </label>
        <label className="field">
          <span>Name</span>
          <input name="name" maxLength={120} defaultValue={search?.name ?? ""} className="input" placeholder="Defaults to what you search for" autoComplete="off" />
        </label>
        <label className="field">
          <span>Posted within</span>
          <select name="maxAgeDays" defaultValue={String(MAX_AGE_OPTIONS.some((o) => o.value === days) ? days : 7)} className="input">
            {MAX_AGE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {(search?.mode ?? mode) === "explore" ? <label className="field">
        <span>Related title phrases for ranking (one per line)</span>
        <textarea name="directionTerms" className="input" rows={2} defaultValue={(search?.directionTerms ?? defaults?.terms ?? []).join("\n")} />
      </label> : null}

      <label className="flex items-center gap-2 text-[0.8125rem]">
        <input type="checkbox" name="remoteOnly" defaultChecked={search?.remoteOnly ?? false} className="size-4 accent-primary" />
        Remote jobs only
      </label>

      <fieldset className="min-w-0">
        <legend className="mb-1 text-xs text-muted-foreground">Sources</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {sources.map((source) => (
            <label key={source.id} className="flex min-w-0 items-center gap-2 text-[0.8125rem]">
              <input type="checkbox" name="sources" value={source.id} defaultChecked={search ? search.sources.includes(source.id) : true} className="size-4 shrink-0 accent-primary" />
              <span className="min-w-0">
                {source.label}
                {!source.configured ? <span className="text-xs text-muted-foreground"> (not set up)</span> : source.remoteOnly ? <span className="text-xs text-muted-foreground"> (remote jobs)</span> : null}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <SubmitButton size="sm" pending="Saving…">
        {editing ? "Save search" : "Add search"}
      </SubmitButton>
    </ActionForm>
  );
}
