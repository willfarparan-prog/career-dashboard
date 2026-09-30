import type { ApplyOption } from "@/db/schema";
import { oneLine, toPlainText } from "../text";
import type { FetchLike, NormalizedLead, SearchSpec, SourceAdapter } from "../types";
import {
  annualize,
  asArray,
  asRecord,
  datePostedBucket,
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
  SourceError,
  str,
  toPeriod,
} from "./shared";

/*
 * JSearch: Google Jobs results, which include listings from LinkedIn, Indeed,
 * Glassdoor, ZipRecruiter and company career sites. Sold through RapidAPI
 * (default) or OpenWeb Ninja; both take the same parameters.
 */

const LABEL = "JSearch";

const PROVIDERS = {
  rapidapi: {
    url: "https://jsearch.p.rapidapi.com/search",
    headers: (key: string): Record<string, string> => ({ "x-rapidapi-key": key, "x-rapidapi-host": "jsearch.p.rapidapi.com" }),
  },
  openwebninja: {
    url: "https://api.openwebninja.com/jsearch/search",
    headers: (key: string): Record<string, string> => ({ "x-api-key": key }),
  },
} as const;

type Provider = keyof typeof PROVIDERS;

function provider(): Provider {
  const value = env("JSEARCH_PROVIDER").toLowerCase() || "rapidapi";
  if (value === "rapidapi" || value === "openwebninja") return value;
  throw new SourceError(`${LABEL}: JSEARCH_PROVIDER must be "rapidapi" or "openwebninja".`);
}

export function jsearchParams(spec: SearchSpec): URLSearchParams {
  const place = placeFor(spec);
  const query = queryWithRemote(spec);
  const params = new URLSearchParams({
    query: place ? `${query} in ${place}` : query,
    page: "1",
    num_pages: "1",
    country: "us",
    date_posted: datePostedBucket(spec.maxAgeDays),
  });
  if (spec.remoteOnly) params.set("work_from_home", "true");
  return params;
}

function applyOptions(item: Record<string, unknown>): ApplyOption[] {
  const options: ApplyOption[] = [];
  for (const raw of asArray(item.apply_options)) {
    const option = asRecord(raw);
    const url = str(option.apply_link);
    if (!isHttpUrl(url) || options.some((o) => o.url === url)) continue;
    options.push({ publisher: oneLine(option.publisher) || "Apply", url, isDirect: option.is_direct === true });
  }
  const main = str(item.job_apply_link);
  if (isHttpUrl(main) && !options.some((o) => o.url === main)) {
    options.unshift({ publisher: oneLine(item.job_publisher) || LABEL, url: main, isDirect: item.job_apply_is_direct === true });
  }
  return options;
}

/** The official (direct) apply page when there is one, else the main apply link. */
function bestUrl(item: Record<string, unknown>, options: ApplyOption[]): string {
  const main = str(item.job_apply_link);
  if (isHttpUrl(main) && item.job_apply_is_direct === true) return main;
  const direct = options.find((o) => o.isDirect);
  if (direct) return direct.url;
  if (isHttpUrl(main)) return main;
  return options[0]?.url ?? "";
}

export function parseJsearch(body: unknown, spec: SearchSpec, now = new Date()): NormalizedLead[] {
  const root = asRecord(body);
  if (str(root.status).toUpperCase() === "ERROR") {
    const message = oneLine(asRecord(root.error).message) || "unknown error";
    throw new SourceError(`${LABEL} returned an error: ${message}`, 1);
  }
  const leads: NormalizedLead[] = [];
  for (const raw of asArray(root.data)) {
    const item = asRecord(raw);
    const title = oneLine(item.job_title);
    const options = applyOptions(item);
    const url = bestUrl(item, options);
    if (!title || !url) continue;

    const postedAt = parseDate(item.job_posted_at_datetime_utc) ?? parseDate(item.job_posted_at_timestamp);
    if (!isFresh(postedAt, spec.maxAgeDays, now)) continue;

    const location =
      oneLine(item.job_location) || [item.job_city, item.job_state, item.job_country].map(oneLine).filter(Boolean).join(", ");
    const period = toPeriod(item.job_salary_period) ?? "year";
    const rawMin = num(item.job_min_salary);
    const rawMax = num(item.job_max_salary);
    const currency = str(item.job_salary_currency) || "USD";
    const isUsd = currency.toUpperCase() === "USD";

    leads.push({
      source: "jsearch",
      externalId: str(item.job_id) || url,
      title,
      company: oneLine(item.employer_name),
      location,
      isRemote: item.job_is_remote === true || mentionsRemote(location),
      salaryMin: isUsd ? annualize(rawMin, period) : null,
      salaryMax: isUsd ? annualize(rawMax, period) : null,
      salaryText: formatSalary(rawMin, rawMax, period, currency),
      publisher: oneLine(item.job_publisher) || LABEL,
      url,
      applyOptions: options,
      description: toPlainText(str(item.job_description)),
      postedAt,
    });
  }
  return leads;
}

export async function fetchJsearch(spec: SearchSpec, fetchImpl: FetchLike = defaultFetch): Promise<{ leads: NormalizedLead[]; requests: number }> {
  const [key] = requireEnv(LABEL, ["JSEARCH_API_KEY"]);
  const target = PROVIDERS[provider()];
  const response = await request(fetchImpl, LABEL, `${target.url}?${jsearchParams(spec)}`, {
    headers: { ...target.headers(key), accept: "application/json" },
  });
  const body = await readJson(response, LABEL, 1);
  return { leads: parseJsearch(body, spec), requests: 1 };
}

export const jsearch: SourceAdapter = {
  id: "jsearch",
  label: "LinkedIn, Indeed & more (JSearch)",
  description: "Google Jobs — listings from LinkedIn, Indeed, Glassdoor, ZipRecruiter and company career sites.",
  attribution: null,
  envVars: ["JSEARCH_API_KEY"],
  configured: () => Boolean(env("JSEARCH_API_KEY")),
  policy: { minIntervalMinutes: 360, monthlyQuota: 200 },
  remoteOnly: false,
  fetch: fetchJsearch,
};
