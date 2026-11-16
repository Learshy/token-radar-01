// Token Radar's model, radar-4: one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and adds
// pre-token protocols below the watchlist floor that could still launch a token of their own. Above
// the floor, only the watchlist's own definition decides: a protocol above the floor that the
// watchlist leaves out is a wrapped, staked or bridged product of a token that already trades (or a
// versioned pool, or an arm of another protocol), so it is set aside, not ranked. The same
// observable tests decide the early rows below the floor.
//
// Implied value follows only from the snapshot's own figures, and every input is shown per row:
//
//   size curve     = a fitted line, not a set of bands: across the snapshot's live-token peers,
//                    the log of the market-cap-to-TVL ratio falls linearly with the log of TVL,
//                    so market cap grows as TVL to a power below one (about 0.47 here). The line
//                    is fitted by least squares on the live peers' log ratios, and the dashboard
//                    prints the fitted slope and intercept, so the curve is a measurement, not a
//                    guess. A protocol ten times as big is worth about three times as much, not
//                    ten times as much, per TVL dollar.
//   category effect = how far one category sits from that size line: the median of its live
//                    peers' log residuals from the fitted line, shrunk toward no effect with
//                    weight n/(n+5), so a category with one or two peers cannot set its own price.
//                    A category with no live peers takes no effect. The effect is capped at 3x.
//   multiple       = min(1.5, size curve at the protocol's TVL x category effect)
//   growth         = clamp(change_7d, -50, 100) per cent
//   growthMult     = 1 + (growth / 100) x 1.0
//   maturity       = 0.6 + min(age_days, 1095) / 1095 x 0.4   (age_days unknown: 365)
//   chainMult      = 1 + 0.02 x (chains - 1), capped at 1.10
//   implied        = max(1, round(tvl_usd x multiple x growthMult x maturity x chainMult))
//
// The multiple is not asserted, it is tested. The model is fitted on the older half of the
// snapshot's dated live-token protocols and scored on the newer half it never saw: the dashboard
// prints the median factor error and the share predicted within 2x, for this model and for three
// simpler ones (the old three-band model, category alone, a flat global median), so a reader can
// see what the fitted curve buys. A model that is wrong by about 2.4x on average says so in its
// own methodology panel.
//
// Low band and farm verdict: the 25th percentile of the category's live-peer residuals from the
// size line, shrunk the same way toward the 25th percentile of all residuals, gives a low-band
// effect, and the same arithmetic gives a low-band value. The farm plan's gas spend is counted in
// dollars and set against that value in the verdict step, so every plan is netted to the dollar.
// The verdict reads off the low-band value: FARM at $2.5M and above, THIN at $1M, SKIP below — a
// farm earns a slice of a launch, never the whole implied value, so the call is made on the
// cautious end of the band.
//
// Rising score (a separate sort, not the value rank): clamped growth times youth,
//   rising = (growth / 100) x (0.5 + max(0, 1 - age_days / 1095)), age unknown: 0.5.
// It answers the owner's "find it EARLY" ask without corrupting the value rank.
//
// No protocol name is ever special-cased: the same function scores every row.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  shrink_prior: number;
  median_cap: number;
  multiple_cap: number;
  chain_step: number;
  chain_cap: number;
  low_band_percentile: number;
  verdict_farm_value_usd: number;
  verdict_thin_value_usd: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 1.0,
  growth_floor: -50,
  growth_cap: 100,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  shrink_prior: 5,
  median_cap: 3,
  multiple_cap: 1.5,
  chain_step: 0.02,
  chain_cap: 1.1,
  low_band_percentile: 25,
  verdict_farm_value_usd: 2_500_000,
  verdict_thin_value_usd: 1_000_000,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-4';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One category's effect on the size line, as the methodology panel shows it. */
