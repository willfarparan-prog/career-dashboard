import type { LeadSource } from "@/db/schema";
import type { SourceAdapter } from "../types";

/**
 * Every source Discover can search, in display order.
 * PLACEHOLDER — the sources work fills this in (jsearch, adzuna, himalayas, remotive, wwr).
 */
export const SOURCES: SourceAdapter[] = [];

export function getSource(id: LeadSource): SourceAdapter | undefined {
  return SOURCES.find((source) => source.id === id);
}
