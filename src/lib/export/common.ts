import type { ResumeDocument } from "@/lib/resume/document";
import { appTimeZone } from "@/lib/time";

/*
 * Small pieces shared by every renderer: the contact line, file names, the
 * letter date, and making text safe for the PDF's built-in Helvetica.
 */

export type Person = ResumeDocument["person"];

/** "City, ST | email | phone | link" — the same line on the resume and the letter. */
export function contactLine(person: Person): string {
  return [person.location, person.email, person.phone, ...person.links].map((part) => part.trim()).filter(Boolean).join(" | ");
}

/** Letters, digits and single hyphens only, accents folded ("José Núñez, Inc." → "Jose-Nunez-Inc"). */
export function fileNamePart(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

/** `<Full-Name>-<Company>-<Kind>.<ext>` (or any other leading parts), skipping blank ones. */
export function exportFileName(parts: string[], kind: "Resume" | "Cover-Letter" | "Posting", extension: string): string {
  const stem = [...parts.map(fileNamePart), kind].filter(Boolean).join("-");
  return `${stem}.${extension}`;
}

/** "September 29, 2026": the day it is for the owner (APP_TIME_ZONE) at that instant. */
export function letterDate(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: appTimeZone() });
}

const GREETING_WORD = /^(dear|hello|hi|hey|greetings|to whom it may concern)\b/i;
/* A sign-off line on its own: "Best regards," / "Sincerely" / "Thank you,". */
const SIGN_OFF = /^(sincerely|yours truly|best|best regards|kind regards|regards|warm regards|warmly|respectfully|thank you|thanks|cheers),?$/i;

const firstLine = (text: string) => text.split("\n")[0].trim();

/** A salutation line ("Dear Ms. Patel," / "Hi Sam"): short, and not a sentence. */
function isGreeting(line: string): boolean {
  if (line.length > 60 || !GREETING_WORD.test(line)) return false;
  return /[,:!]$/.test(line) || (line.length <= 30 && !/[.?]$/.test(line));
}

/** The letter's body as the reader sees it: a greeting and sign-off are added unless already written. */
export function letterParts(paragraphs: string[], fullName: string): { greeting: string | null; body: string[]; signOff: string[] } {
  const body = paragraphs.map((text) => text.trim()).filter(Boolean);
  const greeting = body.length && isGreeting(firstLine(body[0])) ? null : "Dear Hiring Team,";
  const hasSignOff = body.length > 1 && SIGN_OFF.test(firstLine(body.at(-1) ?? ""));
  const signOff = hasSignOff ? [] : ["Sincerely,", fullName.trim()].filter(Boolean);
  return { greeting, body, signOff };
}

/* Characters the standard PDF fonts (WinAnsi) can draw beyond Latin-1. */
const WIN_ANSI_EXTRA = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");
const REPLACEMENTS: Record<string, string> = {
  "→": "->",
  "←": "<-",
  "↔": "<->",
  "⇒": "=>",
  "≥": ">=",
  "≤": "<=",
  "≈": "~",
  "≠": "!=",
  "−": "-",
  "‐": "-",
  "‑": "-",
  "‒": "-",
  "―": "—",
  "′": "'",
  "″": '"',
  "ł": "l",
  "Ł": "L",
  "đ": "d",
  "Đ": "D",
  "ı": "i",
  "✓": "",
  "✔": "",
  "★": "*",
  "▪": "•",
  "●": "•",
  "◦": "•",
};

const drawable = (char: string) => {
  const code = char.codePointAt(0) ?? 0;
  return code === 0x0a || code === 0x09 || (code >= 0x20 && code < 0x7f) || (code >= 0xa0 && code <= 0xff) || WIN_ANSI_EXTRA.has(char);
};

/**
 * Makes text drawable with the PDF's built-in Helvetica, which only knows the
 * WinAnsi character set: common symbols get ASCII stand-ins, accents outside
 * Latin-1 are folded, and zero-width characters are dropped.
 */
export function toWinAnsi(text: string): string {
  let out = "";
  for (const char of text.normalize("NFC")) {
    if (drawable(char)) {
      out += char;
      continue;
    }
    if (char in REPLACEMENTS) {
      out += REPLACEMENTS[char];
      continue;
    }
    if (/[ -   　]/.test(char)) {
      out += " ";
      continue;
    }
    if (/[​-‍⁠﻿]/.test(char)) continue;
    const folded = char.normalize("NFKD").replace(/[̀-ͯ]/g, "");
    out += [...folded].every(drawable) ? folded : "?";
  }
  return out;
}