export interface CategoryEffect {
  category: string;
  live_peers: number;
  median_residual: number | null;
  effect: number;
  low_effect: number;
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** The fitted size line: log market-cap-to-TVL against log TVL, and the curve at four TVLs. */
export interface SizeFit {
  intercept: number;
  slope: number;
  exponent: number;
  points: Array<{ tvl_usd: number; multiple: number }>;
}

/** One method in the out-of-sample check: how it did on tokens it never fitted. */
export interface OosMethod {
  name: string;
  median_ratio: number;
  median_factor_error: number;
  within_2x_pct: number;
}

/** The out-of-sample check: fitted on the older half of the dated live tokens, scored on the newer half. */
export interface OosCheck {
  cut_date: string;
  fit_n: number;
  test_n: number;
  methods: OosMethod[];
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    multiple: number;
    size_multiple: number;
    category_multiple: number;
    low_multiple: number;
    low_implied_value_usd: number;
    plan_spend_usd: number;
    verdict: 'FARM' | 'THIN' | 'SKIP';
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    chain_multiplier: number;
    rising: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  multiple: number;
  size_multiple: number;
  category_multiple: number;
  low_multiple: number;
  low_implied_value_usd: number;
  plan_spend_usd: number;
  verdict: 'FARM' | 'THIN' | 'SKIP';
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
  rising: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, the multiples and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  live_peer_count: number;
  set_aside_above_floor: number;
  set_aside_wrapped_below_floor: number;
  global_multiple: number;
  category_effects: CategoryEffect[];
  size_fit: SizeFit;
  oos: OosCheck;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The median of a non-empty list of numbers. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  return n % 2 === 1 ? sorted[(n - 1) / 2]! : (sorted[n / 2 - 1]! + sorted[n / 2]!) / 2;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/**
 * Whether a protocol is a wrapped, staked or bridged product of a token that already trades — the
 * watchlist rule's observable tests (the house also checks a parent protocol the snapshot does not
 * carry, so this is the rule as far as the snapshot can see it). Categories that are by definition
 * such products, a name carrying a whole word wrapped/staked/staking, a name starting with an
 * exchange's name, or a version marker.
 */
const WRAPPED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const EXCHANGE_NAMES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

export function isWrappedProduct(p: SnapshotProtocol): boolean {
  if (WRAPPED_CATEGORIES.has(p.category ?? '')) return true;
  if (WRAPPED_WORD.test(p.name)) return true;
  if (EXCHANGE_NAMES.some((e) => p.name.startsWith(e))) return true;
  if (VERSIONED.test(p.name)) return true;
  return false;
}

/** A whole number with comma grouping, for the verdict step's cover ratio. */
export function fmtInt(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** A dollar figure in the dashboard's own units, so the page and the board print the same number. */
export function fmtUsd(n: number): string {
  if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(1) + 'B';
  if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
  return '$' + Math.round(n);
}

/** The live-token protocols the multiples are priced from: they trade, so their market cap is a fact. */
export function livePeers(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols.filter(
    (p) => !isPreToken(p) && p.category !== 'CEX' && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0,
  );
}

/** The market multiples for one set of live peers: global median plus one shrunk value per category. */
export function categoryTable(peers: SnapshotProtocol[], model: ModelConstants): { global: number; table: Array<{ category: string; live_peers: number; median_multiple: number | null; multiple: number }> } {
  const global = peers.length > 0 ? median(peers.map((p) => p.mcap_usd! / p.tvl_usd)) : 0.25;
  const byCategory = new Map<string, number[]>();
  for (const p of peers) {
    const c = p.category ?? 'Other';
    const list = byCategory.get(c);
    if (list) list.push(p.mcap_usd! / p.tvl_usd);
    else byCategory.set(c, [p.mcap_usd! / p.tvl_usd]);
  }
  const table: Array<{ category: string; live_peers: number; median_multiple: number | null; multiple: number }> = [...byCategory.entries()]
    .map(([category, ratios]) => {
      const med = median(ratios);
      const w = ratios.length / (ratios.length + model.shrink_prior);
      const multiple = Math.min(model.multiple_cap, w * Math.min(med, model.median_cap) + (1 - w) * global);
      return { category, live_peers: ratios.length, median_multiple: round4(med), multiple: round6(multiple) };
    })
    .sort((a, b) => b.multiple - a.multiple || (a.category < b.category ? -1 : 1));
  return { global: round6(global), table };
}

/** The market multiples, derived from the snapshot's own live-token protocols. */
export function categoryMultiples(snapshot: Snapshot, model: ModelConstants = MODEL): { global: number; table: Array<{ category: string; live_peers: number; median_multiple: number | null; multiple: number }> } {
  return categoryTable(livePeers(snapshot), model);
}

/** The multiple one category gets: its shrunk table value, or the global median with no live peers. */
export function multipleFor(category: string | null, multiples: { global: number; table: Array<{ category: string; live_peers: number; median_multiple: number | null; multiple: number }> }): number {
  const row = multiples.table.find((t) => t.category === (category ?? 'Other'));
  return row === undefined ? multiples.global : row.multiple;
}

/** The size curve for one set of live peers: three TVL bands, cut at the set's own terciles. */
export function sizeCurveFor(peers: SnapshotProtocol[]): { cuts: [number, number]; multiples: [number, number, number]; counts: [number, number, number]; band_names: ['small', 'mid', 'large'] } {
  const byTvl = [...peers].sort((a, b) => a.tvl_usd - b.tvl_usd || (a.slug < b.slug ? -1 : 1));
  if (byTvl.length < 3) return { cuts: [10_000_000, 50_000_000], multiples: [0.25, 0.25, 0.25], counts: [0, 0, 0], band_names: ['small', 'mid', 'large'] };
  const cut1 = byTvl[Math.floor(byTvl.length / 3)]!.tvl_usd;
  const cut2 = byTvl[Math.floor((2 * byTvl.length) / 3)]!.tvl_usd;
  const band = (lo: number, hi: number): { multiple: number; count: number } => {
    const ratios = byTvl.filter((p) => p.tvl_usd > lo && p.tvl_usd <= hi).map((p) => p.mcap_usd! / p.tvl_usd);
    return { multiple: ratios.length > 0 ? round6(median(ratios)) : 0.25, count: ratios.length };
  };
  const small = band(0, cut1);
  const mid = band(cut1, cut2);
  const large = band(cut2, Number.POSITIVE_INFINITY);
  return {
    cuts: [cut1, cut2],
    multiples: [small.multiple, mid.multiple, large.multiple],
    counts: [small.count, mid.count, large.count],
    band_names: ['small', 'mid', 'large'],
  };
}

/** The size band's multiple for one TVL. */
export function sizeMultipleFor(tvl: number, curve: { cuts: [number, number]; multiples: [number, number, number]; counts: [number, number, number]; band_names: ['small', 'mid', 'large'] }): number {
  if (tvl <= curve.cuts[0]) return curve.multiples[0]!;
  if (tvl <= curve.cuts[1]) return curve.multiples[1]!;
  return curve.multiples[2]!;
}

/** A percentile of an ascending list: the value at rank q, straight between neighbours. */
function percentileOf(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const at = q * (sorted.length - 1);
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (at - lo);
}

/**
 * The fitted size line: least squares of log market-cap-to-TVL on log10 TVL, over the live peers.
 * The slope is the covariance over the variance, the intercept the mean log ratio minus slope times
 * mean log TVL. The exponent says how market cap itself scales with TVL: one plus the slope over
 * ln 10. The line is also sampled at four TVLs so the methodology panel can print it.
 */
export function fitSizeCurve(peers: SnapshotProtocol[]): SizeFit {
  const xs = peers.map((p) => Math.log10(p.tvl_usd));
  const ys = peers.map((p) => Math.log(p.mcap_usd! / p.tvl_usd));
  const n = xs.length;
  const sampleTvls = [5_000_000, 50_000_000, 500_000_000, 5_000_000_000];
  if (n < 2) {
    return { intercept: Math.log(0.25), slope: 0, exponent: 1, points: sampleTvls.map((tvl) => ({ tvl_usd: tvl, multiple: 0.25 })) };
  }
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let cov = 0;
  let varX = 0;
  for (let i = 0; i < n; i++) {
    cov += (xs[i]! - meanX) * (ys[i]! - meanY);
    varX += (xs[i]! - meanX) * (xs[i]! - meanX);
  }
  const slope = varX > 0 ? cov / varX : 0;
  const intercept = meanY - slope * meanX;
  const at = (tvl: number): number => Math.exp(intercept + slope * Math.log10(tvl));
  return {
    intercept: round6(intercept),
    slope: round6(slope),
    exponent: round4(1 + slope / Math.LN10),
    points: sampleTvls.map((tvl) => ({ tvl_usd: tvl, multiple: round6(at(tvl)) })),
  };
}

/** The size line's multiple at one TVL. */
export function sizeCurveAt(tvl: number, fit: SizeFit): number {
  return Math.exp(fit.intercept + fit.slope * Math.log10(tvl));
}

/** One live peer's residual from the size line, in log units. */
function residualOf(p: SnapshotProtocol, fit: SizeFit): number {
  return Math.log(p.mcap_usd! / p.tvl_usd) - (fit.intercept + fit.slope * Math.log10(p.tvl_usd));
}

/**
 * Every category's effect on the size line: the median of its live peers' residuals, shrunk toward
 * no effect with weight n/(n+5) and capped at the model's median cap. The low effect is the same
 * shrinkage applied to the 25th percentile of the category's residuals, pulled toward the 25th
 * percentile of every peer's residuals. Categories with no live peers take no effect and the
 * all-peer low effect.
 */
export function categoryEffects(peers: SnapshotProtocol[], fit: SizeFit, model: ModelConstants): { table: CategoryEffect[]; low_all: number } {
  const byCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of peers) {
    const r = residualOf(p, fit);
    all.push(r);
    const c = p.category ?? 'Other';
    const list = byCategory.get(c);
    if (list) list.push(r);
    else byCategory.set(c, [r]);
  }
  const allSorted = [...all].sort((a, b) => a - b);
  const lowAll = Math.exp(percentileOf(allSorted, model.low_band_percentile / 100));
  const table: CategoryEffect[] = [...byCategory.entries()]
    .map(([category, residuals]) => {
      const sorted = [...residuals].sort((a, b) => a - b);
      const med = median(sorted);
      const w = residuals.length / (residuals.length + model.shrink_prior);
      const effect = Math.min(model.median_cap, Math.exp(w * med));
      const low = Math.min(
        model.median_cap,
        Math.exp(w * percentileOf(sorted, model.low_band_percentile / 100) + (1 - w) * Math.log(lowAll)),
      );
      return { category, live_peers: residuals.length, median_residual: round4(med), effect: round6(effect), low_effect: round6(low) };
    })
    .sort((a, b) => b.effect - a.effect || (a.category < b.category ? -1 : 1));
  return { table, low_all: round6(lowAll) };
}

/** The effect one category gets: its table value, or no effect with no live peers. */
export function effectFor(category: string | null, table: CategoryEffect[]): number {
  const row = table.find((t) => t.category === (category ?? 'Other'));
  return row === undefined ? 1 : row.effect;
}

/** The low-band effect one category gets: its table value, or the all-peer low effect. */
export function lowEffectFor(category: string | null, table: CategoryEffect[], lowAll: number): number {
  const row = table.find((t) => t.category === (category ?? 'Other'));
  return row === undefined ? lowAll : row.low_effect;
}

/** The combined multiple: the size line at the protocol's TVL times its category effect, capped. */
export function combinedMultiple(tvl: number, category: string | null, fit: SizeFit, table: CategoryEffect[], model: ModelConstants): number {
  return round6(Math.min(model.multiple_cap, sizeCurveAt(tvl, fit) * effectFor(category, table)));
}

/** The low-band multiple: the same, with the category's low effect. */
export function lowCombinedMultiple(
  tvl: number,
  category: string | null,
  fit: SizeFit,
  table: CategoryEffect[],
  lowAll: number,
  model: ModelConstants,
): number {
  return round6(Math.min(model.multiple_cap, sizeCurveAt(tvl, fit) * lowEffectFor(category, table, lowAll)));
}

/** One out-of-sample method's score on the newer half of the dated live tokens. */
function oosScore(test: SnapshotProtocol[], predict: (p: SnapshotProtocol) => number): OosMethod {
  const ratios = test.map((p) => (p.tvl_usd * predict(p)) / p.mcap_usd!);
  const errors = ratios.map((r) => Math.abs(Math.log(r)));
  const within = ratios.filter((r) => r >= 0.5 && r <= 2).length;
  return {
    name: '',
    median_ratio: round4(median(ratios)),
    median_factor_error: round4(Math.exp(median(errors))),
    within_2x_pct: test.length > 0 ? Math.round((100 * within) / test.length) : 0,
  };
}

/**
 * The out-of-sample check: the dated live tokens split at their median listing date, the older
 * half fits the multiples, the newer half is scored without ever having been fitted. Four methods
 * run the same split, so the table shows what the fitted curve buys over the old three-band model,
 * over category alone and over a flat global median.
 */
export function oosCheck(snapshot: Snapshot, model: ModelConstants = MODEL): OosCheck {
  const dated = livePeers(snapshot)
    .filter((p) => p.listed_at !== null)
    .sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : a.listed_at! > b.listed_at! ? 1 : a.slug < b.slug ? -1 : 1));
  const half = Math.floor(dated.length / 2);
  const fit = dated.slice(0, half);
  const test = dated.slice(half);
  const cut = fit.length > 0 ? fit[fit.length - 1]!.listed_at! : snapshot.as_of;
  const fitTable = categoryTable(fit, model);
  const fitCurve = sizeCurveFor(fit);
  const fitLine = fitSizeCurve(fit);
  const fitEffects = categoryEffects(fit, fitLine, model);
  const radar4 = (p: SnapshotProtocol): number =>
    Math.min(model.multiple_cap, sizeCurveAt(p.tvl_usd, fitLine) * effectFor(p.category, fitEffects.table));
  const radar3 = (p: SnapshotProtocol): number =>
    Math.min(model.multiple_cap, sizeMultipleFor(p.tvl_usd, fitCurve) * (multipleFor(p.category, fitTable) / fitTable.global));
  const scored: OosMethod[] = [
    { ...oosScore(test, radar4), name: 'log-size + category (radar-4)' },
    { ...oosScore(test, radar3), name: 'size x category (radar-3)' },
    { ...oosScore(test, (p) => multipleFor(p.category, fitTable)), name: 'category only (radar-2)' },
    { ...oosScore(test, () => fitTable.global), name: 'flat global median' },
  ];
  return { cut_date: cut, fit_n: fit.length, test_n: test.length, methods: scored };
}

