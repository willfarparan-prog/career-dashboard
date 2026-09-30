import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { and, eq } from "drizzle-orm";
import type { Database } from "@/db";
import { applications, jobLeads, jobs } from "@/db/schema";
import {
  CAPTURE_TEXT_LIMIT,
  DEFAULT_APP_ORIGIN,
  bookmarkletAnchorHtml,
  buildBookmarklet,
  parseCapturePayload,
  resolveAppOrigin,
  type CapturePayload,
} from "@/lib/discover/bookmarklet";
import { dedupeKey } from "@/lib/discover/dedupe";
import { dismissLeads, LeadError, listLeads, saveLeadToPipeline, setLeadStatus } from "@/lib/discover/leads";
import type { RefreshSummary, SourceRunResult } from "@/lib/discover/types";
import { BookmarkletLink } from "@/app/(app)/discover/bookmarklet-link";
import {
  inboxHref,
  parseInboxQuery,
  placeLabel,
  previewText,
  refreshMessage,
  safeHref,
  salaryLabel,
  searchInputFromForm,
  SOURCE_LABELS,
  timeAgo,
} from "@/app/(app)/discover/format";
import { testDatabase } from "./helpers";

const ORIGIN = "https://career.example.com";

/* ---------- Bookmarklet: the URL itself ---------- */

