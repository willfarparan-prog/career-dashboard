"use client";

import { useState, type ChangeEvent } from "react";
import { buttonClass } from "@/components/ui";
import { startImportAction } from "./actions";
import { StickyForm, StickySubmit, WhilePending } from "../sticky-form";

const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPT = ".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export function ImportForm({ disabled }: { disabled?: boolean }) {
  const [fileError, setFileError] = useState<string | null>(null);

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    setFileError(null);
    if (!file) return;
    const name = file.name.toLowerCase();
    if (!name.endsWith(".pdf") && !name.endsWith(".docx")) {
      setFileError("Choose a PDF or Word (.docx) file.");
      event.currentTarget.value = "";
    } else if (file.size > MAX_BYTES) {
      setFileError("That file is over 5 MB. Try a smaller export, or paste the text.");
      event.currentTarget.value = "";
    }
  }

  return (
    <StickyForm action={startImportAction} className="grid gap-4">
      <label className="field">
        <span>Paste your resume</span>
        <textarea className="input min-h-56 font-mono text-xs sm:text-sm" name="text" rows={12} placeholder={"Jordan Rivera\nHead Coach — Harbor Fitness | Mar 2019 – Present\n- Built a four-week onboarding program for new members…"} />
        <small>Plain text works best: it also lets us check every number against what you wrote.</small>
      </label>

      <div className="flex items-center gap-3 text-xs text-muted-foreground" aria-hidden>
        <span className="h-px flex-1 bg-border" />
        or
        <span className="h-px flex-1 bg-border" />
      </div>

      <label className="field">
        <span>Upload a file</span>
        <input className="input file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-2 file:py-1 file:text-sm" type="file" name="file" accept={ACCEPT} onChange={onFileChange} />
        <small>PDF or Word (.docx), up to 5 MB. If you choose a file, it&apos;s used instead of pasted text.</small>
        {fileError ? (
          <small role="alert" className="text-bad">
            {fileError}
          </small>
        ) : null}
      </label>

      <div className="flex flex-wrap items-center gap-3">
        {disabled ? (
          <button type="button" disabled className={buttonClass()}>
            Read my resume
          </button>
        ) : (
          <StickySubmit pending="Reading…">Read my resume</StickySubmit>
        )}
        <WhilePending>
          <span className="text-sm text-muted-foreground" role="status">
            Claude is reading your resume. This usually takes under a minute.
          </span>
        </WhilePending>
      </div>
    </StickyForm>
  );
}