/** The farm plan's gas spend in dollars: the first transaction, the setup, the deepen, the weekly actions. */
export function planSpendUsd(p: SnapshotProtocol, age: number | null): number {
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const setupGas = capital >= 150 ? 8 : 4;
  const deepenGas = capital >= 150 ? 4 : 2;
  const weeks = Math.ceil(hold / 7);
  return 3 + setupGas + deepenGas + 2 * weeks;
}

/** The farm verdict from the low-band value: FARM at $2.5M and above, THIN at $1M, SKIP below. */
export function verdictFor(lowImplied: number, model: ModelConstants = MODEL): 'FARM' | 'THIN' | 'SKIP' {
  if (lowImplied >= model.verdict_farm_value_usd) return 'FARM';
  if (lowImplied >= model.verdict_thin_value_usd) return 'THIN';
  return 'SKIP';
}

/** The verdict as the farm plan's last step: the spend, the low-band value, the cover, the call. */
export function verdictStepText(lowImplied: number, spend: number, verdict: 'FARM' | 'THIN' | 'SKIP'): string {
  const cover = spend > 0 ? Math.round(lowImplied / spend) : 0;
  const call =
    verdict === 'FARM'
      ? 'At this size the farm is worth doing.'
      : verdict === 'THIN'
        ? 'Worth a small position, not a large one.'
        : 'Too small to chase: skip it, or wait for a bigger position.';
  return `Verdict: ${verdict} — this plan spends about $${spend} of gas. The protocol's low-band value is ${fmtUsd(lowImplied)}, so the spend is 1 in ${fmtInt(cover)} of it. ${call}`;
}

