import { XMLParser } from "fast-xml-parser";
import { htmlToText, matchesQuery, oneLine } from "../text";
import type { FetchLike, NormalizedLead, SearchSpec, SourceAdapter } from "../types";
import { asArray, asRecord, defaultFetch, isFresh, isHttpUrl, parseDate, request, SourceError, str } from "./shared";

/*
 * We Work Remotely's customer-support category feed (it carries customer
 * success roles too). RSS only, no search: we keep items that match the
 * search words. Item titles read "Company: Job Title".
 */

const LABEL = "We Work Remotely";
const FEED_URL = "https://weworkremotely.com/categories/remote-customer-support-jobs.rss";

const parser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,
  trimValues: true,
  processEntities: true,
  htmlEntities: true,
});

/** "Acme Inc: Customer Success Manager" → company + title (the first ": " splits them). */
export function splitWwrTitle(raw: string): { company: string; title: string } {
  const index = raw.indexOf(": ");
  if (index <= 0) return { company: "", title: raw.trim() };
  return { company: raw.slice(0, index).trim(), title: raw.slice(index + 2).trim() };
}

/** RSS text nodes may come back as strings or as { "#text": … } objects. */
function text(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return str(value);
  return str(asRecord(value)["#text"]);
}

export function parseWwr(xml: string, spec: SearchSpec, now = new Date()): NormalizedLead[] {
  let doc: unknown;
  try {
    doc = parser.parse(xml);
  } catch {
    throw new SourceError(`${LABEL} sent a feed that isn't valid RSS.`, 1);
  }
  const channel = asRecord(asRecord(asRecord(doc).rss).channel);
  const leads: NormalizedLead[] = [];
  for (const raw of asArray(channel.item)) {
    const item = asRecord(raw);
    const { company, title } = splitWwrTitle(oneLine(text(item.title)));
    const url = text(item.link) || text(item.guid);
    if (!title || !isHttpUrl(url)) continue;

    const postedAt = parseDate(text(item.pubDate));
    if (!isFresh(postedAt, spec.maxAgeDays, now)) continue;

    const description = htmlToText(text(item.description));
    if (!matchesQuery(title, description, spec.query)) continue;

    const region = oneLine(text(item.region));
    leads.push({
      source: "wwr",
      externalId: text(item.guid) || url,
      title,
      company,
      location: region ? `Remote (${region})` : "Remote",
      isRemote: true,
      salaryMin: null,
      salaryMax: null,
      salaryText: "",
      publisher: LABEL,
      url,
      applyOptions: [{ publisher: LABEL, url, isDirect: false }],
      description,
      postedAt,
    });
  }
  return leads;
}

export async function fetchWwr(spec: SearchSpec, fetchImpl: FetchLike = defaultFetch): Promise<{ leads: NormalizedLead[]; requests: number }> {
  const response = await request(fetchImpl, LABEL, FEED_URL, { headers: { accept: "application/rss+xml, application/xml, text/xml" } });
  return { leads: parseWwr(await response.text(), spec), requests: 1 };
}

export const wwr: SourceAdapter = {
  id: "wwr",
  label: "We Work Remotely",
  description: "Remote customer support and customer success jobs from We Work Remotely's feed. No key needed.",
  attribution: { text: "Jobs from We Work Remotely", href: "https://weworkremotely.com" },
  envVars: [],
  configured: () => true,
  policy: { minIntervalMinutes: 360 },
  remoteOnly: true,
  fetch: fetchWwr,
};
