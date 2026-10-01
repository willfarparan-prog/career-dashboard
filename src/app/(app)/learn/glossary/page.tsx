import type { Metadata } from "next";
import Form from "next/form";
import { Badge, buttonClass, ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";
import { getDatabase } from "@/db";
import { GLOSSARY } from "@/content/learn/glossary";
import { GUIDE_ORDER, GUIDES, isGuidePath } from "@/content/learn/guides";
import type { GlossaryTerm } from "@/content/learn/types";
import { requireViewer } from "@/lib/auth/owner";
import { listProgress, termKey, type Progress } from "@/lib/learn/progress";
import { ProgressToggle } from "../parts";
import { Flashcards } from "./flashcards";

export const metadata: Metadata = { title: "Glossary · Learn" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)?.trim() || "";

const SHOW_OPTIONS = [
  { value: "", label: "All terms" },
  { value: "unknown", label: "Not known yet" },
  { value: "known", label: "Known" },
];

function matchesQuery(term: GlossaryTerm, query: string) {
  const q = query.toLowerCase();
  return [term.term, ...term.aliases, term.definition].some((text) => text.toLowerCase().includes(q));
}

export default async function GlossaryPage({ searchParams }: { searchParams: SearchParams }) {
  const [{ userId }, params] = await Promise.all([requireViewer(), searchParams]);
  const query = one(params.q);
  const pathParam = one(params.path);
  const path = isGuidePath(pathParam) ? pathParam : null;
  const show = one(params.show);
  const practice = one(params.practice) === "1";

  const db = getDatabase();
  const progress: Progress = db ? await listProgress(db, userId) : new Map();
  const known = (term: GlossaryTerm) => progress.get(termKey(term.key)) === "confident";
  const terms = GLOSSARY.filter((term) => !path || term.paths.includes(path))
    .filter((term) => !query || matchesQuery(term, query))
    .filter((term) => (show === "unknown" ? !known(term) : show === "known" ? known(term) : true))
    .sort((a, b) => a.term.localeCompare(b.term));
  const unknownCards = terms.filter((term) => !known(term)).map(({ key, term, definition, example }) => ({ key, term, definition, example }));

  const practiceHref = `/learn/glossary?${new URLSearchParams({ ...(query ? { q: query } : {}), ...(path ? { path } : {}), show: "unknown", practice: "1" })}`;

  return (
    <>
      <PageHeader
        title="Glossary"
        description={`${GLOSSARY.length} terms you'll meet in postings and interviews, in plain words. Mark the ones you could explain to an interviewer.`}
        back={{ href: "/learn", label: "Learn" }}
        actions={
          <ButtonLink href={practiceHref} variant={practice ? "secondary" : "primary"}>
            Practice with flashcards
          </ButtonLink>
        }
      />
      <div className="space-y-4">
        <Form action="/learn/glossary" className="grid gap-3 rounded-lg border border-border bg-card p-4 shadow-card sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_auto] lg:items-end">
          <label className="field">
            <span>Search</span>
            <input className="input" type="search" name="q" defaultValue={query} placeholder="NRR, go-live, broker…" />
          </label>
          <label className="field">
            <span>Path</span>
            <select className="input" name="path" defaultValue={path ?? ""}>
              <option value="">All paths</option>
              {GUIDE_ORDER.map((value) => (
                <option key={value} value={value}>
                  {GUIDES[value].title}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Show</span>
            <select className="input" name="show" defaultValue={show}>
              {SHOW_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className={buttonClass("secondary")}>
            Filter
          </button>
        </Form>

        {practice ? (
          <Card title="Flashcards" description="Terms in this view you haven't marked as known.">
            <Flashcards cards={unknownCards} />
          </Card>
        ) : null}

        {terms.length ? (
          <Card>
            <ul className="divide-y divide-border">
              {terms.map((term) => (
                <li key={term.key} id={`term-${term.key}`} className="scroll-mt-20 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-[12rem] flex-1">
                      <p className="text-sm font-bold">{term.term}</p>
                      {term.aliases.length ? <p className="text-xs text-muted-foreground">Also: {term.aliases.join(", ")}</p> : null}
                    </div>
                    <ProgressToggle itemKey={termKey(term.key)} current={progress.get(termKey(term.key))} status="confident" label="I know this" doneLabel="Known" />
                  </div>
                  <p className="mt-1 text-sm">{term.definition}</p>
                  {term.example ? <p className="mt-1 text-sm text-muted-foreground">e.g. {term.example}</p> : null}
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {term.paths.map((value) => (
                      <Badge key={value}>{GUIDES[value].title}</Badge>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        ) : (
          <EmptyState title="No terms match">Try a different search, or show all terms.</EmptyState>
        )}
      </div>
    </>
  );
}