/** The multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  fit: SizeFit,
  effects: CategoryEffect[],
  lowAll: number,
): {
  implied: number;
  multiple: number;
  sizeMultiple: number;
  categoryMultiple: number;
  lowMultiple: number;
  lowImplied: number;
  spend: number;
  verdict: 'FARM' | 'THIN' | 'SKIP';
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  chainMult: number;
  rising: number;
  age: number | null;
} {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const chainMult = Math.min(model.chain_cap, 1 + model.chain_step * (Math.max(1, protocol.chains.length) - 1));
  const sizeMultiple = round6(sizeCurveAt(protocol.tvl_usd, fit));
  const categoryMultiple = round6(effectFor(protocol.category, effects));
  // The combined and low multiples are rounded before they are used, so the number the board
  // publishes is the number the value is priced from — the dashboard recomputes from the
  // published figures and must land on the same dollar.
  const multiple = combinedMultiple(protocol.tvl_usd, protocol.category, fit, effects, model);
  const lowMultiple = lowCombinedMultiple(protocol.tvl_usd, protocol.category, fit, effects, lowAll, model);
  const youth = age === null ? 0.5 : Math.max(0, 1 - age / model.maturity_days);
  const rising = (growthPct / 100) * (0.5 + youth);
  const implied = Math.max(1, Math.round(protocol.tvl_usd * multiple * growthMult * maturityMult * chainMult));
  const lowImplied = Math.max(1, Math.round(protocol.tvl_usd * lowMultiple * growthMult * maturityMult * chainMult));
  const spend = planSpendUsd(protocol, age);
  const verdict = verdictFor(lowImplied, model);
  return {
    implied,
    multiple,
    sizeMultiple: round6(sizeMultiple),
    categoryMultiple: round6(categoryMultiple),
    lowMultiple,
    lowImplied,
    spend,
    verdict,
    growthPct,
    growthMult: round6(growthMult),
    maturityMult: round6(maturityMult),
    chainMult: round6(chainMult),
    rising: round4(rising),
    age,
  };
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const peers = livePeers(snapshot);
  const fit = fitSizeCurve(peers);
  const { table: effects, low_all: lowAll } = categoryEffects(peers, fit, model);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but the
  // board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: pre-token protocols below the watchlist floor that could still launch a token
  // of their own — not a wrapped, staked or bridged product of a token that already trades.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd && !isWrappedProduct(p))
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, model, fit, effects, lowAll);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      multiple: s.multiple,
      size_multiple: s.sizeMultiple,
      category_multiple: s.categoryMultiple,
      low_multiple: s.lowMultiple,
      low_implied_value_usd: s.lowImplied,
      plan_spend_usd: s.spend,
      verdict: s.verdict,
      growth_pct: s.growthPct,
      growth_multiplier: s.growthMult,
      maturity_multiplier: s.maturityMult,
      chain_multiplier: s.chainMult,
      rising: s.rising,
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age, s.lowImplied, s.spend, s.verdict).map(stepText),
  }));
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** A second chain a protocol names, or the first one again. */
function secondChainOf(p: SnapshotProtocol): string {
  return p.chains.length > 1 ? p.chains[1]! : chainOf(p);
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's first action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm') || c.includes('farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('curation')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  if (c.includes('basis')) return `Deposit $${capital} into ${name}'s basis strategy on ${chain} and hold the position.`;
  if (c.includes('payment') || c.includes('card')) return `Fund $${capital} into your ${name} balance on ${chain} and make one real payment with it.`;
  if (c.includes('index')) return `Buy $${capital} of ${name}'s index token on ${chain} and hold it.`;
  if (c.includes('chain')) return `Bridge $${capital} of USDC to the ${name} chain and use its flagship app once.`;
  if (c.includes('governance')) return `Deposit $${capital} into ${name} on ${chain} and vote on one live proposal.`;
  if (c.includes('otc') || c.includes('marketplace')) return `Place one $${capital} offer on ${name}'s marketplace on ${chain}.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The category's second action: deepen the same position, so the activity is more than one touch. */
function deepenFor(p: SnapshotProtocol, capital: number, chain: string, secondChain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Borrow $${Math.round(capital / 5)} against the supply on ${name}, then repay it in full within a week.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm') || c.includes('farm')) return `Stake the liquidity receipt in ${name}'s gauge or rewards contract and vote in one gauge round.`;
  if (c.includes('bridge')) return `Use the bridged funds in a second app on ${chain} instead of bridging them straight back.`;
  if (c.includes('staking') || c.includes('restak')) return `Restake the staking rewards through ${name} and delegate to a second validator.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Close the first hedge and open a second small position in the opposite direction.`;
  if (c.includes('prediction')) return `Place a second position on a different market on ${name} and let the first one resolve.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('curation')) return `Deposit $${Math.round(capital / 2)} into a second ${name} vault on ${secondChain} and keep both shares.`;
  if (c.includes('stable')) return `Swap half of the stable asset into ${name}'s yield-bearing version on ${chain}.`;
  if (c.includes('rwa')) return `Hold the yield asset through one distribution and reinvest the payout.`;
  if (c.includes('insurance')) return `Buy a second cover from ${name} for a different pool on ${chain}.`;
  if (c.includes('basis')) return `Hold the basis position through one full funding cycle.`;
  if (c.includes('payment') || c.includes('card')) return `Make a second payment with the ${name} balance, on a different day than the first.`;
  if (c.includes('index')) return `Add $${Math.round(capital / 2)} to the index position on ${secondChain}.`;
  if (c.includes('chain')) return `Use a second native app on the ${name} chain with the bridged funds.`;
  if (c.includes('governance')) return `Delegate your votes on ${name} and vote on a second proposal.`;
  if (c.includes('otc') || c.includes('marketplace')) return `Settle the first offer on ${name} and place a second one at a different price.`;
  return `Repeat the first action on ${secondChain} so the position spans two chains.`;
}

