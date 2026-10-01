import { GLOSSARY } from "@/content/learn/glossary";
import type { GlossaryTerm } from "@/content/learn/types";

/*
 * Finds glossary terms in free text (a posting, a requirement). Matching is
 * case-insensitive on whole words, so "ARR" never fires inside "narrative"
 * and "API" never inside "rapid". Pure and synchronous: safe on any page.
 */

type Matcher = { key: string; patterns: RegExp[] };

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A phrase as a whole-word pattern; spaces and hyphens match either, and a plural "s" is allowed. */
function phrasePattern(phrase: string): RegExp {
  const body = phrase
    .trim()
    .split(/[\s-]+/)
    .map(escapeRegExp)
    .join("[\\s-]+");
  return new RegExp(`(?<![\\p{L}\\p{N}])${body}(?:'?s)?(?![\\p{L}\\p{N}])`, "iu");
}

function buildMatchers(glossary: GlossaryTerm[]): Matcher[] {
  return glossary.map((term) => ({
    key: term.key,
    patterns: [term.term, ...term.aliases].filter((phrase) => phrase.trim()).map(phrasePattern),
  }));
}

const defaultMatchers = buildMatchers(GLOSSARY);
const byKey = new Map(GLOSSARY.map((term) => [term.key, term]));

/** Glossary keys found in `text`, in order of first appearance. */
export function findTerms(text: string, glossary?: GlossaryTerm[]): string[] {
  if (!text.trim()) return [];
  const matchers = glossary ? buildMatchers(glossary) : defaultMatchers;
  const hits: Array<{ key: string; index: number }> = [];
  for (const { key, patterns } of matchers) {
    let first = -1;
    for (const pattern of patterns) {
      const index = text.search(pattern);
      if (index >= 0 && (first < 0 || index < first)) first = index;
    }
    if (first >= 0) hits.push({ key, index: first });
  }
  return hits.sort((a, b) => a.index - b.index || a.key.localeCompare(b.key)).map((hit) => hit.key);
}

export function glossaryTerm(key: string): GlossaryTerm | undefined {
  return byKey.get(key);
}
