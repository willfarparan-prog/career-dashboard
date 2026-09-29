/** Words that don't distinguish one company or role from another. */
const NOISE = /\b(inc|llc|ltd|co|corp|corporation|company|the|remote|hybrid|us|usa)\b/g;

function normalize(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(NOISE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Same company + same title = the same job, whichever board it came from. */
export function dedupeKey(company: string, title: string): string {
  return `${normalize(company)}|${normalize(title)}`;
}
