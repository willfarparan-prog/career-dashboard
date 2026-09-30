/*
 * "Save to Career Dashboard": a bookmarklet the owner clicks on a job page
 * they already have open (LinkedIn, Indeed, Glassdoor, any careers site).
 * It reads that one page in the owner's own browser and opens
 * /discover/capture with the posting in the URL hash. The hash never leaves
 * the browser (it isn't sent to any server), and the app never fetches the
 * job site itself.
 */

export const DEFAULT_APP_ORIGIN = "https://career-dashboard-murex.vercel.app";

/** What the bookmarklet sends to /discover/capture. */
export type CapturePayload = {
  title: string;
  company: string;
  location: string;
  /** The page the posting was captured from (http/https only). */
  url: string;
  /** Selected text, or the page's job description. */
  text: string;
};

export const CAPTURE_TEXT_LIMIT = 50_000;

/*
 * The script, written compactly because the whole bookmark must stay well
 * under 2,000 characters once URI-encoded. `__ORIGIN__` becomes a JSON string.
 *
 * g(s): trimmed text of the first element matching s (or "").
 * f(list): the first non-empty g() in priority order.
 * m(p): a <meta property=p> value.
 */
const SCRIPT = [
  "(function(){",
  "var d=document,",
  "g=function(s){try{var e=d.querySelector(s);return e?(e.innerText||e.textContent||'').trim():''}catch(x){return''}},",
  "f=function(a){for(var i=0;i<a.length;i++){var t=g(a[i]);if(t)return t}return''},",
  "m=function(p){var e=d.querySelector('meta[property=\"'+p+'\"]');return e&&e.content?e.content.trim():''},",
  "s=String(getSelection()||'').trim(),",
  "p={",
  "title:(f(['.job-details-jobs-unified-top-card__job-title','h1'])||m('og:title')||d.title||'').slice(0,300),",
  "company:(f(['.job-details-jobs-unified-top-card__company-name','[data-company-name]'])||m('og:site_name')).slice(0,200),",
  "location:f(['.job-details-jobs-unified-top-card__tertiary-description-container','[data-testid=inlineHeader-companyLocation]','[data-testid=job-location]','[data-test=location]']).split('\\u00b7')[0].trim().slice(0,200),",
  "url:location.href,",
  "text:(s||f(['.jobs-description__content,.jobs-box__html-content,#job-details','#jobDescriptionText','[class*=JobDetails_jobDescription]','[itemprop=description]','main','article'])||d.body.innerText||'').slice(0,5e4)",
  "},",
  "u=__ORIGIN__+'/discover/capture#'+encodeURIComponent(JSON.stringify(p));",
  "window.open(u,'_blank')||(location.href=u)",
  "})()",
].join("");

/** "https://host[:port]" from any http(s) URL; throws on anything else. */
export function normalizeOrigin(value: string): string {
  const url = new URL(value.trim());
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("The app origin must be an http(s) URL.");
  return url.origin;
}

/** The bookmarklet's `javascript:` URL, pointing captures at `appOrigin`. */
export function buildBookmarklet(appOrigin: string): string {
  const code = SCRIPT.replace("__ORIGIN__", JSON.stringify(normalizeOrigin(appOrigin)));
  return `javascript:${encodeURIComponent(code)}`;
}

/**
 * Where captures should go: NEXT_PUBLIC_APP_URL when set, else the host the
 * page was requested on, else the production URL.
 */
export function resolveAppOrigin({ envUrl, host, proto }: { envUrl?: string | null; host?: string | null; proto?: string | null }): string {
  if (envUrl) {
    try {
      return normalizeOrigin(envUrl);
    } catch {
      // fall through to the request host
    }
  }
  const cleanHost = (host ?? "").split(",")[0].trim();
  if (cleanHost && /^[a-z0-9.-]+(:\d{1,5})?$/i.test(cleanHost)) {
    const local = /^(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?$/i.test(cleanHost);
    const forwarded = (proto ?? "").split(",")[0].trim().toLowerCase();
    const scheme = forwarded === "http" || forwarded === "https" ? forwarded : local ? "http" : "https";
    try {
      return normalizeOrigin(`${scheme}://${cleanHost}`);
    } catch {
      // fall through to the default
    }
  }
  return DEFAULT_APP_ORIGIN;
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * The draggable link as raw HTML. React blocks `javascript:` hrefs, so the
 * page injects this string instead of rendering an <a href> element.
 */
export function bookmarkletAnchorHtml(href: string, label: string, className = ""): string {
  if (!href.startsWith("javascript:")) throw new Error("Not a bookmarklet URL.");
  const cls = className ? ` class="${escapeAttribute(className)}"` : "";
  return `<a href="${escapeAttribute(href)}"${cls} draggable="true" title="Drag me to your bookmarks bar">${escapeText(label)}</a>`;
}

function text(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}

function oneLine(value: unknown, max: number): string {
  return text(value, max * 2).replace(/\s+/g, " ").trim().slice(0, max);
}

/**
 * Reads the capture page's `location.hash`. Anything malformed, empty or
 * unexpected returns null; unknown fields are dropped and lengths capped.
 */
export function parseCapturePayload(hash: string | null | undefined): CapturePayload | null {
  const raw = (hash ?? "").replace(/^#/, "");
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(decodeURIComponent(raw));
  } catch {
    try {
      data = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const record = data as Record<string, unknown>;
  const url = oneLine(record.url, 2000);
  const payload: CapturePayload = {
    title: oneLine(record.title, 300),
    company: oneLine(record.company, 200),
    location: oneLine(record.location, 200),
    url: /^https?:\/\/\S+$/i.test(url) ? url : "",
    text: text(record.text, CAPTURE_TEXT_LIMIT),
  };
  if (!payload.text && !payload.title) return null;
  return payload;
}
