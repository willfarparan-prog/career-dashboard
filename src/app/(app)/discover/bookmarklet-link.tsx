"use client";

import { useState, type MouseEvent } from "react";
import { bookmarkletAnchorHtml } from "@/lib/discover/bookmarklet";

/**
 * The draggable "Save to Career Dashboard" bookmark. React refuses to render
 * `javascript:` hrefs, so the <a> arrives as HTML (server-rendered, so it is
 * draggable before hydration). Clicking it here does nothing but explain.
 */
export function BookmarkletLink({ href, label = "Save to Career Dashboard", className = "" }: { href: string; label?: string; className?: string }) {
  const [hint, setHint] = useState(false);
  function onClick(event: MouseEvent<HTMLSpanElement>) {
    if (event.target instanceof Element && event.target.closest("a")) {
      event.preventDefault();
      setHint(true);
    }
  }
  return (
    <div className="min-w-0">
      <span className="inline-block max-w-full" onClick={onClick} dangerouslySetInnerHTML={{ __html: bookmarkletAnchorHtml(href, label, className) }} />
      {hint ? (
        <p role="status" className="mt-2 text-xs text-muted-foreground">
          Drag the button to your bookmarks bar instead. It works on a job page, not here.
        </p>
      ) : null}
    </div>
  );
}
