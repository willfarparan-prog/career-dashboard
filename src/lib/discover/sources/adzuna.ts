import { htmlToText, oneLine } from "../text";
import type { FetchLike, NormalizedLead, SearchSpec, SourceAdapter } from "../types";
import {
  annualize,
  asArray,
  asRecord,
  defaultFetch,
  env,
  formatSalary,
  isFresh,
  isHttpUrl,
  mentionsRemote,
  num,
  parseDate,
  placeFor,
  queryWithRemote,
  readJson,
  request,
  requireEnv,
  str,
} from "./shared";

/*
 * Adzuna's US search API. Descriptions are short snippets, and every listing
 * has to carry the "Jobs by Adzuna" credit. Salaries are yearly; some are
 * Adzuna's own estimates, which we label as such.
 */

const LABEL = "Adzuna";
const ENV_VARS = ["ADZUNA_APP_ID", "ADZUNA_APP_KEY"];

export function adzunaParams(spec: SearchSpec, appId: string, appKey: string): URLSearchParams {
  const params = new URLSearchParams({ app_id: appId, app_key: appKey, what: queryWithRemote(spec) });
  const place = placeFor(spec);
  if (place) params.set("where", place);
  params.set("results_per_page", "50");
  params.set("max_days_old", String(spec.maxAgeDays));
  params.set("content-type", "application/json");
  return params;
}

export function parseAdzuna(body: unknown, spec: SearchSpec, now = new Date()): NormalizedLead[] {
  const leads: NormalizedLead[] = [];
  for (const raw of asArray(asRecord(body).results)) {
    const item = asRecord(raw);
    const title = oneLine(item.title);
    const url = str(item.redirect_url);
    if (!title || !isHttpUrl(url)) continue;

    const postedAt = parseDate(item.created);
    if (!isFresh(postedAt, spec.maxAgeDays, now)) continue;

    const location = oneLine(asRecord(item.location).display_name);
    const description = htmlToText(str(item.description));
    const min = annualize(num(item.salary_min), "year");
    const max = annualize(num(item.salary_max), "year");
    const predicted = str(item.salary_is_predicted) === "1" || item.salary_is_predicted === true;
    const salary = formatSalary(min, max, "year");

    leads.push({
      source: "adzuna",
      externalId: str(item.id) || url,
      title,
      company: oneLine(asRecord(item.company).display_name),
      location,
      isRemote: mentionsRemote(title, location, description),
      salaryMin: min,
      salaryMax: max,
      salaryText: salary && predicted ? `~${salary} (Adzuna estimate)` : salary,
      salaryProvenance: predicted ? "estimated" : min != null || max != null ? "disclosed" : "unknown",
      publisher: LABEL,
      url,
      applyOptions: [{ publisher: LABEL, url, isDirect: false }],
      description,
      postedAt,
    });
  }
  return leads;
}

export async function fetchAdzuna(spec: SearchSpec, fetchImpl: FetchLike = defaultFetch): Promise<{ leads: NormalizedLead[]; requests: number }> {
  const [appId, appKey] = requireEnv(LABEL, ENV_VARS);
  const url = `https://api.adzuna.com/v1/api/jobs/us/search/1?${adzunaParams(spec, appId, appKey)}`;
  const response = await request(fetchImpl, LABEL, url, { headers: { accept: "application/json" } });
  const body = await readJson(response, LABEL, 1);
  return { leads: parseAdzuna(body, spec), requests: 1 };
}

export const adzuna: SourceAdapter = {
  id: "adzuna",
  label: "Adzuna",
  description: "US job listings aggregated by Adzuna (short summaries; open the posting for the full text).",
  attribution: { text: "Jobs by Adzuna", href: "https://www.adzuna.com" },
  envVars: ENV_VARS,
  configured: () => ENV_VARS.every((name) => Boolean(env(name))),
  policy: { minIntervalMinutes: 360, dailyQuota: 250, monthlyQuota: 2500 },
  remoteOnly: false,
  fetch: fetchAdzuna,
};
