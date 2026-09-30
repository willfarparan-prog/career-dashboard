/*
 * Plain-text helpers for postings pulled from job boards: HTML → readable
 * text, and the loose keyword match boards without server-side search use.
 */

/** Longest description stored for a lead. */
export const MAX_TEXT = 60_000;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ensp: " ",
  emsp: " ",
  thinsp: " ",
  ndash: "–",
  mdash: "—",
  lsquo: "‘",
  rsquo: "’",
  sbquo: "‚",
  ldquo: "“",
  rdquo: "”",
  bdquo: "„",
  hellip: "…",
  bull: "•",
  middot: "·",
  copy: "©",
  reg: "®",
  trade: "™",
  euro: "€",
  pound: "£",
  yen: "¥",
  cent: "¢",
  deg: "°",
  times: "×",
  divide: "÷",
  laquo: "«",
  raquo: "»",
  shy: "",
  zwj: "",
  zwnj: "",
};

/** Decodes named (common) and numeric HTML entities; unknown ones are left as written. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (match, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return match;
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named ?? match;
  });
}

/** Collapses spaces within lines and runs of blank lines; trims; caps the length. */
function tidy(text: string, max: number): string {
  let out = text
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\f\v  -​  　 ]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    // A bullet whose text landed on the next line ("- \n\nText") joins back up.
    .replace(/^-\n+(?=\S)/gm, "- ")
    .replace(/^-$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (out.length > max) out = out.slice(0, max).trimEnd();
  return out;
}

/**
 * HTML → plain text: drops scripts/styles, turns list items into "- " lines
 * and block elements into paragraph breaks, decodes entities, collapses
 * whitespace and caps at 60,000 characters.
 */
export function htmlToText(html: string | null | undefined, max = MAX_TEXT): string {
  if (!html) return "";
  const text = html
    .replace(/<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<\/li\s*>/gi, "")
    .replace(/<\/?(p|div|section|article|header|footer|main|aside|ul|ol|dl|dt|dd|table|thead|tbody|blockquote|pre|h[1-6]|hr)\b[^>]*>/gi, "\n\n")
    .replace(/<\/?(tr)\b[^>]*>/gi, "\n")
    .replace(/<\/?(td|th)\b[^>]*>/gi, " ")
    .replace(/<\/?[a-z][^>]*>/gi, "");
  return tidy(decodeEntities(text), max);
}

/** Plain text that may still carry entities or messy whitespace. */
export function cleanText(text: string | null | undefined, max = MAX_TEXT): string {
  if (!text) return "";
  return tidy(decodeEntities(text), max);
}

const LOOKS_LIKE_HTML = /<\/?(p|div|br|li|ul|ol|strong|b|em|i|span|h[1-6]|a|table|section)\b[^>]*>/i;

/** Some sources send HTML, some plain text; this handles either. */
export function toPlainText(text: string | null | undefined, max = MAX_TEXT): string {
  if (!text) return "";
  return LOOKS_LIKE_HTML.test(text) ? htmlToText(text, max) : cleanText(text, max);
}

/** One line, no markup (titles, company names, locations). */
export function oneLine(text: unknown): string {
  if (typeof text !== "string" && typeof text !== "number") return "";
  return htmlToText(String(text), 500).replace(/\s+/g, " ").trim();
}

const STOP_WORDS = new Set([
  "a", "an", "and", "or", "the", "of", "in", "for", "to", "with", "at", "on", "by", "from",
  "remote", "hybrid", "onsite", "job", "jobs", "role", "roles", "position", "positions", "opening", "openings",
]);

/** Lowercase words; hyphenated compounds also count joined ("well-being" → well, being, wellbeing). */
export function words(text: string): string[] {
  const lower = text.toLowerCase();
  const out = lower.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  for (const compound of lower.match(/[\p{L}\p{N}]+(?:[-‐‑][\p{L}\p{N}]+)+/gu) ?? []) {
    out.push(compound.replace(/[-‐‑]/g, ""));
  }
  return out;
}

/** Plural-insensitive form: managers → manager, but success stays success. */
function stem(word: string): string {
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

/** The words of a search that have to show up in a posting ("customer success manager" → 3 words). */
export function queryKeywords(query: string): string[] {
  return [...new Set(words(query).filter((w) => w.length > 1 && !STOP_WORDS.has(w)).map(stem))];
}

/** How many of `keywords` appear in `text`. */
export function keywordHits(text: string, keywords: string[]): number {
  if (!keywords.length) return 0;
  const present = new Set(words(text).map(stem));
  return keywords.filter((k) => present.has(k)).length;
}

/**
 * Loose match for boards without server-side search: the title carries at
 * least half the search words, or some of them with the rest in the text.
 */
export function matchesQuery(title: string, description: string, query: string): boolean {
  const keywords = queryKeywords(query);
  if (!keywords.length) return true;
  const inTitle = keywordHits(title, keywords);
  if (inTitle >= Math.ceil(keywords.length / 2)) return true;
  return inTitle >= 1 && keywordHits(`${title}\n${description}`, keywords) === keywords.length;
}
