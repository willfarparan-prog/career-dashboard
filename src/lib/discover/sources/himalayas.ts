import { htmlToText, matchesQuery, oneLine, toPlainText } from "../text";
import type { FetchLike, NormalizedLead, SearchSpec, SourceAdapter } from "../types";
import {
  annualize,
  asArray,
  asRecord,
  defaultFetch,
  formatSalary,
  isFresh,
  isHttpUrl,
  num,
  parseDate,
  readJson,
  request,
  SourceError,
  str,
} from "./shared";

/*
 * Himalayas: a remote-jobs board with a free, keyless JSON API. We try its
 * search endpoint first and fall back to the latest-jobs feed, filtering
 * locally, when search isn't available.
 */

const LABEL = "Himalayas";
const SEARCH_URL = "https://himalayas.app/jobs/api/search";
const LATEST_URL = "https://himalayas.app/jobs/api?limit=20";

function restrictionText(value: unknown): string {
  return asArray(value)
    .map((entry) => (typeof entry === "string" ? oneLine(entry) : oneLine(asRecord(entry).name ?? asRecord(entry).country)))
    .filter(Boolean)
    .join(", ");
}

export function parseHimalayas(body: unknown, spec: SearchSpec, now = new Date()): NormalizedLead[] {
  const root = asRecord(body);
  const items = Array.isArray(body) ? body : asArray(root.jobs ?? root.data ?? root.results);
  const leads: NormalizedLead[] = [];
  for (const raw of items) {
    const item = asRecord(raw);
    const title = oneLine(item.title);
    const url = str(item.applicationLink) || str(item.url) || str(item.guid);
    if (!title || !isHttpUrl(url)) continue;

    const postedAt = parseDate(item.pubDate);
    if (!isFresh(postedAt, spec.maxAgeDays, now)) continue;

    const description = htmlToText(str(item.description)) || toPlainText(str(item.excerpt));
    if (!matchesQuery(title, `${description}\n${str(item.excerpt)}`, spec.query)) continue;

    const restrictions = restrictionText(item.locationRestrictions);
    const currency = str(item.currency) || "USD";
    const isUsd = currency.toUpperCase() === "USD";
    const min = num(item.minSalary);
    const max = num(item.maxSalary);

    leads.push({
      source: "himalayas",
      externalId: str(item.guid) || url,
      title,
      company: oneLine(item.companyName),
      location: restrictions ? `Remote (${restrictions})` : "Remote",
      isRemote: true,
      salaryMin: isUsd ? annualize(min, "year") : null,
      salaryMax: isUsd ? annualize(max, "year") : null,
      salaryText: formatSalary(min, max, "year", currency),
      salaryProvenance: isUsd && (min != null || max != null) ? "disclosed" : "unknown",
      publisher: LABEL,
      url,
      applyOptions: [{ publisher: LABEL, url, isDirect: false }],
      description,
      postedAt,
    });
  }
  return leads;
}

export async function fetchHimalayas(spec: SearchSpec, fetchImpl: FetchLike = defaultFetch): Promise<{ leads: NormalizedLead[]; requests: number }> {
  const headers = { accept: "application/json" };
  const searchUrl = `${SEARCH_URL}?${new URLSearchParams({ q: spec.query.trim(), sort: "recent" })}`;
  let requests = 1;
  let response: Response;
  try {
    response = await request(fetchImpl, LABEL, searchUrl, { headers });
  } catch {
    // Search unavailable: take the latest jobs and filter them here.
    requests = 2;
    try {
      response = await request(fetchImpl, LABEL, LATEST_URL, { headers });
    } catch (error) {
      throw new SourceError(error instanceof Error ? error.message : `${LABEL} failed.`, requests);
    }
  }
  const body = await readJson(response, LABEL, requests);
  return { leads: parseHimalayas(body, spec), requests };
}

export const himalayas: SourceAdapter = {
  id: "himalayas",
  label: "Himalayas (remote)",
  description: "Remote jobs from Himalayas, often with salary ranges. No key needed.",
  attribution: { text: "Remote jobs from Himalayas", href: "https://himalayas.app" },
  envVars: [],
  configured: () => true,
  policy: { minIntervalMinutes: 720 },
  remoteOnly: true,
  fetch: fetchHimalayas,
};
