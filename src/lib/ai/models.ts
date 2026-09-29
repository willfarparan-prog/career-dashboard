/** Default model. Override with CLAUDE_MODEL (e.g. claude-sonnet-5-5 costs about half). */
export const DEFAULT_MODEL = "claude-opus-5-5";

type Price = { input: number; output: number; cacheRead: number };

/** USD per million tokens (Anthropic first-party rates). Cache writes bill at 1.25x input. */
const PRICES: Record<string, Price> = {
  "claude-fable-5-1": { input: 10, output: 50, cacheRead: 0.25 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1 },
};

/** Models that accept server-side refusal fallbacks and the `effort` setting. */
const CURRENT_GENERATION = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);

export function configuredModel(): string {
  return process.env.CLAUDE_MODEL?.trim() || DEFAULT_MODEL;
}

export function supportsFallbacks(model: string) {
  return CURRENT_GENERATION.has(model);
}

export function supportsEffort(model: string) {
  return !model.startsWith("claude-haiku");
}

export type Usage = { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };

/** Estimated cost in USD. Unknown models are priced like the default so the budget still applies. */
export function estimateCost(model: string, usage: Usage): number {
  const price = PRICES[model] ?? PRICES[DEFAULT_MODEL];
  const perToken = (rate: number) => rate / 1_000_000;
  return (
    usage.inputTokens * perToken(price.input) +
    usage.cacheWriteTokens * perToken(price.input * 1.25) +
    usage.cacheReadTokens * perToken(price.cacheRead) +
    usage.outputTokens * perToken(price.output)
  );
}

export function dailyBudgetUsd(): number {
  const value = Number(process.env.AI_DAILY_BUDGET_USD);
  return Number.isFinite(value) && value > 0 ? value : 5;
}
