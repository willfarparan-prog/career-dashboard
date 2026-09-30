import { htmlToText, oneLine } from "../text";
import type { FetchLike, NormalizedLead, SearchSpec, SourceAdapter } from "../types";
import {
  asArray,
  asRecord,
  defaultFetch,
  isFresh,
  isHttpUrl,
  parseDate,
  parseSalaryText,
  readJson,
  request,
  str,
} from "./shared";

/*
 * Remotive's public remote-jobs API. Their terms ask for a link back to
 * Remotive on every listing and only a few requests a day.
 */

const LABEL = "Remotive";

export function parseRemotive(body: unknown, spec: SearchSpec, now = new Date()): NormalizedLead[] {
  const leads: NormalizedLead[] = [];
  for (const raw of asArray(asRecord(body).jobs)) {
    const item = asRecord(raw);
    const title = oneLine(item.title);
    const url = str(item.url);
    if (!title || !isHttpUrl(url)) continue;

    const postedAt = parseDate(item.publication_date);
    if (!isFresh(postedAt, spec.maxAgeDays, now)) continue;

    const region = oneLine(item.candidate_required_location);
    const salaryText = oneLine(item.salary);
    const { min, max } = parseSalaryText(salaryText);

    leads.push({
      source: "remotive",
      externalId: str(item.id) || url,
      title,
      company: oneLine(item.company_name),
      location: region ? `Remote (${region})` : "Remote",
      isRemote: true,
      salaryMin: min,
      salaryMax: max,
      salaryText,
      publisher: LABEL,
      url,
      applyOptions: [{ publisher: LABEL, url, isDirect: false }],
      description: htmlToText(str(item.description)),
      postedAt,
    });
  }
  return leads;
}

export async function fetchRemotive(spec: SearchSpec, fetchImpl: FetchLike = defaultFetch): Promise<{ leads: NormalizedLead[]; requests: number }> {
  const params = new URLSearchParams({ search: spec.query.trim(), limit: "50" });
  const response = await request(fetchImpl, LABEL, `https://remotive.com/api/remote-jobs?${params}`, { headers: { accept: "application/json" } });
  const body = await readJson(response, LABEL, 1);
  return { leads: parseRemotive(body, spec), requests: 1 };
}

export const remotive: SourceAdapter = {
  id: "remotive",
  label: "Remotive (remote)",
  description: "Curated remote jobs from Remotive. No key needed; a few requests a day.",
  attribution: { text: "Remote jobs from Remotive", href: "https://remotive.com" },
  envVars: [],
  configured: () => true,
  policy: { minIntervalMinutes: 720, dailyQuota: 4 },
  remoteOnly: true,
  fetch: fetchRemotive,
};
