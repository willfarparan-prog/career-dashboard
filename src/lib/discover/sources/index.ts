import type { LeadSource } from "@/db/schema";
import type { SourceAdapter } from "../types";
import { adzuna } from "./adzuna";
import { himalayas } from "./himalayas";
import { jsearch } from "./jsearch";
import { remotive } from "./remotive";
import { usajobs } from "./usajobs";
import { wwr } from "./wwr";

/** Every source Discover can search, in display order. */
export const SOURCES: SourceAdapter[] = [jsearch, adzuna, usajobs, himalayas, remotive, wwr];

export function getSource(id: LeadSource): SourceAdapter | undefined {
  return SOURCES.find((source) => source.id === id);
}