/** What a qualifying weekly action looks like for the category. */
function weeklyFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 'a deposit, a borrow, a repayment or a vote';
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm') || c.includes('farm')) return 'a swap, a liquidity add or a gauge vote';
  if (c.includes('bridge')) return 'a bridge, a swap or a deposit on the destination chain';
  if (c.includes('staking') || c.includes('restak')) return 'a stake, a restake or a validator change';
  if (c.includes('perpetual') || c.includes('derivative')) return 'a hedge open, a hedge close or a margin top-up';
  if (c.includes('prediction')) return 'a market position or a settlement';
  if (c.includes('curator') || c.includes('allocator') || c.includes('curation')) return 'a vault deposit, a redemption or a rebalance';
  if (c.includes('stable')) return 'a mint, a redeem or a swap of the stable asset';
  if (c.includes('rwa')) return 'a mint, a hold through a distribution or a reinvestment';
  if (c.includes('insurance')) return 'a cover buy, a renewal or a claim check';
  if (c.includes('basis')) return 'a deposit or a hold through a funding cycle';
  if (c.includes('payment') || c.includes('card')) return 'a payment or a balance top-up';
  if (c.includes('index')) return 'an index buy or a rebalance';
  if (c.includes('chain')) return 'a bridge in or one use of a native app';
  if (c.includes('governance')) return 'a vote or a delegation';
  return 'a deposit, a swap or a vote';
}

