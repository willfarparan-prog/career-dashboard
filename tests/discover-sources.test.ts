import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, beforeEach, describe, mock, test } from "node:test";
import { scoreLead, type ScoreContext } from "@/lib/discover/score";
import { suggestedSearches } from "@/lib/discover/searches";
import { adzuna } from "@/lib/discover/sources/adzuna";
import { himalayas } from "@/lib/discover/sources/himalayas";
import { SOURCES } from "@/lib/discover/sources";
import { jsearch } from "@/lib/discover/sources/jsearch";
import { remotive } from "@/lib/discover/sources/remotive";
import { parseUsajobs, usajobs, usajobsLocation } from "@/lib/discover/sources/usajobs";
import { formatSalary, parseSalaryText, SourceError } from "@/lib/discover/sources/shared";
import { splitWwrTitle, wwr } from "@/lib/discover/sources/wwr";
import { htmlToText, matchesQuery, MAX_TEXT } from "@/lib/discover/text";
import type { FetchLike, NormalizedLead, SearchSpec } from "@/lib/discover/types";

/*
 * Source adapters against fixture responses written from each API's documented
 * format. No network: every test injects fetchImpl. The clock is pinned so the
 * fixtures' dates stay "recent".
 */

const NOW = Date.parse("2026-09-29T12:00:00Z");
const ENV_KEYS = ["JSEARCH_API_KEY", "JSEARCH_PROVIDER", "ADZUNA_APP_ID", "ADZUNA_APP_KEY", "USAJOBS_API_KEY", "USAJOBS_EMAIL"] as const;
const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

function setEnv(values: Partial<Record<(typeof ENV_KEYS)[number], string>>) {
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, values);
}

