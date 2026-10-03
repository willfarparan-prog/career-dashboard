export type ExplorePreferences = {
  work: "desk_office_hybrid_remote";
  excludeSales: true;
  trainingMonthsExclusive: 8;
  preferShortTraining: true;
  growth: "pay_and_advancement";
  refresh: "manual";
};

export const EXPLORE_PREFERENCES: ExplorePreferences = {
  work: "desk_office_hybrid_remote", excludeSales: true, trainingMonthsExclusive: 8,
  preferShortTraining: true, growth: "pay_and_advancement", refresh: "manual",
};

export type CareerDirection = {
  title: string; query: string; terms: string[]; work: string; difference: string;
  strengths: Array<{ text: string; achievementIds: string[]; roleIds: string[] }>;
  gaps: string[]; preparation: string; trainingMonths: number | null;
  progression: string;
};

export type FitReview = {
  summary: string;
  strengths: Array<{ text: string; achievementIds: string[]; roleIds: string[]; postingQuote: string }>;
  gaps: Array<{ text: string; postingQuote: string }>;
  preparation: string;
  trainingMonths: number | null;
  workType: { assessment: "desk" | "excluded" | "unknown"; explanation: string; postingQuote: string };
  growthSignals: Array<{ text: string; postingQuote: string }>;
  careerPossibilities: string;
  unknowns: string[];
};
