import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "@/db";
import { applications, jobRequirements, jobs, type RequirementKind } from "@/db/schema";
import { RESOURCES } from "@/content/learn/resources";
import type { LearningResource } from "@/content/learn/types";
import { CLOSED_STATUSES } from "@/lib/overview/dashboard";
import { findTerms, glossaryTerm } from "./terms";

/*
 * The gap roadmap: every requirement your library couldn't back up, across
 * all the jobs you're still pursuing, grouped into topics and ranked by how
 * many jobs ask for them. Topics come from the glossary where a requirement
 * names a known term or tool; otherwise the requirement's own wording is the
 * topic. Deterministic — no Claude call.
 */

export type GapJob = { id: string; company: string; title: string };

export type GapTopic = {
  id: string;
  label: string;
  /** Glossary key when the topic is a known term or tool. */
  termKey: string | null;
  /** Jobs where this is a gap, and how many of those list it as a must-have. */
  gapJobs: GapJob[];
  mustJobs: number;
  /** Jobs where you have transferable (not strong) evidence for it. */
  transferableJobs: GapJob[];
  /** Up to three requirement texts, as the postings worded them. */
  examples: string[];
  resources: LearningResource[];
};

export type GapRoadmap = { topics: GapTopic[]; jobsConsidered: number };

type Row = { jobId: string; company: string; title: string; kind: RequirementKind; text: string; label: "gap" | "transferable" };

function normalize(text: string) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildRoadmap(rows: Row[]): GapRoadmap {
  type Acc = { topic: GapTopic; gap: Map<string, GapJob>; must: Set<string>; transferable: Map<string, GapJob> };
  const topics = new Map<string, Acc>();
  const jobIds = new Set<string>();

  for (const row of rows) {
    jobIds.add(row.jobId);
    const job = { id: row.jobId, company: row.company, title: row.title };
    const keys = findTerms(row.text);
    const ids = keys.length ? keys.map((key) => `term:${key}`) : [`text:${normalize(row.text)}`];
    for (const id of ids) {
      if (id === "text:") continue;
      let acc = topics.get(id);
      if (!acc) {
        const key = id.startsWith("term:") ? id.slice(5) : null;
        acc = {
          topic: {
            id,
            label: key ? (glossaryTerm(key)?.term ?? key) : row.text.trim(),
            termKey: key,
            gapJobs: [],
            mustJobs: 0,
            transferableJobs: [],
            examples: [],
            resources: key ? RESOURCES.filter((resource) => resource.covers.includes(key)) : [],
          },
          gap: new Map(),
          must: new Set(),
          transferable: new Map(),
        };
        topics.set(id, acc);
      }
      if (row.label === "gap") {
        acc.gap.set(row.jobId, job);
        if (row.kind === "must") acc.must.add(row.jobId);
      } else {
        acc.transferable.set(row.jobId, job);
      }
      const example = row.text.trim();
      if (acc.topic.examples.length < 3 && !acc.topic.examples.includes(example)) acc.topic.examples.push(example);
    }
  }

  const list = [...topics.values()].map(({ topic, gap, must, transferable }) => ({
    ...topic,
    gapJobs: [...gap.values()],
    mustJobs: must.size,
    // A job counts once: where it's a gap, it isn't also listed as transferable.
    transferableJobs: [...transferable.values()].filter((job) => !gap.has(job.id)),
  }));
  list.sort(
    (a, b) =>
      b.gapJobs.length - a.gapJobs.length ||
      b.mustJobs - a.mustJobs ||
      b.transferableJobs.length - a.transferableJobs.length ||
      Number(Boolean(b.termKey)) - Number(Boolean(a.termKey)) ||
      a.label.localeCompare(b.label),
  );
  return { topics: list, jobsConsidered: jobIds.size };
}

/** Gaps and transferable requirements across jobs whose application isn't closed. */
export async function gapRoadmap(db: Database, userId: string): Promise<GapRoadmap> {
  const rows = await db
    .select({
      jobId: jobs.id,
      company: jobs.company,
      title: jobs.title,
      kind: jobRequirements.kind,
      text: jobRequirements.text,
      label: jobRequirements.label,
      status: applications.status,
    })
    .from(jobRequirements)
    .innerJoin(jobs, and(eq(jobs.id, jobRequirements.jobId), eq(jobs.userId, userId)))
    .leftJoin(applications, and(eq(applications.jobId, jobs.id), eq(applications.userId, userId)))
    .where(and(eq(jobRequirements.userId, userId), inArray(jobRequirements.label, ["gap", "transferable"])));
  const open = rows.filter((row) => !(row.status && CLOSED_STATUSES.includes(row.status)));
  return buildRoadmap(open.map((row) => ({ ...row, label: row.label as Row["label"] })));
}