before(() => mock.timers.enable({ apis: ["Date"], now: NOW }));
beforeEach(() => setEnv({}));
after(() => {
  mock.timers.reset();
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

const fixture = (name: string) => readFileSync(path.join(__dirname, "fixtures", "discover", name), "utf8");

type Call = { url: string; headers: Record<string, string> };

/** A fetch that answers from `handler` and remembers what was asked. */
function fakeFetch(handler: (url: string, n: number) => Response) {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (input, init) => {
    calls.push({ url: input, headers: Object.fromEntries(new Headers(init?.headers).entries()) });
    return handler(input, calls.length);
  };
  return { fetchImpl, calls };
}

const json = (body: string, status = 200) => new Response(body, { status, headers: { "content-type": "application/json" } });

const SPEC: SearchSpec = { query: "customer success manager", location: "Tampa, FL", remoteOnly: false, maxAgeDays: 7 };

const byId = (leads: NormalizedLead[], id: string) => {
  const lead = leads.find((l) => l.externalId === id);
  assert.ok(lead, `missing lead ${id}`);
  return lead;
};

describe("text helpers", () => {
  test("HTML becomes readable plain text", () => {
    const html = "<h2>About</h2><p>We&rsquo;re hiring &amp; growing.</p><ul><li>Own renewals</li><li> Run QBRs </li></ul><script>alert(1)</script><p>Pay:&nbsp;$90k&#8211;$100k</p>";
    assert.equal(htmlToText(html), "About\n\nWe’re hiring & growing.\n\n- Own renewals\n- Run QBRs\n\nPay: $90k–$100k");
  });

  test("text is capped at 60,000 characters", () => {
    assert.equal(htmlToText(`<p>${"a".repeat(70_000)}</p>`).length, MAX_TEXT);
  });

  test("keyword matching wants most search words in the title", () => {
    assert.equal(matchesQuery("Customer Success Lead", "", "customer success manager"), true);
    assert.equal(matchesQuery("Senior Customer Support Specialist", "Answer tickets.", "customer success manager"), false);
    assert.equal(matchesQuery("Customer Specialist", "Success manager for accounts", "customer success manager"), true);
    assert.equal(matchesQuery("Employee Well-being Program Manager", "", "wellbeing program"), true);
  });

  test("salary text parses dollars and skips other currencies", () => {
    assert.deepEqual(parseSalaryText("$70k - $90k"), { min: 70000, max: 90000 });
    assert.deepEqual(parseSalaryText("$100,000 - $120,000 USD"), { min: 100000, max: 120000 });
    assert.deepEqual(parseSalaryText("60-80k"), { min: 60000, max: 80000 });
    assert.deepEqual(parseSalaryText("$40/hour"), { min: 83200, max: 83200 });
    assert.deepEqual(parseSalaryText("€50,000 - €60,000"), { min: null, max: null });
    assert.deepEqual(parseSalaryText("Competitive"), { min: null, max: null });
    assert.equal(formatSalary(85000, 100000, "year"), "$85k–$100k a year");
    assert.equal(formatSalary(30, null, "hour"), "$30+ an hour");
    assert.equal(formatSalary(null, null, "year"), "");
  });
});

describe("registry", () => {
  test("all six sources, in display order, with the required credits", () => {
    assert.deepEqual(SOURCES.map((s) => s.id), ["jsearch", "adzuna", "usajobs", "himalayas", "remotive", "wwr"]);
    assert.deepEqual(SOURCES.filter((s) => s.remoteOnly).map((s) => s.id), ["himalayas", "remotive", "wwr"]);
    assert.equal(adzuna.attribution?.text, "Jobs by Adzuna");
    assert.equal(remotive.attribution?.href, "https://remotive.com");
    assert.deepEqual(jsearch.policy, { minIntervalMinutes: 360, monthlyQuota: 200 });
    assert.deepEqual(adzuna.policy, { minIntervalMinutes: 360, dailyQuota: 250, monthlyQuota: 2500 });
    assert.deepEqual(remotive.policy, { minIntervalMinutes: 720, dailyQuota: 4 });
    assert.deepEqual(usajobs.policy, { minIntervalMinutes: 360 });
    assert.equal(usajobs.attribution, null);
  });
});

describe("JSearch", () => {
  test("builds the RapidAPI request and normalizes listings", async () => {
    setEnv({ JSEARCH_API_KEY: "test-jsearch-key" });
    assert.equal(jsearch.configured(), true);
    const { fetchImpl, calls } = fakeFetch(() => json(fixture("jsearch.json")));
    const { leads, requests } = await jsearch.fetch(SPEC, fetchImpl);

    assert.equal(requests, 1);
    assert.equal(calls.length, 1);
    const url = new URL(calls[0].url);
    assert.equal(`${url.origin}${url.pathname}`, "https://jsearch.p.rapidapi.com/search");
    assert.equal(url.searchParams.get("query"), "customer success manager in Tampa, FL");
    assert.equal(url.searchParams.get("date_posted"), "week");
    assert.equal(url.searchParams.get("country"), "us");
    assert.equal(url.searchParams.get("page"), "1");
    assert.equal(url.searchParams.get("num_pages"), "1");
    assert.equal(url.searchParams.has("work_from_home"), false);
    assert.equal(calls[0].headers["x-rapidapi-key"], "test-jsearch-key");
    assert.equal(calls[0].headers["x-rapidapi-host"], "jsearch.p.rapidapi.com");

    // Old posting dropped; no title / no link skipped.
    assert.deepEqual(leads.map((l) => l.externalId), ["jsA1xYz==", "jsB2", "jsC3", "https://minimal.example/jobs/onboarding"]);

    const acme = byId(leads, "jsA1xYz==");
    assert.equal(acme.source, "jsearch");
    assert.equal(acme.title, "Customer Success Manager");
    assert.equal(acme.company, "Acme Health");
    assert.equal(acme.publisher, "LinkedIn");
    assert.equal(acme.url, "https://careers.acmehealth.example/jobs/csm-123", "prefers the direct apply option");
    assert.deepEqual(acme.applyOptions.map((o) => [o.publisher, o.isDirect]), [["LinkedIn", false], ["Acme Health Careers", true], ["Indeed", false]]);
    assert.equal(acme.location, "Tampa, FL");
    assert.equal(acme.isRemote, false);
    assert.equal(acme.salaryMin, 85000);
    assert.equal(acme.salaryMax, 100000);
    assert.equal(acme.salaryText, "$85k–$100k a year");
    assert.equal(acme.postedAt?.toISOString(), "2026-09-28T14:00:00.000Z");
    assert.equal(acme.description, "Acme Health helps employers run wellbeing programs.\n\nWhat you'll do:\n• Own a book of 40 employer accounts\n• Lead onboarding & quarterly reviews\n\nWhat you bring: 3+ years in customer success.");

    const hourly = byId(leads, "jsB2");
    assert.equal(hourly.salaryMin, 62400, "$30/hour × 2080");
    assert.equal(hourly.salaryMax, 83200);
    assert.equal(hourly.salaryText, "$30–$40 an hour");
    assert.equal(hourly.isRemote, true);
    assert.equal(hourly.url, "https://brightline.example/careers/impl-9");
    assert.equal(hourly.description, "Help new customers go live.\n\n- Configure accounts\n- Train admins");

    const monthly = byId(leads, "jsC3");
    assert.equal(monthly.salaryMin, 72000, "$6,000/month × 12");
    assert.equal(monthly.salaryMax, 84000);
    assert.equal(monthly.salaryText, "$6k–$7k a month");
    assert.equal(monthly.location, "St. Petersburg, FL, US");
    assert.equal(monthly.postedAt?.toISOString(), "2026-09-26T00:00:00.000Z");

    const minimal = byId(leads, "https://minimal.example/jobs/onboarding");
    assert.equal(minimal.company, "");
    assert.equal(minimal.salaryMin, null);
    assert.equal(minimal.salaryText, "");
    assert.equal(minimal.postedAt, null);
    assert.equal(minimal.publisher, "JSearch");
  });

  test("OpenWeb Ninja provider and remote-only searches", async () => {
    setEnv({ JSEARCH_API_KEY: "test-jsearch-key", JSEARCH_PROVIDER: "openwebninja" });
    const { fetchImpl, calls } = fakeFetch(() => json(JSON.stringify({ status: "OK", data: [] })));
    await jsearch.fetch({ ...SPEC, remoteOnly: true, maxAgeDays: 30 }, fetchImpl);
    const url = new URL(calls[0].url);
    assert.equal(`${url.origin}${url.pathname}`, "https://api.openwebninja.com/jsearch/search");
    assert.equal(calls[0].headers["x-api-key"], "test-jsearch-key");
    assert.equal(calls[0].headers["x-rapidapi-key"], undefined);
    assert.equal(url.searchParams.get("query"), "customer success manager remote");
    assert.equal(url.searchParams.get("work_from_home"), "true");
    assert.equal(url.searchParams.get("date_posted"), "month");
  });

  test("non-2xx and API errors are clear, and never echo the key", async () => {
    setEnv({ JSEARCH_API_KEY: "test-jsearch-key" });
    const limited = fakeFetch(() => json('{"message":"Too many requests"}', 429));
    await assert.rejects(jsearch.fetch(SPEC, limited.fetchImpl), (error: unknown) => {
      assert.ok(error instanceof SourceError);
      assert.equal(error.message, "JSearch returned 429 (rate limited): Too many requests.");
      assert.equal(error.requests, 1);
      assert.doesNotMatch(error.message, /test-jsearch-key/);
      return true;
    });
    const apiError = fakeFetch(() => json(JSON.stringify({ status: "ERROR", error: { message: "Invalid query" } })));
    await assert.rejects(jsearch.fetch(SPEC, apiError.fetchImpl), /JSearch returned an error: Invalid query/);
  });

  test("a refusal says why in the vendor's own words, when it gives a JSON reason", async () => {
    setEnv({ JSEARCH_API_KEY: "test-jsearch-key" });
    const notFound = fakeFetch(() => json(`{"message":"Endpoint '/search' does not exist"}`, 404));
    await assert.rejects(jsearch.fetch(SPEC, notFound.fetchImpl), (error: unknown) => {
      assert.ok(error instanceof SourceError);
      assert.equal(error.message, "JSearch returned 404 (not found): Endpoint '/search' does not exist.");
      assert.equal(error.requests, 1);
      return true;
    });
    const notSubscribed = fakeFetch(() => json(JSON.stringify({ error: { message: "You are not subscribed to this API." } }), 403));
    await assert.rejects(jsearch.fetch(SPEC, notSubscribed.fetchImpl), /JSearch returned 403 \(check the API key or plan\): You are not subscribed to this API\.$/);
    // HTML error pages, empty bodies and oversized bodies add nothing.
    for (const body of ["<html><body>Not Found</body></html>", "", "x".repeat(30_000)]) {
      const plain = fakeFetch(() => json(body, 404));
      await assert.rejects(jsearch.fetch(SPEC, plain.fetchImpl), (error: unknown) => error instanceof SourceError && error.message === "JSearch returned 404 (not found).");
    }
  });

  test("missing key: not configured, and fetch refuses without calling out", async () => {
    assert.equal(jsearch.configured(), false);
    const { fetchImpl, calls } = fakeFetch(() => json("{}"));
    await assert.rejects(jsearch.fetch(SPEC, fetchImpl), /JSEARCH_API_KEY/);
    assert.equal(calls.length, 0);
  });
});

describe("Adzuna", () => {
  test("builds the request and normalizes snippets, salaries and estimates", async () => {
    setEnv({ ADZUNA_APP_ID: "test-app-id", ADZUNA_APP_KEY: "test-app-key" });
    const { fetchImpl, calls } = fakeFetch(() => json(fixture("adzuna.json")));
    const { leads, requests } = await adzuna.fetch(SPEC, fetchImpl);

    assert.equal(requests, 1);
    const url = new URL(calls[0].url);
    assert.equal(`${url.origin}${url.pathname}`, "https://api.adzuna.com/v1/api/jobs/us/search/1");
    assert.equal(url.searchParams.get("app_id"), "test-app-id");
    assert.equal(url.searchParams.get("app_key"), "test-app-key");
    assert.equal(url.searchParams.get("what"), "customer success manager");
    assert.equal(url.searchParams.get("where"), "Tampa, FL");
    assert.equal(url.searchParams.get("results_per_page"), "50");
    assert.equal(url.searchParams.get("max_days_old"), "7");
    assert.equal(url.searchParams.get("content-type"), "application/json");

    assert.deepEqual(leads.map((l) => l.externalId), ["4412345678", "4412345679"]);
    const first = byId(leads, "4412345678");
    assert.equal(first.title, "Customer Success Manager", "highlight tags stripped");
    assert.equal(first.company, "Summit Benefits");
    assert.equal(first.location, "Tampa, Hillsborough County");
    assert.equal(first.description, "Join our team as a Customer Success Manager & own onboarding for employer clients. You will partner with sales…");
    assert.equal(first.salaryMin, 70000);
    assert.equal(first.salaryMax, 90000);
    assert.equal(first.salaryText, "$70k–$90k a year");
    assert.equal(first.publisher, "Adzuna");
    assert.equal(first.isRemote, false);
    assert.equal(first.postedAt?.toISOString(), "2026-09-28T09:00:00.000Z");

    const estimate = byId(leads, "4412345679");
    assert.equal(estimate.salaryText, "~$65k a year (Adzuna estimate)");
    assert.equal(estimate.isRemote, true);
  });

  test("remote-only searches add 'remote' and drop the location", async () => {
    setEnv({ ADZUNA_APP_ID: "test-app-id", ADZUNA_APP_KEY: "test-app-key" });
    const { fetchImpl, calls } = fakeFetch(() => json('{"results":[]}'));
    await adzuna.fetch({ ...SPEC, remoteOnly: true }, fetchImpl);
    const url = new URL(calls[0].url);
    assert.equal(url.searchParams.get("what"), "customer success manager remote");
    assert.equal(url.searchParams.has("where"), false);
    // A location of just "Remote" means the same thing.
    await adzuna.fetch({ ...SPEC, location: "Remote" }, fetchImpl);
    const second = new URL(calls[1].url);
    assert.equal(second.searchParams.get("what"), "customer success manager remote");
    assert.equal(second.searchParams.has("where"), false);
  });

  test("missing env var and bad key errors", async () => {
    setEnv({ ADZUNA_APP_ID: "test-app-id" });
    assert.equal(adzuna.configured(), false);
    await assert.rejects(adzuna.fetch(SPEC, fakeFetch(() => json("{}")).fetchImpl), /ADZUNA_APP_KEY/);
    setEnv({ ADZUNA_APP_ID: "test-app-id", ADZUNA_APP_KEY: "test-app-key" });
    await assert.rejects(adzuna.fetch(SPEC, fakeFetch(() => json("{}", 401)).fetchImpl), (error: Error) => {
      assert.equal(error.message, "Adzuna returned 401 (check the API key).");
      assert.doesNotMatch(error.message, /test-app-key/);
      return true;
    });
  });
});

describe("USAJOBS", () => {
  const ENV = { USAJOBS_API_KEY: "test-usajobs-key", USAJOBS_EMAIL: "owner@example.com" };

  test("builds the request with the documented headers and normalizes announcements", async () => {
    setEnv(ENV);
    assert.equal(usajobs.configured(), true);
    const { fetchImpl, calls } = fakeFetch(() => json(fixture("usajobs.json")));
    const { leads, requests } = await usajobs.fetch(SPEC, fetchImpl);

    assert.equal(requests, 1);
    const url = new URL(calls[0].url);
    assert.equal(`${url.origin}${url.pathname}`, "https://data.usajobs.gov/api/search");
    assert.equal(url.searchParams.get("Keyword"), "customer success manager");
    assert.equal(url.searchParams.get("LocationName"), "Tampa, Florida");
    assert.equal(url.searchParams.get("Radius"), "50");
    assert.equal(url.searchParams.get("DatePosted"), "7");
    assert.equal(url.searchParams.get("ResultsPerPage"), "50");
    assert.equal(url.searchParams.get("SortField"), "opendate");
    assert.equal(url.searchParams.get("SortDirection"), "desc");
    assert.equal(url.searchParams.has("RemoteIndicator"), false);
    assert.equal(calls[0].headers["authorization-key"], "test-usajobs-key");
    assert.equal(calls[0].headers["user-agent"], "owner@example.com");
    assert.equal(url.search.includes("test-usajobs-key"), false, "the key travels in a header, not the URL");

    // The month-old and untitled announcements are dropped.
    assert.deepEqual(leads.map((l) => l.externalId), ["845100001", "845100002", "845100003"]);
    const coach = byId(leads, "845100001");
    assert.equal(coach.source, "usajobs");
    assert.equal(coach.title, "Strength and Conditioning Coach");
    assert.equal(coach.company, "U.S. Special Operations Command");
    assert.equal(coach.location, "MacDill AFB, Florida");
    assert.deepEqual([coach.salaryMin, coach.salaryMax, coach.salaryText, coach.salaryProvenance], [86962, 113047, "$87k–$113k a year", "disclosed"]);
    assert.equal(coach.url, "https://www.usajobs.gov:443/job/845100001");
    assert.deepEqual(coach.applyOptions, [
      { publisher: "USAJOBS", url: "https://www.usajobs.gov:443/job/845100001", isDirect: true },
      { publisher: "USAJOBS (apply)", url: "https://www.usajobs.gov:443/job/845100001/apply", isDirect: true },
    ]);
    assert.equal(
      coach.description,
      "Deliver human performance programming for operators & support staff.\n\nDesign periodized training plans.\n\nRun athlete testing and return-to-play.\n\nCurrent CSCS certification. One year of specialized experience designing strength programs.",
    );
    assert.equal(coach.isRemote, false);
    assert.equal(coach.postedAt?.toISOString(), "2026-09-27T00:00:00.000Z");
    assert.equal(coach.publisher, "USAJOBS");

    const fitness = byId(leads, "845100002");
    assert.equal(fitness.company, "Department of the Navy", "falls back to the department");
    assert.equal(fitness.location, "San Diego, California; Coronado, California; Camp Pendleton, California (+1 more)");
    assert.deepEqual([fitness.salaryMin, fitness.salaryMax, fitness.salaryText], [50960, 62400, "$24.50–$30 an hour"]);
    assert.equal(fitness.applyOptions.length, 1, "the apply link repeats the view link");

    const remote = byId(leads, "845100003");
    assert.equal(remote.isRemote, true);
    assert.deepEqual([remote.salaryMin, remote.salaryMax, remote.salaryText, remote.salaryProvenance], [null, null, "", "unknown"], "without-compensation isn't a salary");
  });

  test("remote searches use RemoteIndicator; places and dates fit the API", async () => {
    setEnv(ENV);
    const { fetchImpl, calls } = fakeFetch(() => json('{"SearchResult":{"SearchResultItems":[]}}'));
    await usajobs.fetch({ ...SPEC, remoteOnly: true }, fetchImpl);
    await usajobs.fetch({ ...SPEC, location: "Remote", maxAgeDays: 90 }, fetchImpl);
    for (const call of calls) {
      const url = new URL(call.url);
      assert.equal(url.searchParams.get("RemoteIndicator"), "True");
      assert.equal(url.searchParams.has("LocationName"), false);
      assert.equal(url.searchParams.get("Keyword"), "customer success manager", "no 'remote' keyword");
    }
    assert.equal(new URL(calls[1].url).searchParams.get("DatePosted"), "60", "capped at the API's 60 days");
    assert.equal(usajobsLocation("San Diego, CA"), "San Diego, California");
    assert.equal(usajobsLocation("austin, tx"), "austin, Texas");
    assert.equal(usajobsLocation("Washington DC, District of Columbia"), "Washington DC, District of Columbia");
    assert.equal(usajobsLocation("Paris, ZZ"), "Paris, ZZ");
  });

  test("bi-weekly pay is annualized; other pay codes are ignored", () => {
    const body = (code: string, min: string, max: string) => ({ SearchResult: { SearchResultItems: [{ MatchedObjectId: "1", MatchedObjectDescriptor: {
      PositionTitle: "Recreation Specialist", PositionURI: "https://www.usajobs.gov/job/1", PublicationStartDate: "2026-09-28T00:00:00",
      PositionRemuneration: [{ MinimumRange: min, MaximumRange: max, RateIntervalCode: code }] } }] } });
    const [biweekly] = parseUsajobs(body("BW", "3000", "4000"), SPEC);
    assert.deepEqual([biweekly.salaryMin, biweekly.salaryMax, biweekly.salaryText], [78000, 104000, "$78k–$104k a year"]);
    const [fee] = parseUsajobs(body("FB", "100", "200"), SPEC);
    assert.deepEqual([fee.salaryMin, fee.salaryText], [null, ""]);
  });

  test("missing env vars and errors never echo the key or email", async () => {
    setEnv({ USAJOBS_API_KEY: "test-usajobs-key" });
    assert.equal(usajobs.configured(), false);
    await assert.rejects(usajobs.fetch(SPEC, fakeFetch(() => json("{}")).fetchImpl), /USAJOBS_EMAIL/);
    setEnv(ENV);
    const problem = '{"type":"https://tools.ietf.org/html/rfc9110#section-15.5.2","title":"Unauthorized","status":401}';
    await assert.rejects(usajobs.fetch(SPEC, fakeFetch(() => json(problem, 401)).fetchImpl), (error: Error) => {
      assert.equal(error.message, "USAJOBS returned 401 (check the API key).");
      assert.equal((error as SourceError).requests, 1);
      return true;
    });
    await assert.rejects(usajobs.fetch(SPEC, fakeFetch(() => new Response("<html>", { status: 200 })).fetchImpl), /USAJOBS sent a response that isn't valid JSON/);
  });
});

describe("Himalayas", () => {
  test("search endpoint: keeps matching, recent jobs", async () => {
    assert.equal(himalayas.configured(), true);
    const { fetchImpl, calls } = fakeFetch(() => json(fixture("himalayas.json")));
    const { leads, requests } = await himalayas.fetch(SPEC, fetchImpl);
    assert.equal(requests, 1);
    const url = new URL(calls[0].url);
    assert.equal(`${url.origin}${url.pathname}`, "https://himalayas.app/jobs/api/search");
    assert.equal(url.searchParams.get("q"), "customer success manager");
    assert.equal(url.searchParams.get("sort"), "recent");

    // The engineer doesn't match the search; the Oldco posting is too old.
    assert.deepEqual(leads.map((l) => l.company), ["Lumen Wellness", "Eurohealth"]);
    const lumen = leads[0];
    assert.equal(lumen.externalId, "https://himalayas.app/companies/lumen-wellness/jobs/customer-success-manager");
    assert.equal(lumen.location, "Remote (United States, Canada)");
    assert.equal(lumen.isRemote, true);
    assert.equal(lumen.salaryMin, 80000);
    assert.equal(lumen.salaryText, "$80k–$100k a year");
    assert.equal(lumen.postedAt?.toISOString(), "2026-09-28T12:00:00.000Z");
    assert.equal(lumen.description, "About the role\n\nYou’ll guide employers through onboarding & renewals.\n\n- Run QBRs\n- Drive adoption");

    const euro = leads[1];
    assert.equal(euro.salaryMin, null, "non-USD pay isn't compared");
    assert.equal(euro.salaryText, "€60k–€70k a year");
    assert.equal(euro.location, "Remote (Germany)");
    assert.equal(euro.description, "Lead a small CS team in Europe.", "falls back to the excerpt");
  });

  test("falls back to the latest-jobs feed when search fails", async () => {
    const { fetchImpl, calls } = fakeFetch((url) => (url.includes("/search") ? json("{}", 404) : json(fixture("himalayas-latest.json"))));
    const { leads, requests } = await himalayas.fetch(SPEC, fetchImpl);
    assert.equal(requests, 2);
    assert.equal(calls[1].url, "https://himalayas.app/jobs/api?limit=20");
    assert.deepEqual(leads.map((l) => l.title), ["Customer Success Manager (EMEA)"]);
  });

  test("both endpoints failing is an error that counts both requests", async () => {
    const { fetchImpl } = fakeFetch(() => json("{}", 503));
    await assert.rejects(himalayas.fetch(SPEC, fetchImpl), (error: unknown) => {
      assert.ok(error instanceof SourceError);
      assert.equal(error.requests, 2);
      assert.match(error.message, /Himalayas returned 503/);
      return true;
    });
  });
});

describe("Remotive", () => {
  test("normalizes jobs, strips HTML, parses dollar salaries", async () => {
    const { fetchImpl, calls } = fakeFetch(() => json(fixture("remotive.json")));
    const { leads, requests } = await remotive.fetch(SPEC, fetchImpl);
    assert.equal(requests, 1);
    const url = new URL(calls[0].url);
    assert.equal(`${url.origin}${url.pathname}`, "https://remotive.com/api/remote-jobs");
    assert.equal(url.searchParams.get("search"), "customer success manager");
    assert.equal(url.searchParams.get("limit"), "50");

    assert.deepEqual(leads.map((l) => l.externalId), ["1934567", "1934568"]);
    const harbor = leads[0];
    assert.equal(harbor.company, "Harbor HR");
    assert.equal(harbor.location, "Remote (USA Only)");
    assert.equal(harbor.salaryMin, 70000);
    assert.equal(harbor.salaryMax, 90000);
    assert.equal(harbor.salaryText, "$70k - $90k");
    assert.equal(harbor.postedAt?.toISOString(), "2026-09-28T10:15:00.000Z", "zone-less dates are UTC");
    assert.equal(harbor.description, "Harbor HR builds benefits software for small employers.\n\nYou will:\n\n- Onboard new accounts\n- Reduce churn & grow expansion\n\n✔ Fully remote");
    assert.equal(leads[1].salaryMin, null);
    assert.equal(leads[1].salaryText, "€50,000 - €60,000");
  });

  test("server errors are reported by name", async () => {
    await assert.rejects(remotive.fetch(SPEC, fakeFetch(() => json("oops", 500)).fetchImpl), /Remotive returned 500 \(server error\)/);
  });
});

describe("We Work Remotely", () => {
  test("parses the RSS feed and keeps matching recent items", async () => {
    const { fetchImpl, calls } = fakeFetch(() => new Response(fixture("wwr.rss"), { headers: { "content-type": "application/rss+xml" } }));
    const { leads, requests } = await wwr.fetch(SPEC, fetchImpl);
    assert.equal(requests, 1);
    assert.equal(calls[0].url, "https://weworkremotely.com/categories/remote-customer-support-jobs.rss");

    // Support specialist doesn't match; Oldco is too old; the linkless item is skipped.
    assert.deepEqual(leads.map((l) => `${l.company} | ${l.title}`), ["Acme Health | Customer Success Manager", "Initech | Customer Success Associate"]);
    const acme = leads[0];
    assert.equal(acme.externalId, "https://weworkremotely.com/remote-jobs/acme-health-customer-success-manager");
    assert.equal(acme.location, "Remote (USA Only)");
    assert.equal(acme.isRemote, true);
    assert.equal(acme.postedAt?.toISOString(), "2026-09-28T14:05:12.000Z");
    assert.match(acme.description, /Own onboarding & renewals for employer clients\.\n\n- Run QBRs\n- Drive adoption$/);
    assert.doesNotMatch(acme.description, /<|&amp;/);

    const initech = leads[1];
    assert.equal(initech.externalId, "wwr-initech-csa");
    assert.equal(initech.description, "Help customers succeed with our payroll product.");
  });

  test("titles split on the first colon", () => {
    assert.deepEqual(splitWwrTitle("Acme: Lead: Customer Success"), { company: "Acme", title: "Lead: Customer Success" });
    assert.deepEqual(splitWwrTitle("Customer Success Manager"), { company: "", title: "Customer Success Manager" });
  });
});

describe("scoring", () => {
  const now = new Date(NOW);
  const context: ScoreContext = {
    query: "customer success manager",
    targetLocations: ["Tampa, FL"],
    remoteOk: true,
    compMin: 80000,
    targetRoles: ["customer_success", "implementation", "account_management", "employer_wellbeing"],
  };
  const lead = (overrides: Partial<NormalizedLead>): NormalizedLead => ({
    source: "jsearch",
    externalId: "x",
    title: "Customer Success Manager",
    company: "Acme",
    location: "Remote",
    isRemote: true,
    salaryMin: 90000,
    salaryMax: 110000,
    salaryText: "",
    publisher: "LinkedIn",
    url: "https://example.com/job",
    applyOptions: [],
    description: "",
    postedAt: new Date(NOW - 86_400_000),
    ...overrides,
  });
  const total = (result: { reasons: Array<{ points: number }> }) => result.reasons.reduce((sum, r) => sum + r.points, 0);
  const points = (result: { reasons: Array<{ label: string; points: number }> }, label: RegExp) => result.reasons.find((r) => label.test(r.label))?.points;

  test("a perfect match scores 100 and the reasons add up", () => {
    const result = scoreLead(lead({}), context, now);
    assert.equal(result.score, 100);
    assert.equal(total(result), result.score);
    assert.deepEqual(result.reasons.map((r) => r.label), ["Title matches your search", "Customer success role", "Remote", "Pay meets your minimum", "Posted 1 day ago"]);
  });

  test("location, pay and freshness each move the score", () => {
    const onsite = scoreLead(lead({ isRemote: false, location: "Tampa, FL" }), context, now);
    assert.equal(points(onsite, /^In Tampa/), 15);
    const elsewhere = scoreLead(lead({ isRemote: false, location: "Denver, CO" }), context, now);
    assert.equal(points(elsewhere, /Outside/), 0);
    const unknownPay = scoreLead(lead({ salaryMin: null, salaryMax: null }), context, now);
    assert.equal(points(unknownPay, /Pay not listed/), 5, "unknown pay is neutral");
    const lowPay = scoreLead(lead({ salaryMin: 50000, salaryMax: 60000 }), context, now);
    assert.equal(points(lowPay, /below your minimum/), -10);
    const stale = scoreLead(lead({ postedAt: new Date(NOW - 10 * 86_400_000) }), context, now);
    assert.equal(points(stale, /Posted 10 days ago/), 5);
    const undated = scoreLead(lead({ postedAt: null }), context, now);
    assert.equal(points(undated, /date unknown/), 5);
    for (const result of [onsite, elsewhere, unknownPay, lowPay, stale, undated]) assert.equal(total(result), result.score);
  });

  test("clear mismatches lose points; the floor is 0 and still adds up", () => {
    const engineer = scoreLead(lead({ title: "Senior Software Engineer", salaryMin: 40000, salaryMax: 50000, postedAt: new Date(NOW - 30 * 86_400_000) }), context, now);
    assert.equal(points(engineer, /Engineering role/), -30);
    assert.equal(engineer.score, 0);
    assert.equal(total(engineer), 0);
    assert.ok(engineer.reasons.some((r) => r.label === "Floor at 0"));

    const director = scoreLead(lead({ title: "Director of Customer Success" }), context, now);
    assert.equal(points(director, /Director\/VP/), -20);
    assert.ok(director.score < scoreLead(lead({}), context, now).score);

    const sdr = scoreLead(lead({ title: "Sales Development Representative" }), context, now);
    assert.equal(points(sdr, /Sales development/), -25);
    for (const title of ["Delivery Driver", "Registered Nurse (RN)"]) {
      const result = scoreLead(lead({ title }), context, now);
      assert.ok(result.reasons.some((r) => r.points === -30), title);
      assert.equal(total(result), result.score);
    }
  });

  test("account manager is in the role vocabulary; account executive is not", () => {
    const am = scoreLead(lead({ title: "Account Manager" }), context, now);
    const ae = scoreLead(lead({ title: "Account Executive" }), context, now);
    assert.equal(points(am, /Account management role/), 20);
    assert.equal(points(ae, /role$/) ?? 0, -15);
    assert.ok(am.score > ae.score);
    const wellbeing = scoreLead(lead({ title: "Employee Well-being Program Manager" }), { ...context, targetRoles: ["employer_wellbeing"] }, now);
    assert.equal(points(wellbeing, /Employer wellbeing role/), 20);
  });

  test("strength & conditioning titles earn the role bonus only when it's a target path", () => {
    const sc = { ...context, query: "strength and conditioning coach", targetRoles: [...context.targetRoles, "strength_conditioning"] };
    for (const title of ["Strength & Conditioning Coach", "Assistant Strength and Conditioning Coach", "S&C Coach", "TSAC-F Facilitator", "Tactical Strength Coach", "Human Performance Specialist", "Sports Performance Coach", "Strength Coach", "Exercise Physiologist"]) {
      assert.equal(points(scoreLead(lead({ title }), sc, now), /^Strength & conditioning role$/), 20, title);
    }
    for (const title of ["Performance Marketing Manager", "Performance Manager", "Conditioning Technician", "Customer Success Manager"]) {
      assert.equal(points(scoreLead(lead({ title }), sc, now), /^Strength & conditioning role$/), undefined, title);
    }
    // The four original targets don't reward S&C titles.
    assert.equal(points(scoreLead(lead({ title: "Strength & Conditioning Coach" }), context, now), /role$/), undefined);
  });

  test("suggested searches include every selected target path, strength & conditioning too", () => {
    const roles = ["customer_success", "implementation", "account_management", "employer_wellbeing", "strength_conditioning"] as const;
    const suggestions = suggestedSearches([...roles], ["Remote", "San Diego, CA"]);
    assert.equal(suggestions.length, 5);
    assert.deepEqual(suggestions.at(-1), { name: "strength and conditioning coach", query: "strength and conditioning coach", location: "San Diego, CA", remoteOnly: false, maxAgeDays: 7 });
  });

  test("every fixture lead scores 0–100 with reasons that sum to the score", async () => {
    setEnv({ JSEARCH_API_KEY: "k", ADZUNA_APP_ID: "i", ADZUNA_APP_KEY: "k", USAJOBS_API_KEY: "k", USAJOBS_EMAIL: "e@example.com" });
    const all = [
      ...(await jsearch.fetch(SPEC, fakeFetch(() => json(fixture("jsearch.json"))).fetchImpl)).leads,
      ...(await adzuna.fetch(SPEC, fakeFetch(() => json(fixture("adzuna.json"))).fetchImpl)).leads,
      ...(await usajobs.fetch(SPEC, fakeFetch(() => json(fixture("usajobs.json"))).fetchImpl)).leads,
      ...(await himalayas.fetch(SPEC, fakeFetch(() => json(fixture("himalayas.json"))).fetchImpl)).leads,
      ...(await remotive.fetch(SPEC, fakeFetch(() => json(fixture("remotive.json"))).fetchImpl)).leads,
      ...(await wwr.fetch(SPEC, fakeFetch(() => new Response(fixture("wwr.rss"))).fetchImpl)).leads,
    ];
    assert.ok(all.length >= 10);
    for (const item of all) {
      const result = scoreLead(item, context, now);
      assert.ok(result.score >= 0 && result.score <= 100);
      assert.equal(total(result), result.score, item.title);
    }
  });
});