describe("buildBookmarklet", () => {
  const href = buildBookmarklet(ORIGIN);
  const body = href.slice("javascript:".length);

  test("is a compact, URI-encoded javascript: URL", () => {
    assert.ok(href.startsWith("javascript:"));
    assert.ok(href.length < 2000, `bookmarklet is ${href.length} characters`);
    // Fully encoded: nothing a browser or HTML attribute could mangle.
    assert.doesNotMatch(body, /[\s"<>#{}|\\^`[\]]/);
    assert.equal(encodeURIComponent(decodeURIComponent(body)), body);
  });

  test("contains the origin and the capture path", () => {
    const code = decodeURIComponent(body);
    assert.ok(code.includes(JSON.stringify(ORIGIN)));
    assert.ok(code.includes("/discover/capture#"));
    assert.ok(href.includes(encodeURIComponent(ORIGIN)));
  });

  test("the embedded function body parses", () => {
    assert.doesNotThrow(() => new Function(decodeURIComponent(body)));
  });

  test("normalizes the origin and rejects non-http origins", () => {
    assert.equal(buildBookmarklet(`${ORIGIN}/some/path?x=1`), href);
    assert.equal(buildBookmarklet(`${ORIGIN}/`), href);
    assert.throws(() => buildBookmarklet("javascript:alert(1)"));
    assert.throws(() => buildBookmarklet("not a url"));
  });
});

/* ---------- Bookmarklet: running it against fake pages ---------- */

type FakePage = {
  selectors?: Record<string, string>;
  metas?: Record<string, string>;
  title?: string;
  body?: string;
  selection?: string;
  url?: string;
  popupBlocked?: boolean;
};

/** Runs the bookmarklet with a stand-in document/window/location and returns what it opened. */
function runBookmarklet(page: FakePage, origin = ORIGIN) {
  const code = decodeURIComponent(buildBookmarklet(origin).slice("javascript:".length));
  const element = (text: string) => ({ innerText: text, textContent: text });
  const selectors = page.selectors ?? {};
  const document = {
    title: page.title ?? "",
    body: element(page.body ?? ""),
    querySelector(selector: string) {
      const meta = /^meta\[property="(.+)"\]$/.exec(selector);
      if (meta) {
        const content = page.metas?.[meta[1]];
        return content === undefined ? null : { content };
      }
      for (const part of selector.split(",")) {
        if (part.trim() in selectors) return element(selectors[part.trim()]);
      }
      return null;
    },
  };
  const opened: Array<{ url: string; target: string }> = [];
  const window = {
    open(url: string, target: string) {
      opened.push({ url, target });
      return page.popupBlocked ? null : {};
    },
  };
  const location = { href: page.url ?? "https://www.linkedin.com/jobs/view/4012345678/" };
  const result = new Function("document", "window", "location", "getSelection", code)(document, window, location, () => page.selection ?? "");
  assert.equal(result, undefined, "a bookmarklet must not return a value (the page would be replaced)");
  const target = opened[0]?.url ?? location.href;
  assert.ok(target.startsWith(`${origin}/discover/capture#`), `opened ${target.slice(0, 80)}`);
  const payload = parseCapturePayload(new URL(target).hash);
  assert.ok(payload, "the capture page can read the payload");
  return { payload: payload as CapturePayload, opened, location };
}

describe("bookmarklet on a job page", () => {
  test("LinkedIn: title, company, location and description from known selectors", () => {
    const { payload, opened } = runBookmarklet({
      selectors: {
        h1: "Jobs you may be interested in",
        ".job-details-jobs-unified-top-card__job-title": "Customer Success Manager",
        ".job-details-jobs-unified-top-card__company-name": "Acme Health",
        ".job-details-jobs-unified-top-card__tertiary-description-container": "Tampa, FL · 2 days ago · 40 applicants",
        "#job-details": "About the job\n\n\n\nLead onboarding for employer clients.",
        main: "Everything on the page",
      },
      metas: { "og:site_name": "LinkedIn" },
    });
    assert.equal(opened.length, 1);
    assert.equal(opened[0].target, "_blank");
    assert.deepEqual(payload, {
      title: "Customer Success Manager",
      company: "Acme Health",
      location: "Tampa, FL",
      url: "https://www.linkedin.com/jobs/view/4012345678/",
      text: "About the job\n\nLead onboarding for employer clients.",
    });
  });

  test("Indeed: #jobDescriptionText and [data-company-name]", () => {
    const { payload } = runBookmarklet({
      url: "https://www.indeed.com/viewjob?jk=abc123",
      selectors: {
        h1: "Implementation Specialist",
        "[data-company-name]": "Globex",
        "[data-testid=job-location]": "Remote in Denver, CO",
        "#jobDescriptionText": "Implement our platform for new customers.",
      },
    });
    assert.equal(payload.title, "Implementation Specialist");
    assert.equal(payload.company, "Globex");
    assert.equal(payload.location, "Remote in Denver, CO");
    assert.equal(payload.text, "Implement our platform for new customers.");
    assert.equal(payload.url, "https://www.indeed.com/viewjob?jk=abc123");
  });

  test("Glassdoor and generic pages fall back through the selector list", () => {
    const glassdoor = runBookmarklet({
      selectors: { h1: "Account Manager", "[class*=JobDetails_jobDescription]": "Grow our accounts.", main: "Nav and more" },
    }).payload;
    assert.equal(glassdoor.text, "Grow our accounts.");

    const generic = runBookmarklet({
      url: "https://careers.example.org/jobs/42",
      title: "Careers | Example",
      metas: { "og:title": "Wellbeing Program Manager", "og:site_name": "Example Org" },
      body: "Whole page text",
    }).payload;
    assert.equal(generic.title, "Wellbeing Program Manager");
    assert.equal(generic.company, "Example Org");
    assert.equal(generic.location, "");
    assert.equal(generic.text, "Whole page text");

    const bare = runBookmarklet({ title: "Some page", body: "Only a body" }).payload;
    assert.equal(bare.title, "Some page");
    assert.equal(bare.company, "");
  });

  test("selected text wins over the page's description", () => {
    const { payload } = runBookmarklet({ selectors: { "#jobDescriptionText": "Full description" }, selection: "  Just the part I selected  " });
    assert.equal(payload.text, "Just the part I selected");
  });

  test("caps the text at 50,000 characters", () => {
    const { payload } = runBookmarklet({ title: "Long", body: "word ".repeat(15_000) });
    assert.ok(payload.text.length <= CAPTURE_TEXT_LIMIT);
    assert.ok(payload.text.length > 49_000);
  });

  test("opens in the same tab when a popup is blocked", () => {
    const { opened, location } = runBookmarklet({ title: "Blocked", body: "Text", popupBlocked: true });
    assert.equal(opened.length, 1);
    assert.ok(location.href.startsWith(`${ORIGIN}/discover/capture#`));
  });
});

/* ---------- Capture page: reading the hash ---------- */

describe("parseCapturePayload", () => {
  const encode = (value: unknown) => `#${encodeURIComponent(JSON.stringify(value))}`;

  test("reads a well-formed payload", () => {
    assert.deepEqual(parseCapturePayload(encode({ title: " CSM ", company: "Acme", location: "Remote", url: "https://x.com/j/1", text: "Do things" })), {
      title: "CSM",
      company: "Acme",
      location: "Remote",
      url: "https://x.com/j/1",
      text: "Do things",
    });
  });

  test("ignores empty, malformed or unexpected input", () => {
    for (const hash of ["", "#", null, undefined, "#not-json", "#%E0%A4%A", encode([1, 2]), encode("text"), encode(null), encode({ title: "", text: "" }), encode({ other: "x" })]) {
      assert.equal(parseCapturePayload(hash), null, String(hash));
    }
  });

  test("drops non-http links, wrong types and extra fields; caps lengths", () => {
    const payload = parseCapturePayload(encode({ title: 42, company: ["x"], url: "javascript:alert(1)", text: "x".repeat(60_000), extra: "nope" }));
    assert.ok(payload);
    assert.equal(payload.title, "");
    assert.equal(payload.company, "");
    assert.equal(payload.url, "");
    assert.equal(payload.text.length, CAPTURE_TEXT_LIMIT);
    assert.equal("extra" in payload, false);
  });

  test("accepts an already-decoded hash", () => {
    assert.equal(parseCapturePayload(`#${JSON.stringify({ title: "T", text: "100% remote" })}`)?.text, "100% remote");
  });
});

describe("resolveAppOrigin", () => {
  test("prefers NEXT_PUBLIC_APP_URL, then the request host, then production", () => {
    assert.equal(resolveAppOrigin({ envUrl: "https://app.example.com/", host: "other.vercel.app" }), "https://app.example.com");
    assert.equal(resolveAppOrigin({ envUrl: "", host: "career-git-x.vercel.app", proto: "https" }), "https://career-git-x.vercel.app");
    assert.equal(resolveAppOrigin({ host: "localhost:3000" }), "http://localhost:3000");
    assert.equal(resolveAppOrigin({ host: "example.com", proto: "http,https" }), "http://example.com");
    assert.equal(resolveAppOrigin({ envUrl: "garbage", host: "bad host/<script>" }), DEFAULT_APP_ORIGIN);
    assert.equal(resolveAppOrigin({}), DEFAULT_APP_ORIGIN);
  });
});

describe("the draggable link", () => {
  const href = buildBookmarklet(ORIGIN);

  test("anchor HTML keeps the javascript: href and escapes attributes", () => {
    const html = bookmarkletAnchorHtml(href, "Save <to> & go", 'btn "x"');
    assert.ok(html.startsWith(`<a href="${href}"`));
    assert.ok(html.includes('class="btn &quot;x&quot;"'));
    assert.ok(html.includes(">Save &lt;to&gt; &amp; go</a>"));
    assert.throws(() => bookmarkletAnchorHtml("https://example.com", "x"));
  });

  test("the rendered component puts a javascript: href in the DOM (React doesn't rewrite it)", () => {
    const markup = renderToStaticMarkup(createElement(BookmarkletLink, { href, className: "btn" }));
    assert.ok(markup.includes(`href="${href}"`), markup.slice(0, 200));
    assert.doesNotMatch(markup, /React has blocked/);
  });
});

/* ---------- Discover page helpers ---------- */

describe("inbox filters", () => {
  const SEARCH_ID = "3f2b8c1e-8a4d-4f5e-9c1a-2b3c4d5e6f70";

  test("parse with safe defaults", () => {
    assert.deepEqual(parseInboxQuery({}), { status: "new", source: null, searchId: null, good: false });
    assert.deepEqual(parseInboxQuery({ status: "saved", source: "adzuna", search: SEARCH_ID, good: "1" }), { status: "saved", source: "adzuna", searchId: SEARCH_ID, good: true });
    assert.deepEqual(parseInboxQuery({ status: "bogus", source: "monster", search: "1; drop table", good: "0" }), { status: "new", source: null, searchId: null, good: false });
    assert.equal(parseInboxQuery({ status: ["all", "saved"] }).status, "all");
  });

  test("links keep the other filters and leave defaults out", () => {
    const query = parseInboxQuery({ source: "remotive", good: "1" });
    assert.equal(inboxHref(query), "/discover?source=remotive&good=1");
    assert.equal(inboxHref(query, { status: "dismissed" }), "/discover?status=dismissed&source=remotive&good=1");
    assert.equal(inboxHref(query, { source: null, good: false }), "/discover");
    assert.equal(inboxHref(parseInboxQuery({}), { searchId: SEARCH_ID }), `/discover?search=${SEARCH_ID}`);
  });
});

test("searchInputFromForm reads the saved-search form", () => {
  const form = new FormData();
  form.set("name", "  ");
  form.set("query", " customer success ");
  form.set("location", "Tampa, FL");
  form.set("remoteOnly", "on");
  form.append("sources", "jsearch");
  form.append("sources", "remotive");
  form.set("maxAgeDays", "14");
  assert.deepEqual(searchInputFromForm(form), { name: "", query: "customer success", location: "Tampa, FL", remoteOnly: true, sources: ["jsearch", "remotive"], maxAgeDays: 14 });

  const empty = searchInputFromForm(new FormData());
  assert.deepEqual(empty, { name: "", query: "", location: "", remoteOnly: false, sources: [], maxAgeDays: 7 });
});

test("timeAgo reads naturally", () => {
  const now = new Date("2026-09-29T12:00:00Z");
  assert.equal(timeAgo(null, now), "");
  assert.equal(timeAgo(new Date("2026-09-29T11:59:30Z"), now), "just now");
  assert.equal(timeAgo(new Date("2026-09-29T11:59:00Z"), now), "1 minute ago");
  assert.equal(timeAgo(new Date("2026-09-29T09:00:00Z"), now), "3 hours ago");
  assert.equal(timeAgo(new Date("2026-09-28T09:00:00Z"), now), "yesterday");
  assert.equal(timeAgo("2026-09-27T12:00:00Z", now), "2 days ago");
  assert.equal(timeAgo(new Date("2026-07-25T12:00:00Z"), now), "2 months ago");
  assert.equal(timeAgo(new Date("2024-09-01T12:00:00Z"), now), "2 years ago");
  assert.equal(timeAgo(new Date("2026-10-01T12:00:00Z"), now), "just now");
});

test("display helpers", () => {
  assert.equal(safeHref("https://x.com/a"), "https://x.com/a");
  assert.equal(safeHref("javascript:alert(1)"), null);
  assert.equal(safeHref(""), null);

  assert.equal(salaryLabel({ salaryText: " $90k ", salaryMin: 1, salaryMax: 2 }), "$90k");
  assert.equal(salaryLabel({ salaryText: "", salaryMin: 80000, salaryMax: 95000 }), "$80,000–$95,000");
  assert.equal(salaryLabel({ salaryText: "", salaryMin: null, salaryMax: 95000 }), "$95,000");
  assert.equal(salaryLabel({ salaryText: "", salaryMin: null, salaryMax: null }), "");

  assert.equal(placeLabel({ location: "", isRemote: true }), "Remote");
  assert.equal(placeLabel({ location: "Remote (US)", isRemote: true }), "Remote (US)");
  assert.equal(placeLabel({ location: "Tampa, FL", isRemote: true }), "Tampa, FL · Remote");
  assert.equal(placeLabel({ location: "Tampa, FL", isRemote: false }), "Tampa, FL");

  assert.deepEqual(previewText("Short\n\n\n\ntext"), { text: "Short\n\ntext", truncated: false });
  const long = previewText("word ".repeat(300), 600);
  assert.equal(long.truncated, true);
  assert.ok(long.text.length <= 601 && long.text.endsWith("word…"));
});

describe("refreshMessage", () => {
  const run = (partial: Partial<SourceRunResult>): SourceRunResult => ({ source: "jsearch", searchId: "s1", status: "ok", found: 0, added: 0, requests: 1, message: "", ...partial });
  const label = (id: keyof typeof SOURCE_LABELS) => SOURCE_LABELS[id];

  test("sums up and names skipped or failed sources once", () => {
    const summary: RefreshSummary = {
      found: 23,
      added: 7,
      runs: [
        run({ found: 20, added: 5 }),
        run({ source: "adzuna", status: "skipped", message: "Not set up: add ADZUNA_APP_ID and ADZUNA_APP_KEY to the environment.", requests: 0 }),
        run({ source: "adzuna", searchId: "s2", status: "skipped", message: "Not set up: add ADZUNA_APP_ID and ADZUNA_APP_KEY to the environment.", requests: 0 }),
        run({ source: "remotive", status: "error", message: "HTTP 500" }),
        run({ source: "wwr", found: 3, added: 2 }),
      ],
    };
    assert.equal(refreshMessage(summary, label), "Found 23, 7 new. Skipped Adzuna: not set up. Remotive failed: HTTP 500.");
  });

  test("groups sources skipped for the same reason", () => {
    const reason = "Remote-only board, and neither this search nor your profile is open to remote work.";
    const summary: RefreshSummary = {
      found: 4,
      added: 1,
      runs: [run({ found: 4, added: 1 }), ...(["himalayas", "remotive", "wwr"] as const).map((source) => run({ source, status: "skipped", message: reason, requests: 0 }))],
    };
    assert.equal(
      refreshMessage(summary, label),
      "Found 4, 1 new. Skipped Himalayas, Remotive and We Work Remotely: remote-only board, and neither this search nor your profile is open to remote work.",
    );
  });

  test("names a failing source once and keeps its capitalization", () => {
    const summary: RefreshSummary = {
      found: 0,
      added: 0,
      runs: [run({ source: "wwr", status: "error", message: "We Work Remotely returned 403 (the site refused the request)." })],
    };
    assert.equal(refreshMessage(summary, label), "Found 0, 0 new. We Work Remotely failed: returned 403 (the site refused the request).");
  });

  test("keeps acronyms and explains when nothing ran", () => {
    assert.equal(
      refreshMessage({ found: 0, added: 0, runs: [run({ status: "skipped", message: "JSEARCH_API_KEY is missing" })] }, label),
      "Found 0, 0 new. Skipped JSearch (Google Jobs): JSEARCH_API_KEY is missing.",
    );
    assert.match(refreshMessage({ found: 0, added: 0, runs: [] }, label), /^Nothing ran/);
  });
});

/* ---------- Save to pipeline (the flow behind saveLeadAction) ---------- */

describe("saving a lead to the pipeline", () => {
  let db: Database;
  let close: () => Promise<void>;
  before(async () => ({ db, close } = await testDatabase()));
  after(async () => close());

  const USER = "discover-ui-user";

  async function insertLead(userId: string, externalId: string, values: Partial<typeof jobLeads.$inferInsert> = {}) {
    const title = values.title ?? "Customer Success Manager";
    const company = values.company ?? "Acme Health";
    const [lead] = await db
      .insert(jobLeads)
      .values({
        userId,
        source: "remotive",
        externalId,
        dedupeKey: dedupeKey(company, title),
        title,
        company,
        location: "",
        isRemote: true,
        salaryText: "$85,000–$100,000",
        publisher: "Remotive",
        url: "https://remotive.com/remote-jobs/customer-success/123",
        description: "Lead onboarding for employer clients.",
        score: 72,
        scoreReasons: [{ label: "Title matches a target role", points: 40 }],
        ...values,
      })
      .returning();
    return lead;
  }

  test("creates a job and a saved application, marks the lead saved; saving again returns the same job", async () => {
    const lead = await insertLead(USER, "r-1");
    const jobId = await saveLeadToPipeline(db, USER, lead.id);

    const [job] = await db.select().from(jobs).where(and(eq(jobs.id, jobId), eq(jobs.userId, USER)));
    assert.equal(job.title, "Customer Success Manager");
    assert.equal(job.company, "Acme Health");
    assert.equal(job.location, "Remote");
    assert.equal(job.sourceUrl, "https://remotive.com/remote-jobs/customer-success/123");
    assert.match(job.postingText, /Lead onboarding for employer clients\./);
    assert.match(job.postingText, /Original posting \(Remotive\): https:\/\/remotive\.com/);

    const apps = await db.select().from(applications).where(eq(applications.jobId, jobId));
    assert.equal(apps.length, 1);
    assert.equal(apps[0].status, "saved");

    const [stored] = await db.select().from(jobLeads).where(eq(jobLeads.id, lead.id));
    assert.equal(stored.status, "saved");
    assert.equal(stored.jobId, jobId);

    assert.equal(await saveLeadToPipeline(db, USER, lead.id), jobId);
    const all = await db.select().from(jobs).where(eq(jobs.userId, USER));
    assert.equal(all.length, 1);

    const saved = await listLeads(db, USER, { status: "saved" });
    assert.equal(saved.length, 1);
    assert.equal(saved[0].inPipeline, true);
  });

  test("another user's lead can't be saved, dismissed or restored", async () => {
    const lead = await insertLead("someone-else", "r-2");
    await assert.rejects(saveLeadToPipeline(db, USER, lead.id), LeadError);
    await assert.rejects(setLeadStatus(db, USER, lead.id, "dismissed"), LeadError);
    await dismissLeads(db, USER, [lead.id]);
    const [stored] = await db.select().from(jobLeads).where(eq(jobLeads.id, lead.id));
    assert.equal(stored.status, "new");
  });

  test("dismiss all shown touches only new leads; a same-title lead shows as already in the pipeline", async () => {
    const twin = await insertLead(USER, "r-3", { source: "wwr", publisher: "We Work Remotely", url: "https://weworkremotely.com/jobs/9" });
    const other = await insertLead(USER, "r-4", { title: "Implementation Specialist", company: "Globex", score: 30 });

    const fresh = await listLeads(db, USER);
    assert.deepEqual(fresh.map((l) => l.id), [twin.id, other.id]);
    assert.equal(fresh.find((l) => l.id === twin.id)?.inPipeline, true);
    assert.equal(fresh.find((l) => l.id === other.id)?.inPipeline, false);
    assert.deepEqual((await listLeads(db, USER, { minScore: 50 })).map((l) => l.id), [twin.id]);

    const [savedLead] = await listLeads(db, USER, { status: "saved" });
    await dismissLeads(db, USER, [twin.id, other.id, savedLead.id]);
    assert.equal((await listLeads(db, USER, { status: "dismissed" })).length, 2);
    assert.equal((await listLeads(db, USER, { status: "saved" })).length, 1);
    await assert.rejects(setLeadStatus(db, USER, savedLead.id, "dismissed"), LeadError);

    await setLeadStatus(db, USER, other.id, "new");
    assert.deepEqual((await listLeads(db, USER)).map((l) => l.id), [other.id]);
  });
});
