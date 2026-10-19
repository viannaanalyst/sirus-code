import type { AgentProviderId, ModelPrice, UsageHistoryEntry } from "@/client/types";

/**
 * The Usage page (ADR-141): totals, a per-day (or per-hour) series and a per-model breakdown
 * over a range, computed from the native history. Cost is an estimate at list prices: the
 * public price table downloaded daily (`prices`), else Anthropic's built in below; a model
 * without a known price counts as unpriced unless the provider logged its own cost.
 */
export type UsageRange = 1 | 7 | 30 | 90;
export const USAGE_RANGES: readonly UsageRange[] = [1, 7, 30, 90];
export type UsageProvider = Extract<AgentProviderId, "claude" | "codex" | "opencode">;
export const USAGE_PROVIDERS: readonly UsageProvider[] = ["claude", "codex", "opencode"];

/** USD per million tokens. */
type Price = ModelPrice;
/** Downloaded prices by model name, as the history names them. */
export type UsagePriceTable = Readonly<Record<string, ModelPrice>>;
const price = (input: number, output: number, cacheRead = input / 10): Price => ({ input, cacheRead, cacheWrite: input * 1.25, output });

/** Anthropic list prices (first-party API), used when the table has no entry; the longest matching prefix wins. */
const PRICES: readonly [prefix: string, price: Price][] = [
  ["claude-fable-5-1", price(10, 50, 0.25)],
  ["claude-fable-5", price(10, 50)],
  ["claude-mythos", price(10, 50, 0.25)],
  ["claude-opus-5-5", price(4, 20, 0.2)],
  ["claude-opus-5", price(5, 25)],
  ["claude-opus-4", price(5, 25)],
  ["claude-sonnet-5-5", price(2, 10, 0.2)],
  ["claude-sonnet-5", price(2, 10)],
  ["claude-sonnet-4", price(3, 15)],
  ["claude-haiku-5-5", price(0.1, 0.5)],
  ["claude-haiku-4", price(1, 5)],
];

export function modelPrice(model: string, prices?: UsagePriceTable): Price | null {
  const downloaded = prices?.[model];
  if (downloaded) return downloaded;
  let best: [string, Price] | null = null;
  for (const entry of PRICES) if (model.startsWith(entry[0]) && (!best || entry[0].length > best[0].length)) best = entry;
  return best?.[1] ?? null;
}

/** Estimated cost of one entry; null when the model has no known price and none was logged. */
export function entryCost(entry: UsageHistoryEntry, prices?: UsagePriceTable): number | null {
  if (entry.reportedCostUsd != null) return entry.reportedCostUsd;
  const p = modelPrice(entry.model, prices);
  if (!p) return null;
  return (entry.inputTokens * p.input + entry.cachedInputTokens * p.cacheRead + entry.cacheWriteTokens * p.cacheWrite + entry.outputTokens * p.output) / 1_000_000;
}

/** Cache savings: what cache reads would have cost as uncached input. */
function cacheSavings(entry: UsageHistoryEntry, prices?: UsagePriceTable): number {
  const p = entry.reportedCostUsd == null ? modelPrice(entry.model, prices) : null;
  return p ? entry.cachedInputTokens * (p.input - p.cacheRead) / 1_000_000 : 0;
}

export interface UsageTokens { input: number; cachedInput: number; cacheWrite: number; output: number }
const tokensOf = (entry: UsageHistoryEntry) => entry.inputTokens + entry.cachedInputTokens + entry.cacheWriteTokens + entry.outputTokens;

export interface UsageProviderTotal { provider: UsageProvider; cost: number; tokens: number; sessions: number; unpriced: boolean }
export interface UsageModelRow { provider: UsageProvider; model: string; cost: number | null; tokens: number }
export interface UsageBucket { at: number; values: Record<UsageProvider, { cost: number; tokens: number }> }
export interface UsageCostByType { input: number; cacheRead: number; cacheWrite: number; output: number; reported: number }

export interface UsageSummary {
  cost: number;
  tokens: number;
  sessions: number;
  totals: UsageTokens;
  costByType: UsageCostByType;
  cacheSavings: number;
  providers: UsageProviderTotal[];
  models: UsageModelRow[];
  buckets: UsageBucket[];
  /** Hours (24 h range) or days. */
  bucket: "hour" | "day";
  /** Some tokens came from models without a price: the cost is a lower bound. */
  partialCost: boolean;
}

const HOUR = 60 * 60 * 1000;
const emptyValues = (): UsageBucket["values"] => ({ claude: { cost: 0, tokens: 0 }, codex: { cost: 0, tokens: 0 }, opencode: { cost: 0, tokens: 0 } });