/** The category's risk and how to exit it: the step that keeps a farm plan honest. */
function riskFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Lending risk is a bad-debt event or a frozen market: keep the position small, watch the borrow rate, and unwind by repaying any borrow first, then withdrawing the supply in one transaction.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm') || c.includes('farm')) return `Liquidity risk is impermanent loss and a thin pool: exit by removing the whole position in one transaction when the pool's depth falls or the position passes its hold.`;
  if (c.includes('bridge')) return `Bridge risk is a delayed or stuck transfer: keep the receipt, wait one full day, and use only the protocol's own support channel before bridging again.`;
  if (c.includes('staking') || c.includes('restak')) return `Staking risk is a slashing event or a long unbonding: exit by starting the unbonding early and never staking more than you can leave locked.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Perpetual risk is liquidation: keep leverage low, and exit by closing the hedge before the margin ratio falls.`;
  if (c.includes('prediction')) return `Prediction risk is a market resolving against you: exit by closing the position before resolution instead of holding it to the end.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('curation')) return `Vault risk is one bad curator call: spread across two vaults, and exit by redeeming the shares for the underlying asset in one transaction.`;
  if (c.includes('stable')) return `Stable-asset risk is a depeg: exit by redeeming for the underlying asset while the peg still holds.`;
  if (c.includes('rwa')) return `RWA risk is an off-chain default: exit by redeeming the yield asset for its underlying before the next distribution date.`;
  if (c.includes('insurance')) return `Cover risk is an unpaid claim: keep the policy documents, and exit by letting the cover lapse at expiry instead of renewing it.`;
  if (c.includes('basis')) return `Basis risk is a funding-rate flip: exit by closing the position when the funding rate turns against you for a full week.`;
  if (c.includes('payment') || c.includes('card')) return `Payment risk is a frozen balance: keep only the funds you plan to spend in the ${name} balance, and withdraw the rest to your own wallet.`;
  if (c.includes('index')) return `Index risk is one bad constituent: exit by selling the index token back in one transaction when its composition changes.`;
  if (c.includes('chain')) return `Chain risk is a halted chain: keep the position small, and exit by bridging the funds back as soon as the chain resumes.`;
  if (c.includes('governance')) return `Governance risk is a vote that changes the rules: exit by withdrawing the deposit if a passed proposal cuts the rewards.`;
  return `Exit risk is a frozen contract or a paused withdrawal: keep the position small enough to lose, and unwind in one transaction as soon as withdrawals slow.`;
}

/**
 * A protocol's farm plan: eight steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 * The last step nets the plan: its gas spend against the protocol's low-band value.
 */
export function farmSteps(
  p: SnapshotProtocol,
  age: number | null,
  lowImplied: number,
  spend: number,
  verdict: 'FARM' | 'THIN' | 'SKIP',
): FarmStep[] {
  const chain = chainOf(p);
  const secondChain = secondChainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: deepenFor(p, capital, chain, secondChain),
      cost: `about $${capital >= 150 ? 4 : 2} of gas`,
      time: '10 minutes',
    },
    {
      text: `Make one qualifying action each week, such as ${weeklyFor(p)}.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `${riskFor(p)} Claim only from the link the protocol itself publishes, and never pay anyone to claim.`,
      cost: 'no fee to check',
      time: '10 minutes to review the exit',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
    {
      text: verdictStepText(lowImplied, spend, verdict),
      cost: `about $${spend} of gas for the whole plan`,
      time: 'the plan, start to finish',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    multiple: row.model.multiple,
    size_multiple: row.model.size_multiple,
    category_multiple: row.model.category_multiple,
    low_multiple: row.model.low_multiple,
    low_implied_value_usd: row.model.low_implied_value_usd,
    plan_spend_usd: row.model.plan_spend_usd,
    verdict: row.model.verdict,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    chain_multiplier: row.model.chain_multiplier,
    rising: row.model.rising,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const peers = livePeers(snapshot);
  const fit = fitSizeCurve(peers);
  const { table: effects } = categoryEffects(peers, fit, model);
  const global = peers.length > 0 ? median(peers.map((p) => p.mcap_usd! / p.tvl_usd)) : 0.25;
  const oos = oosCheck(snapshot, model);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const aboveFloor = snapshot.protocols.filter(
    (p) => !snapshot.watchlist.includes(p.slug) && isPreToken(p) && p.tvl_usd >= snapshot.floor_usd,
  ).length;
  const belowFloor = snapshot.protocols.filter(
    (p) => !snapshot.watchlist.includes(p.slug) && isPreToken(p) && p.tvl_usd < snapshot.floor_usd,
  );
  const wrappedBelow = belowFloor.filter((p) => isWrappedProduct(p)).length;
  const boardCategories = new Set(board.map((r) => r.category ?? 'Other'));
  const shownEffects = effects.filter((t) => boardCategories.has(t.category));
  for (const c of boardCategories) {
    if (!shownEffects.some((t) => t.category === c)) {
      shownEffects.push({ category: c, live_peers: 0, median_residual: null, effect: 1, low_effect: 1 });
    }
  }
  shownEffects.sort((a, b) => b.effect - a.effect || (a.category < b.category ? -1 : 1));
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    live_peer_count: peers.length,
    set_aside_above_floor: aboveFloor,
    set_aside_wrapped_below_floor: wrappedBelow,
    global_multiple: round6(global),
    category_effects: shownEffects,
    size_fit: fit,
    oos,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
/** Read the sealed snapshot, rejecting anything that is not the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new SnapshotError('the snapshot is not JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new SnapshotError('the snapshot is not a JSON object');
  }
  const doc = parsed as Record<string, unknown>;
  const reject = (why: string): never => {
    throw new SnapshotError(`snapshot.json: ${why}`);
  };
  if (typeof doc.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(doc.as_of)) reject('no as_of date');
  if (typeof doc.source !== 'string') reject('no source');
  if (typeof doc.floor_usd !== 'number' || !Number.isSafeInteger(doc.floor_usd) || doc.floor_usd <= 0) reject('no floor_usd');
  if (!Array.isArray(doc.protocols)) reject('no protocols array');
  if (!Array.isArray(doc.watchlist) || doc.watchlist.some((entry) => typeof entry !== 'string')) reject('no watchlist of slugs');
  const protocols: SnapshotProtocol[] = [];
  for (let at = 0; at < doc.protocols.length; at++) {
    const raw = doc.protocols[at];
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) reject(`protocol ${at} is not an object`);
    const fields = raw as Record<string, unknown>;
    if (typeof fields.slug !== 'string' || typeof fields.name !== 'string' || typeof fields.tvl_usd !== 'number' || !Number.isFinite(fields.tvl_usd)) {
      reject(`protocol ${at} lacks a slug, a name or a TVL`);
    }
    const slugText = fields.slug;
    const nameText = fields.name;
    const tvlNumber = fields.tvl_usd;
    const categoryText = typeof fields.category === 'string' ? fields.category : null;
    const chainList = Array.isArray(fields.chains) ? fields.chains.filter((chain): chain is string => typeof chain === 'string') : [];
    const changeNumber = typeof fields.change_7d === 'number' && Number.isFinite(fields.change_7d) ? fields.change_7d : null;
    const mcapNumber = typeof fields.mcap_usd === 'number' && Number.isFinite(fields.mcap_usd) ? fields.mcap_usd : null;
    const listedText = typeof fields.listed_at === 'string' ? fields.listed_at : null;
    const geckoText = typeof fields.gecko_id === 'string' ? fields.gecko_id : null;
    const symbolText = typeof fields.symbol === 'string' ? fields.symbol : null;
    protocols.push({ slug: slugText, name: nameText, category: categoryText, chains: chainList, tvl_usd: tvlNumber, change_7d: changeNumber, mcap_usd: mcapNumber, listed_at: listedText, gecko_id: geckoText, symbol: symbolText });
  }
  return { as_of: doc.as_of, source: doc.source, floor_usd: doc.floor_usd, protocols, watchlist: doc.watchlist as string[] };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const rankedSlugs = new Set(board.map((row) => row.slug));
  const absent = snapshot.watchlist.filter((slug) => !rankedSlugs.has(slug));
  if (absent.length > 0) return `the board misses ${absent.length} watchlist slug${absent.length === 1 ? '' : 's'}: ${absent.slice(0, 5).join(', ')}`;
  const rankList = board.map((row) => row.rank).sort((a, b) => a - b);
  for (let at = 0; at < rankList.length; at++) if (rankList[at] !== at + 1) return `rank ${at + 1} is ${rankList[at]}`;
  for (let at = 1; at < board.length; at++) {
    if (board[at]!.implied_value_usd > board[at - 1]!.implied_value_usd) return `row ${at + 1} outranks row ${at} on implied value`;
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: every row priced the same is not a ranking`;
  }
  for (const row of board) {
    const plan = row.farm_steps;
    if (plan.length < 3 || plan.length > 12) return `${row.slug} has ${plan.length} farm steps`;
    for (const step of plan) if (step.length < 20 || step.length > 600) return `${row.slug} has a farm step of ${step.length} characters`;
    if (!Number.isSafeInteger(row.implied_value_usd) || row.implied_value_usd <= 0) return `${row.slug} has implied value ${row.implied_value_usd}`;
  }
  return null;
}

/** The dashboard's dataset as one script: no fetch, no network. */
export function dataScript(radar: RadarData): string {
  return 'window.RADAR=' + JSON.stringify(radar) + ';\n';
}
