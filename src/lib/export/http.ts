import { EXPORT_FORMATS, type ExportFile, type ExportFormat } from "./formats";

export { isUuid } from "./formats";

/* Response helpers for the export route handlers. */

const NO_STORE = { "Cache-Control": "private, no-store" };

export function jsonError(status: 400 | 401 | 404 | 422 | 503, error: string): Response {
  return Response.json({ error }, { status, headers: NO_STORE });
}

export const unauthorized = () => jsonError(401, "Not signed in as the owner.");
export const notFound = () => jsonError(404, "Not found.");
export const noDatabase = () => jsonError(503, "The database isn't configured.");

/**
 * `?format=` → a supported format. Missing means `fallback`; an unknown or
 * disallowed value is null (the caller answers 400).
 */
export function parseFormat(value: string | null, allowed: readonly ExportFormat[] = EXPORT_FORMATS, fallback: ExportFormat = "pdf"): ExportFormat | null {
  if (value === null || value.trim() === "") return fallback;
  const format = value.trim().toLowerCase() as ExportFormat;
  return allowed.includes(format) ? format : null;
}

/** `?inline=1` serves the file for in-browser preview instead of as a download. */
export function wantsInline(params: URLSearchParams): boolean {
  const value = params.get("inline");
  return value === "1" || value === "true";
}

export function fileResponse(file: ExportFile, options: { inline?: boolean } = {}): Response {
  const ascii = file.fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const disposition = `${options.inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`;
  return new Response(new Uint8Array(file.body), {
    status: 200,
    headers: {
      ...NO_STORE,
      "Content-Type": file.contentType,
      "Content-Disposition": disposition,
      "Content-Length": String(file.body.byteLength),
      "X-Content-Type-Options": "nosniff",
    },
  });
}
