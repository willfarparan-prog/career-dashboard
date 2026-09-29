/* Export formats and their content types (no renderers here, so it's cheap to import). */

export const EXPORT_FORMATS = ["pdf", "docx", "txt"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const CONTENT_TYPES: Record<ExportFormat, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain; charset=utf-8",
};

export type ExportFile = { body: Buffer; contentType: string; fileName: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ids arrive from URLs and forms; anything that isn't a UUID can't match a row (and would make Postgres throw). */
export function isUuid(value: string): boolean {
  return UUID.test(value);
}