/** Local midnight of `time`. */
function dayStart(time: number): number {
  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** Bucket starts covering the range, oldest first: 24 hours, or `range` local days ending today. */
export function usageBuckets(range: UsageRange, now: number): number[] {
  if (range === 1) {
    const last = Math.floor(now / HOUR) * HOUR;
    return Array.from({ length: 24 }, (_, index) => last - (23 - index) * HOUR);
  }
  const today = dayStart(now);
  return Array.from({ length: range }, (_, index) => {
    const date = new Date(today);
    date.setDate(date.getDate() - (range - 1 - index));
    return date.getTime();
  });
}

export function summarizeUsage(entries: readonly UsageHistoryEntry[], range: UsageRange, now: number, prices?: UsagePriceTable): UsageSummary {
  const starts = usageBuckets(range, now);
  const from = starts[0];
  const bucket = range === 1 ? "hour" : "day";
  const index = new Map(starts.map((start, position) => [start, position]));
  const buckets: UsageBucket[] = starts.map(at => ({ at, values: emptyValues() }));
  const providers = new Map<UsageProvider, UsageProviderTotal & { keys: Set<string> }>();
  const models = new Map<string, UsageModelRow>();
  const totals: UsageTokens = { input: 0, cachedInput: 0, cacheWrite: 0, output: 0 };
  const costByType: UsageCostByType = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, reported: 0 };
  let cost = 0, tokens = 0, savings = 0, partialCost = false;
  for (const entry of entries) {
    if (entry.at < from || entry.at > now || !USAGE_PROVIDERS.includes(entry.provider as UsageProvider)) continue;
    const provider = entry.provider as UsageProvider;
    const amount = tokensOf(entry);
    const value = entryCost(entry, prices);
    if (value == null && amount > 0) partialCost = true;
    cost += value ?? 0;
    tokens += amount;
    savings += cacheSavings(entry, prices);
    totals.input += entry.inputTokens; totals.cachedInput += entry.cachedInputTokens; totals.cacheWrite += entry.cacheWriteTokens; totals.output += entry.outputTokens;
    const p = entry.reportedCostUsd == null ? modelPrice(entry.model, prices) : null;
    if (entry.reportedCostUsd != null) costByType.reported += entry.reportedCostUsd;
    else if (p) {
      costByType.input += entry.inputTokens * p.input / 1_000_000;
      costByType.cacheRead += entry.cachedInputTokens * p.cacheRead / 1_000_000;
      costByType.cacheWrite += entry.cacheWriteTokens * p.cacheWrite / 1_000_000;
      costByType.output += entry.outputTokens * p.output / 1_000_000;
    }
    const total = providers.get(provider) ?? { provider, cost: 0, tokens: 0, sessions: 0, unpriced: false, keys: new Set<string>() };
    total.cost += value ?? 0; total.tokens += amount; total.keys.add(entry.session);
    if (value == null && amount > 0) total.unpriced = true;
    providers.set(provider, total);
    const key = `${provider}\0${entry.model}`;
    const row = models.get(key) ?? { provider, model: entry.model, cost: null, tokens: 0 };
    row.tokens += amount;
    if (value != null) row.cost = (row.cost ?? 0) + value;
    models.set(key, row);
    const start = bucket === "hour" ? Math.floor(entry.at / HOUR) * HOUR : dayStart(entry.at);
    const position = index.get(start);
    if (position != null) { const slot = buckets[position].values[provider]; slot.cost += value ?? 0; slot.tokens += amount; }
  }
  const providerTotals = USAGE_PROVIDERS.flatMap(id => {
    const total = providers.get(id);
    return total ? [{ provider: id, cost: total.cost, tokens: total.tokens, sessions: total.keys.size, unpriced: total.unpriced }] : [];
  });
  return {
    cost, tokens, totals, costByType, cacheSavings: savings, bucket, partialCost, buckets,
    sessions: providerTotals.reduce((sum, total) => sum + total.sessions, 0),
    providers: providerTotals,
    models: [...models.values()].filter(row => row.tokens > 0),
  };
}

/** Rows ordered by cost (unpriced last, by tokens) or by tokens. */
export function sortModelRows(rows: readonly UsageModelRow[], by: "cost" | "tokens"): UsageModelRow[] {
  return [...rows].sort((a, b) => by === "tokens" ? b.tokens - a.tokens : (b.cost ?? -1) - (a.cost ?? -1) || b.tokens - a.tokens);
}

/** 1 234 → "1,23 mil"-style compact numbers in the person's locale. */
export function formatCompact(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: value >= 1000 ? 2 : 0 }).format(value);
}

export function formatUsd(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

/** Share as a percentage label: "<0.1%" below a tenth of a percent. */
export function formatShare(part: number, whole: number, locale: string): string {
  if (!whole) return "—";
  const share = (part / whole) * 100;
  return share > 0 && share < 0.1 ? `<${(0.1).toLocaleString(locale)}%` : `${share.toLocaleString(locale, { maximumFractionDigits: 1 })}%`;
}
