import type { ApplyOption } from "@/db/schema";
import { htmlToText, keywordHits, oneLine, queryKeywords } from "../text";
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
  readJson,
  request,
  requireEnv,
  str,
  type PayPeriod,
} from "./shared";

/*
 * USAJOBS, the federal government's official job search API
 * (developer.usajobs.gov). Free with a key; the registered email goes in the
 * User-Agent header. Public announcements only. Pay ranges are always the
 * posted grade range, so they count as disclosed.
 *
 * USAJOBS matches keywords against synonyms and the whole announcement, and
 * federal boilerplate mentions "performance", "program" and "human" (HHS)
 * almost everywhere. So, unlike the boards' loose matchesQuery(), a lead is
 * kept only when its title carries at least half the search words.
 */

const LABEL = "USAJOBS";
const ENV_VARS = ["USAJOBS_API_KEY", "USAJOBS_EMAIL"];
/** Miles around the city, so installations just outside it still match. */
const RADIUS_MILES = 50;
/** The API's DatePosted accepts 0–60 days. */
const MAX_DATE_POSTED = 60;

const STATES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut",
  DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  PR: "Puerto Rico", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas",
  UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};

/** "San Diego, CA" → "San Diego, California", the form USAJOBS location names use. */
export function usajobsLocation(place: string): string {
  const match = /^(.+?),\s*([A-Za-z]{2})$/.exec(place.trim());
  const state = match ? STATES[match[2].toUpperCase()] : undefined;
  return match && state ? `${match[1].trim()}, ${state}` : place.trim();
}

/** RateIntervalCode → pay period (PA per year, PH per hour, PD per day, PM per month, BW bi-weekly). Others aren't salaries. */
const RATE_PERIODS: Record<string, PayPeriod | "biweekly"> = { PA: "year", PH: "hour", PD: "day", PM: "month", BW: "biweekly" };

export function usajobsParams(spec: SearchSpec): URLSearchParams {
  const params = new URLSearchParams({ Keyword: spec.query.trim() });
  const place = placeFor(spec);
  if (spec.remoteOnly || /^remote$/i.test(spec.location.trim())) params.set("RemoteIndicator", "True");
  else if (place) {
    params.set("LocationName", usajobsLocation(place));
    params.set("Radius", String(RADIUS_MILES));
  }
  params.set("DatePosted", String(Math.min(Math.max(0, spec.maxAgeDays), MAX_DATE_POSTED)));
  params.set("ResultsPerPage", "50");
  params.set("SortField", "opendate");
  params.set("SortDirection", "desc");
  return params;
}

function pay(descriptor: Record<string, unknown>) {
  const first = asRecord(asArray(descriptor.PositionRemuneration)[0]);
  const period = RATE_PERIODS[str(first.RateIntervalCode).toUpperCase()];
  const low = num(first.MinimumRange);
  const high = num(first.MaximumRange);
  if (!period || (low == null && high == null)) return { min: null, max: null, text: "" };
  if (period === "biweekly") {
    const min = annualize(low == null ? null : low / 2, "week");
    const max = annualize(high == null ? null : high / 2, "week");
    return { min, max, text: formatSalary(min, max, "year") };
  }
  return { min: annualize(low, period), max: annualize(high, period), text: formatSalary(low, high, period) };
}

/** "Multiple Locations" says nothing; list the actual places instead (first three). */
function locationOf(descriptor: Record<string, unknown>): string {
  const display = oneLine(descriptor.PositionLocationDisplay);
  if (display && !/^multiple locations?$/i.test(display)) return display;
  const names = asArray(descriptor.PositionLocation).map((l) => oneLine(asRecord(l).LocationName)).filter(Boolean);
  if (!names.length) return display;
  return names.length > 3 ? `${names.slice(0, 3).join("; ")} (+${names.length - 3} more)` : names.join("; ");
}

function textOf(value: unknown): string {
  return asArray(value).map((v) => str(v)).filter(Boolean).join("\n\n");
}

/** At least half the search words (stemmed) appear in the title. */
export function titleMatches(title: string, query: string): boolean {
  const keywords = queryKeywords(query);
  return !keywords.length || keywordHits(title, keywords) >= Math.ceil(keywords.length / 2);
}

export function parseUsajobs(body: unknown, spec: SearchSpec, now = new Date()): NormalizedLead[] {
  const leads: NormalizedLead[] = [];
  for (const raw of asArray(asRecord(asRecord(body).SearchResult).SearchResultItems)) {
    const item = asRecord(raw);
    const d = asRecord(item.MatchedObjectDescriptor);
    const title = oneLine(d.PositionTitle);
    const viewUrl = str(d.PositionURI);
    const applyUrl = asArray(d.ApplyURI).map(str).find(isHttpUrl) ?? "";
    const url = isHttpUrl(viewUrl) ? viewUrl : applyUrl;
    if (!title || !url || !titleMatches(title, spec.query)) continue;

    const postedAt = parseDate(d.PublicationStartDate);
    if (!isFresh(postedAt, spec.maxAgeDays, now)) continue;

    const details = asRecord(asRecord(d.UserArea).Details);
    const location = locationOf(d);
    const description = htmlToText(
      [textOf(details.JobSummary), textOf(details.MajorDuties), textOf(d.QualificationSummary)].filter(Boolean).join("\n\n"),
    );
    const salary = pay(d);
    const applyOptions: ApplyOption[] = [{ publisher: LABEL, url, isDirect: true }];
    if (applyUrl && applyUrl !== url) applyOptions.push({ publisher: `${LABEL} (apply)`, url: applyUrl, isDirect: true });

    leads.push({
      source: "usajobs",
      externalId: str(item.MatchedObjectId) || str(d.PositionID) || url,
      title,
      company: oneLine(d.OrganizationName) || oneLine(d.DepartmentName),
      location,
      isRemote: details.RemoteIndicator === true || mentionsRemote(title, location),
      salaryMin: salary.min,
      salaryMax: salary.max,
      salaryText: salary.text,
      salaryProvenance: salary.min != null || salary.max != null ? "disclosed" : "unknown",
      publisher: LABEL,
      url,
      applyOptions,
      description,
      postedAt,
    });
  }
  return leads;
}

export async function fetchUsajobs(spec: SearchSpec, fetchImpl: FetchLike = defaultFetch): Promise<{ leads: NormalizedLead[]; requests: number }> {
  const [apiKey, email] = requireEnv(LABEL, ENV_VARS);
  const url = `https://data.usajobs.gov/api/search?${usajobsParams(spec)}`;
  const response = await request(fetchImpl, LABEL, url, {
    headers: { accept: "application/json", "user-agent": email, "authorization-key": apiKey },
  });
  const body = await readJson(response, LABEL, 1);
  return { leads: parseUsajobs(body, spec), requests: 1 };
}

export const usajobs: SourceAdapter = {
  id: "usajobs",
  label: "USAJOBS",
  description: "Federal government jobs from the official USAJOBS API (public announcements, posted pay ranges).",
  attribution: null,
  envVars: ENV_VARS,
  configured: () => ENV_VARS.every((name) => Boolean(env(name))),
  policy: { minIntervalMinutes: 360 },
  remoteOnly: false,
  fetch: fetchUsajobs,
};
