import type { CareerPath } from "@/db/schema";

/*
 * Curated learning content: written once, reviewed, and shipped with the
 * code. Nothing here is generated at runtime, so it costs nothing to load and
 * reads the same every time. Terms are referenced by glossary key; the content
 * test checks every reference resolves.
 */

/** Target paths that have a field guide ("other" doesn't). */
export type GuidePath = Exclude<CareerPath, "other">;

export type GlossaryTerm = {
  key: string;
  term: string;
  /** Other spellings matched in postings (whole words, any case). */
  aliases: string[];
  definition: string;
  paths: GuidePath[];
  example?: string;
};

export type GuideStage = {
  name: string;
  what: string;
  artifacts: string[];
  /** What the same job looked like in coaching. */
  coachingAnalog: string;
  terms: string[];
};

export type GuideMetric = { term: string; whyItMatters: string };

export type GuideTool = { name: string; category: string; note: string };

export type InterviewRound = { name: string; what: string; tip: string };

export type SwitcherConcern = { concern: string; answer: string };

export type Translation = { coaching: string; business: string };

export const GUIDE_SECTIONS = ["day", "workflow", "metrics", "tools", "interviews", "switcher", "translation"] as const;
export type GuideSection = (typeof GUIDE_SECTIONS)[number];

export const GUIDE_SECTION_LABELS: Record<GuideSection, string> = {
  day: "A day in the job",
  workflow: "The workflow",
  metrics: "Metrics you'll be judged on",
  tools: "Tools you'll see in postings",
  interviews: "How the interviews run",
  switcher: "What they'll worry about, and your answer",
  translation: "Coaching, in their words",
};

export type FieldGuide = {
  path: GuidePath;
  title: string;
  oneLiner: string;
  /** "full" guides got the deepest research; "brief" covers the essentials. */
  depth: "full" | "brief";
  dayInTheLife: string[];
  workflow: GuideStage[];
  metrics: GuideMetric[];
  tools: GuideTool[];
  interviewLoop: InterviewRound[];
  switcherConcerns: SwitcherConcern[];
  translation: Translation[];
  /** Concrete things to do this week. */
  firstSteps: string[];
};

export type LearningResource = {
  key: string;
  title: string;
  provider: string;
  url: string;
  /** As stated by the provider when checked; never a guessed price. */
  cost: string;
  /** Rough effort, or "" when the provider doesn't say. */
  effort: string;
  paths: GuidePath[];
  /** Glossary keys and tool names this resource helps close. */
  covers: string[];
  certificate: boolean;
  why: string;
};
