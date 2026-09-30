"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, Notice } from "@/components/ui";
import { parseCapturePayload, type CapturePayload } from "@/lib/discover/bookmarklet";
import { createJobAction } from "../../jobs/actions";
import { BookmarkletLink } from "../bookmarklet-link";

type Capture = { status: "reading" } | { status: "empty"; unreadable: boolean } | { status: "ready"; payload: CapturePayload };

/**
 * Reads the posting the bookmarklet put in the URL hash (it never reaches a
 * server), clears the hash, and shows it as an editable Add-a-job form.
 */
export function CaptureForm({ ai, bookmarklet, buttonClassName }: { ai: boolean; bookmarklet: string; buttonClassName: string }) {
  const [capture, setCapture] = useState<Capture>({ status: "reading" });

  useEffect(() => {
    const hash = window.location.hash;
    if (hash.length > 1) window.history.replaceState(null, "", window.location.pathname + window.location.search);
    const payload = hash.length > 1 ? parseCapturePayload(hash) : null;
    // The hash only exists in the browser, so it can't be read during render.
    // (Strict Mode runs this twice; the second run sees the cleared hash and keeps what the first read.)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCapture((previous) => {
      if (payload) return { status: "ready", payload };
      if (hash.length > 1) return { status: "empty", unreadable: true };
      return previous.status === "reading" ? { status: "empty", unreadable: false } : previous;
    });
  }, []);

  if (capture.status === "reading") {
    return (
      <p role="status" className="rounded-lg border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground shadow-card">
        Reading the posting…
      </p>
    );
  }

  if (capture.status === "empty") {
    return (
      <div className="space-y-3">
        {capture.unreadable ? <Notice tone="warn">That link didn&apos;t carry a posting this page could read. Try the bookmark again from the job page.</Notice> : null}
        <Card title="Send a job page here with the bookmark" description="Nothing to save yet. This page fills in when you click the bookmark on a job posting.">
          <BookmarkletLink href={bookmarklet} className={buttonClassName} />
          <ol className="mt-3 list-decimal space-y-1 pl-5 text-[0.8125rem]">
            <li>Drag the button above to your bookmarks bar (show the bar with Ctrl+Shift+B, or ⌘+Shift+B on a Mac).</li>
            <li>Open a job on LinkedIn, Indeed, Glassdoor or any careers page.</li>
            <li>Click the bookmark. This page opens in a new tab with the posting filled in.</li>
          </ol>
          <p className="mt-2 text-xs text-muted-foreground">
            If it picks up the wrong text, select the job description first, then click the bookmark. You can also{" "}
            <Link href="/jobs/new" className="font-semibold text-primary hover:underline">
              paste a posting
            </Link>{" "}
            by hand.
          </p>
        </Card>
      </div>
    );
  }

  const { payload } = capture;
  const short = payload.text.length < 400;
  return (
    <ActionForm action={createJobAction} className="space-y-3">
      {ai ? null : <Notice tone="warn">Claude isn&apos;t connected, so the job will be saved without analysis. You can analyze it later.</Notice>}
      {short ? (
        <Notice tone="warn">Only a little text came through. If this isn&apos;t the whole description, select it on the job page and click the bookmark again, or paste it below.</Notice>
      ) : null}

      <Card title="Details" description="Check these; Claude fills in anything left blank and never overwrites what's here.">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="field">
            <span>Job title</span>
            <input name="title" defaultValue={payload.title} className="input" autoComplete="off" />
          </label>
          <label className="field">
            <span>Company</span>
            <input name="company" defaultValue={payload.company} className="input" autoComplete="off" />
          </label>
          <label className="field">
            <span>Location</span>
            <input name="location" defaultValue={payload.location} className="input" placeholder="e.g. Denver, CO or Remote (US)" autoComplete="off" />
          </label>
          <label className="field">
            <span>Source link</span>
            <input name="sourceUrl" type="url" inputMode="url" defaultValue={payload.url} className="input" placeholder="https://" autoComplete="off" />
          </label>
        </div>
      </Card>

      <Card title="Posting text" description={`${payload.text.length.toLocaleString("en-US")} characters from the page. Trim anything that isn't the job description.`}>
        <label className="field">
          <span className="sr-only">Posting text</span>
          <textarea name="postingText" required rows={16} defaultValue={payload.text} className="input" />
        </label>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pending={ai ? "Saving and analyzing…" : "Saving…"}>{ai ? "Save and analyze" : "Save job"}</SubmitButton>
        <Link href="/discover" className="text-[0.8125rem] font-semibold text-primary hover:underline">
          Cancel
        </Link>
        {ai ? <span className="text-xs text-muted-foreground">Analysis usually takes under a minute. You&apos;ll land on the new job.</span> : null}
      </div>
    </ActionForm>
  );
}
