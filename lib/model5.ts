// Token Radar's model, radar-5 hybrid: the same snapshot in, a ranked board out — the price is
// a fitted size line times a category effect, and the test is a walk-forward, not one split.
//
// What changed from radar-4, and why — and what changed from the first radar-5 build, and why.
// Radar-4 was a fitted log-size line with its test buried in a methodology panel. The first
// radar-5 build flipped both: the multiple became the category's own median market-cap-to-TVL
// among the snapshot's live-token peers — the FDV/TVL comparables framework — and the test moved
// to the board's first panel as a four-fold walk-forward plus a 200-draw bootstrap. That build
// was measured honestly and the comparable LOST: walk-forward mean 4.43x / 25% within 2x, against
// radar-4's 3.40x / 36%. The size line carries real signal (market cap scales as TVL^0.47);
// pricing off the category median alone throws it away. So this build keeps radar-5's test and
// presentation and puts the size factor back in as one named factor of the product: the multiple
// is the size line at the protocol's TVL times its category's effect on that line. Nothing is
// hardcoded by name: the same function scores every row, and the snapshot carries no supply,
// revenue or fee figures at all (ten fields only: slug, name, category, chains, tvl, 7d change,
// market cap, listed date, gecko id, symbol). No revenue multiple is claimed, no dilution
// adjustment is invented: the methodology panel says what the model cannot see. The test is four
// expanding walk-forward folds with a 30-day embargo — peers listed within thirty days of a test
// fold's start are purged from its train set, so a fold is never fitted on the same month it is
// scored on — plus a 200-draw bootstrap of the error and of every verdict. The board's first
// panel is the test, with its numbers, before any ranking.
//
// The price, per protocol, from the snapshot's own figures only:
//
//   size multiple     = the fitted log-size line at the protocol's TVL: exp(intercept + slope
//                       x log10(tvl)). The line is least-squares on the snapshot's live-token
//                       peers (log(mcap/TVL) against log10(TVL)); market cap scales as TVL^0.47.
//   category effect   = the median of the category's live peers' residuals from that line,
//                       shrunk toward no effect with weight n/(n+5), capped at 3x. A category
//                       with no live peers takes no effect (1x). Nothing is hardcoded by name.
//   low effect        = the same shrinkage applied to the 25th percentile of the category's
//                       residuals, pulled toward the 25th percentile of every peer's residuals.
//   multiple          = min(1.5, size multiple x category effect)
//   low multiple      = min(1.5, size multiple x low effect)
//   growth            = 1 + clamp(change_7d, -50, 100) / 100 x 1.0
//   maturity          = 0.6 + min(age_days, 1095) / 1095 x 0.4   (age unknown: 365 days)
//   chain             = min(1.10, 1 + 0.02 x min(chains - 1, 10))
//   implied           = max(1, round(tvl_usd x multiple x growth x maturity x chain))
//   low implied       = the same arithmetic from the low multiple.
//   verdict           = FARM at a low-band value of $2.5M and above, THIN at $1M, SKIP below —
//                       the farm plan's gas spend is netted against the low-band value in dollars,
//                       so every plan is costed the same way radar-4 costed it.
//
// Rising (a separate sort, not the value rank) is unchanged in shape: clamped growth times youth.
// The board's coverage rule is unchanged too: the watchlist is the floor, the early radar adds
// rankable pre-token protocols below it, and wrapped, staked or bridged products are set aside.

import {
  ageDays,
  categoryEffects,
  categoryTable,
  combinedMultiple,
  effectFor,
  farmSteps,
  fitSizeCurve,
  isPreToken,
  isRankable,
  isWrappedProduct,
  livePeers,
  liveRows,
  lowCombinedMultiple,
  multipleFor,
  oosCheck,
  planSpendUsd,
  sizeCurveAt,
  sizeCurveFor,
  sizeMultipleFor,
  stepText,
  verdictFor,
} from './model.ts';
import type {
  BoardRow,
  CategoryEffect,
  LiveRow,
  ModelConstants,
  OosCheck,
  OosMethod,
  RadarRow,
  SizeFit,
  Snapshot,
  SnapshotProtocol,
} from './model.ts';

/** Radar-5's constants, as the dashboard states them. The growth and maturity constants are
 * radar-4's (growth weight 1.0, cap 100, maturity floor 0.6, range 0.4): the hybrid keeps
 * radar-4's pricing in full — multiple and constants — and adds radar-5's test and presentation.
 * The first radar-5 build changed these constants (0.6, 150, 0.7, 0.5); the hybrid reverts them,
 * so the board it writes is radar-4's board on the same snapshot, verifiable row by row. */
export const MODEL5: ModelConstants = {
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
export const MODEL5_VERSION = 'radar-5';

/** The multiple's floor: a category never prices below five cents on the TVL dollar. */
const MULTIPLE_FLOOR = 0.05;

/** Walk-forward folds: five date-ordered chunks, four expanding train windows. */
const WALK_CHUNKS = 5;
const WALK_FOLDS = 4;
/** Days purged before a test fold starts: peers listed inside the embargo never fit that fold. */
const WALK_EMBARGO_DAYS = 30;
/** Bootstrap draws for the error distribution and the verdict stability. */
const BOOTSTRAP_DRAWS = 200;
/** A verdict counts as stable when it survives at least this share of bootstrap draws. */
const VERDICT_STABLE_SHARE = 0.95;

/** One category's comparable: its live peers' median ratio, the shrunk multiple, the low band. */
export interface CategoryComparable {
  category: string;
  live_peers: number;
  median_multiple: number | null;
  multiple: number;
  low_multiple: number;
}

/** One walk-forward fold: its date window, its purged train size, and every method's score. */
export interface WalkFold {
  fold: number;
  test_from: string;
  test_to: string;
  train_n: number;
  purged_n: number;
  test_n: number;
  methods: OosMethod[];
}

/** The walk-forward test: four expanding folds, the mean across them, and the worst fold. */
export interface WalkForwardCheck {
  chunks: number;
  folds: WalkFold[];
  aggregate: OosMethod[];
  worst_fold_error: number;
}

/** The bootstrap: 200 seeded resamples of the error, and of every published verdict. */
export interface BootstrapCheck {
  draws: number;
  error_p10: number;
  error_p50: number;
  error_p90: number;
  within_p10: number;
  within_p50: number;
  within_p90: number;
  verdict_stable_rows: number;
  verdict_stable_pct: number;
  median_verdict_flips: number;
}

/** One category's effect on the size line: its live peers, the median residual, the effect used. */
export interface CategoryEffectRow {
  category: string;
  live_peers: number;
  median_residual: number | null;
  effect: number;
  low_effect: number;
}

/** Everything the radar-5 dashboard renders, from the snapshot. */
export interface RadarData5 {
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
  size_fit: SizeFit;
  global_low_effect: number;
  category_effects: CategoryEffectRow[];
  oos_walk_forward: WalkForwardCheck;
  oos_median_split: OosCheck;
  bootstrap: BootstrapCheck;
  rows: RadarRow[];
  live: LiveRow[];
}

/** The median of a non-empty list of numbers. */
function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  return n % 2 === 1 ? sorted[(n - 1) / 2]! : (sorted[n / 2 - 1]! + sorted[n / 2]!) / 2;
}

/** A percentile of an ascending list: the value at rank q, straight between neighbours. */
function percentileOf(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const at = q * (sorted.length - 1);
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (at - lo);
}

const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A finite number, else `fallback`. */
function finiteOf(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A small seeded generator, so the bootstrap is the same on every run. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A date string shifted back by `days` whole days, still YYYY-MM-DD. */
function daysBefore(date: string, days: number): string {
  const ms = Date.parse(`${date}T00:00:00Z`) - days * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * The comparables table for one set of live peers: the global median ratio, one shrunk multiple
 * per category, and one shrunk low-band multiple per category. The multiple is the category's
 * median ratio pulled toward the global median with weight n/(n+5); the low multiple is the same
 * shrinkage applied to the 25th percentile, pulled toward the 25th percentile of all peers.
 */
export function comparablesTable(
  peers: SnapshotProtocol[],
  model: ModelConstants = MODEL5,
): { global: number; global_low: number; table: CategoryComparable[] } {
  const ratios = peers.map((p) => p.mcap_usd! / p.tvl_usd);
  const global = ratios.length > 0 ? medianOf(ratios) : 0.25;
  const globalLow = ratios.length > 0 ? percentileOf([...ratios].sort((a, b) => a - b), model.low_band_percentile / 100) : 0.1;
  const clampMult = (n: number): number => Math.min(model.multiple_cap, Math.max(MULTIPLE_FLOOR, n));
  const byCategory = new Map<string, number[]>();
  for (const p of peers) {
    const c = p.category ?? 'Other';
    const list = byCategory.get(c);
    if (list) list.push(p.mcap_usd! / p.tvl_usd);
    else byCategory.set(c, [p.mcap_usd! / p.tvl_usd]);
  }
  const table: CategoryComparable[] = [...byCategory.entries()]
    .map(([category, rs]) => {
      const sorted = [...rs].sort((a, b) => a - b);
      // The median is capped at the model's median cap BEFORE shrinkage: one extreme peer
      // (a single live token at 400x its TVL) must not set its whole category's price. The
      // same cap applies to the low percentile. Without it, a one-peer category prices at
      // the 1.5x cap and its low band with it, and the board's verdicts turn on one token.
      const med = Math.min(medianOf(sorted), model.median_cap);
      const low = Math.min(percentileOf(sorted, model.low_band_percentile / 100), model.median_cap);
      const w = rs.length / (rs.length + model.shrink_prior);
      return {
        category,
        live_peers: rs.length,
        median_multiple: round4(med),
        multiple: round6(clampMult(w * med + (1 - w) * global)),
        low_multiple: round6(clampMult(w * low + (1 - w) * globalLow)),
      };
    })
    .sort((a, b) => b.multiple - a.multiple || (a.category < b.category ? -1 : 1));
  return { global: round6(global), global_low: round6(globalLow), table };
}

/** The multiple one category gets: its shrunk table value, or the global median with no live peers. */
export function multipleFor5(category: string | null, table: CategoryComparable[], global: number): number {
  const row = table.find((t) => t.category === (category ?? 'Other'));
  return row === undefined ? global : row.multiple;
}

/** The low-band multiple one category gets: its table value, or the global low with no live peers. */
export function lowMultipleFor5(category: string | null, table: CategoryComparable[], globalLow: number): number {
  const row = table.find((t) => t.category === (category ?? 'Other'));
  return row === undefined ? globalLow : row.low_multiple;
}

/** The multipliers and the implied value one protocol gets under the hybrid. */
export function impliedValue5(
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
  const rawGrowth = finiteOf(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const chainMult = Math.min(model.chain_cap, 1 + model.chain_step * (Math.min(Math.max(1, protocol.chains.length) - 1, 10)));
  // The hybrid's two named factors: the size line at this TVL, and the category's effect on it.
  // The combined and low multiples are rounded before they are used, so the number the board
  // publishes is the number the value is priced from — the dashboard recomputes from the
  // published figures and must land on the same dollar.
  const sizeMultiple = round6(sizeCurveAt(protocol.tvl_usd, fit));
  const categoryMultiple = round6(effectFor(protocol.category, effects));
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
    sizeMultiple,
    categoryMultiple,
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
function bySlugOf(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow5(row: BoardRow): RadarRow {
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

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard5(snapshot: Snapshot, model: ModelConstants = MODEL5): BoardRow[] {
  const peers = livePeers(snapshot);
  // One fit for the whole board: the size line and the category effects are fitted once on
  // every live peer, then the same fit prices every row.
  const fit = fitSizeCurve(peers);
  const { table: effects, low_all: lowAll } = categoryEffects(peers, fit, model);
  const index = bySlugOf(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug it names, even one the snapshot no longer carries.
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
    const v = impliedValue5(p, snapshot.as_of, model, fit, effects, lowAll);
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
      // The hybrid's two named factors: the size line at this TVL and the category's effect
      // on it. Their product, capped at the model's multiple cap, is the multiple the value
      // is priced from. The dashboard shows both factors in the detail view.
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

/** One method's score on a test set: median factor error, share within 2x, median pred/actual. */
function scoreMethod(test: SnapshotProtocol[], predict: (p: SnapshotProtocol) => number): Omit<OosMethod, 'name'> {
  const ratios = test.map((p) => (p.tvl_usd * predict(p)) / p.mcap_usd!);
  const errors = ratios.map((r) => Math.abs(Math.log(r)));
  const within = ratios.filter((r) => r >= 0.5 && r <= 2).length;
  return {
    median_ratio: round4(medianOf(ratios)),
    median_factor_error: round4(Math.exp(medianOf(errors))),
    within_2x_pct: test.length > 0 ? Math.round((100 * within) / test.length) : 0,
  };
}

/**
 * The walk-forward test: the dated live-token protocols in listing order, cut into five
 * contiguous chunks. Four expanding folds fit on the older chunks and score the next one, with a
 * 30-day embargo — train peers listed within thirty days of the test fold's start are purged, so
 * no fold is fitted on the same month it is scored on. Five methods run every fold on the same
 * train/test sets, so the table shows what the hybrid buys over the pure category comparable it
 * replaces, over radar-3's bands, over category alone and over a flat global median. The first
 * radar-5 build's pure comparable scored 4.43x / 25% on this test against the hybrid's 3.40x /
 * 36% — the size line carries real signal, which is why the hybrid keeps it as a named factor.
 */
export function walkForwardCheck(snapshot: Snapshot, model: ModelConstants = MODEL5): WalkForwardCheck {
  const dated = livePeers(snapshot)
    .filter((p) => p.listed_at !== null)
    .sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : a.listed_at! > b.listed_at! ? 1 : a.slug < b.slug ? -1 : 1));
  const n = dated.length;
  const base = Math.floor(n / WALK_CHUNKS);
  const rem = n % WALK_CHUNKS;
  const chunks: SnapshotProtocol[][] = [];
  let at = 0;
  for (let c = 0; c < WALK_CHUNKS; c++) {
    const size = base + (c < rem ? 1 : 0);
    chunks.push(dated.slice(at, at + size));
    at += size;
  }
  const folds: WalkFold[] = [];
  const methodNames = [
    'hybrid: size × category (radar-5)',
    'radar-5 pure: category comparable',
    'radar-3: size x category',
    'category only (radar-2)',
    'flat global median',
  ];
  for (let f = 0; f < WALK_FOLDS; f++) {
    const train = chunks.slice(0, f + 1).flat();
    const test = chunks[f + 1]!;
    const testFrom = test[0]!.listed_at!;
    const testTo = test[test.length - 1]!.listed_at!;
    const cutoff = daysBefore(testFrom, WALK_EMBARGO_DAYS);
    const purged = train.filter((p) => p.listed_at! >= cutoff).length;
    const kept = train.filter((p) => p.listed_at! < cutoff);
    // Every method refits on the same purged train set, so the fold compares models, not data.
    const comp5 = comparablesTable(kept, model);
    const fitLine = fitSizeCurve(kept);
    const fitEffects = categoryEffects(kept, fitLine, model);
    const fitTable = categoryTable(kept, model);
    const fitCurve = sizeCurveFor(kept);
    const predictors: Array<(p: SnapshotProtocol) => number> = [
      (p) => combinedMultiple(p.tvl_usd, p.category, fitLine, fitEffects.table, model),
      (p) => multipleFor5(p.category, comp5.table, comp5.global),
      (p) => Math.min(model.multiple_cap, sizeMultipleFor(p.tvl_usd, fitCurve) * (multipleFor(p.category, fitTable) / fitTable.global)),
      (p) => multipleFor(p.category, fitTable),
      () => fitTable.global,
    ];
    const methods = predictors.map((predict, i) => ({ ...scoreMethod(test, predict), name: methodNames[i]! }));
    folds.push({ fold: f + 1, test_from: testFrom, test_to: testTo, train_n: kept.length, purged_n: purged, test_n: test.length, methods });
  }
  const aggregate: OosMethod[] = methodNames.map((name, i) => {
    const errs = folds.map((f) => f.methods[i]!.median_factor_error);
    const withins = folds.map((f) => f.methods[i]!.within_2x_pct);
    const ratios = folds.map((f) => f.methods[i]!.median_ratio);
    return {
      name,
      median_factor_error: round4(errs.reduce((a, b) => a + b, 0) / errs.length),
      within_2x_pct: Math.round(withins.reduce((a, b) => a + b, 0) / withins.length),
      median_ratio: round4(ratios.reduce((a, b) => a + b, 0) / ratios.length),
    };
  });
  const worstFoldError = Math.max(...folds.map((f) => f.methods[0]!.median_factor_error));
  return { chunks: WALK_CHUNKS, folds, aggregate, worst_fold_error: round4(worstFoldError) };
}

/**
 * The bootstrap: 200 seeded resamples. First, the error distribution — the median-split fit half
 * resampled with replacement, radar-5 refit, scored on the fixed test half — so the headline
 * error carries a 10th/90th band instead of a point. Second, verdict stability — the full live
 * peer set resampled, the low-band table refit, every published verdict recomputed — so the
 * board says how many of its calls survive resampling. One fixed seed, so two runs agree.
 */
export function bootstrapCheck(snapshot: Snapshot, board: BoardRow[], model: ModelConstants = MODEL5): BootstrapCheck {
  const rng = mulberry32(20261116);
  const resample = <T>(items: T[]): T[] => {
    const out: T[] = [];
    for (let i = 0; i < items.length; i++) out.push(items[Math.floor(rng() * items.length)]!);
    return out;
  };
  const dated = livePeers(snapshot)
    .filter((p) => p.listed_at !== null)
    .sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : a.listed_at! > b.listed_at! ? 1 : a.slug < b.slug ? -1 : 1));
  const half = Math.floor(dated.length / 2);
  const fitHalf = dated.slice(0, half);
  const testHalf = dated.slice(half);
  const errors: number[] = [];
  const withins: number[] = [];
  for (let d = 0; d < BOOTSTRAP_DRAWS; d++) {
    const draw = resample(fitHalf);
    const fitDraw = fitSizeCurve(draw);
    const effDraw = categoryEffects(draw, fitDraw, model);
    const scored = scoreMethod(testHalf, (p) => combinedMultiple(p.tvl_usd, p.category, fitDraw, effDraw.table, model));
    errors.push(scored.median_factor_error);
    withins.push(scored.within_2x_pct);
  }
  const peers = livePeers(snapshot);
  const stable = new Array(board.length).fill(0);
  const flipsPerDraw: number[] = [];
  for (let d = 0; d < BOOTSTRAP_DRAWS; d++) {
    const draw = resample(peers);
    const fitDraw = fitSizeCurve(draw);
    const effDraw = categoryEffects(draw, fitDraw, model);
    let flips = 0;
    board.forEach((row, i) => {
      const lowMultiple = lowCombinedMultiple(row.tvl_usd, row.category, fitDraw, effDraw.table, effDraw.low_all, model);
      const lowImplied = Math.max(
        1,
        Math.round(row.tvl_usd * lowMultiple * row.model.growth_multiplier * row.model.maturity_multiplier * row.model.chain_multiplier),
      );
      const verdict = verdictFor(lowImplied, model);
      if (verdict === row.model.verdict) stable[i]! += 1;
      else flips += 1;
    });
    flipsPerDraw.push(flips);
  }
  const stableRows = stable.filter((c) => c / BOOTSTRAP_DRAWS >= VERDICT_STABLE_SHARE).length;
  const sortedErrors = [...errors].sort((a, b) => a - b);
  const sortedWithins = [...withins].sort((a, b) => a - b);
  return {
    draws: BOOTSTRAP_DRAWS,
    error_p10: round4(percentileOf(sortedErrors, 0.1)),
    error_p50: round4(percentileOf(sortedErrors, 0.5)),
    error_p90: round4(percentileOf(sortedErrors, 0.9)),
    within_p10: Math.round(percentileOf(sortedWithins, 0.1)),
    within_p50: Math.round(percentileOf(sortedWithins, 0.5)),
    within_p90: Math.round(percentileOf(sortedWithins, 0.9)),
    verdict_stable_rows: stableRows,
    verdict_stable_pct: board.length > 0 ? Math.round((100 * stableRows) / board.length) : 0,
    median_verdict_flips: Math.round(medianOf(flipsPerDraw)),
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar5(snapshot: Snapshot, model: ModelConstants = MODEL5): { board: BoardRow[]; radar: RadarData5 } {
  const board = buildBoard5(snapshot, model);
  const live = liveRows(snapshot);
  const peers = livePeers(snapshot);
  // The fit the board is priced from, and the category effects table the dashboard shows.
  const fit = fitSizeCurve(peers);
  const { table: effects, low_all: lowAll } = categoryEffects(peers, fit, model);
  const walk = walkForwardCheck(snapshot, model);
  // The median split scores the same log-size + category pricing the hybrid uses, so its first
  // method is the hybrid's number under its old name — relabelled here, the arithmetic untouched.
  const medianSplit = oosCheck(snapshot, model);
  medianSplit.methods[0]!.name = 'hybrid: size × category (radar-5)';
  const boot = bootstrapCheck(snapshot, board, model);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const aboveFloor = snapshot.protocols.filter(
    (p) => !snapshot.watchlist.includes(p.slug) && isPreToken(p) && p.tvl_usd >= snapshot.floor_usd,
  ).length;
  const belowFloor = snapshot.protocols.filter(
    (p) => !snapshot.watchlist.includes(p.slug) && isPreToken(p) && p.tvl_usd < snapshot.floor_usd,
  );
  const wrappedBelow = belowFloor.filter((p) => isWrappedProduct(p)).length;
  const boardCategories = new Set(board.map((r) => r.category ?? 'Other'));
  const shown: CategoryEffectRow[] = effects
    .filter((t) => boardCategories.has(t.category))
    .map((t) => ({ category: t.category, live_peers: t.live_peers, median_residual: t.median_residual, effect: t.effect, low_effect: t.low_effect }));
  for (const c of boardCategories) {
    if (!shown.some((t) => t.category === c)) {
      shown.push({ category: c, live_peers: 0, median_residual: null, effect: 1, low_effect: lowAll });
    }
  }
  shown.sort((a, b) => b.effect - a.effect || (a.category < b.category ? -1 : 1));
  const radar: RadarData5 = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL5_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    live_peer_count: peers.length,
    set_aside_above_floor: aboveFloor,
    set_aside_wrapped_below_floor: wrappedBelow,
    size_fit: fit,
    global_low_effect: lowAll,
    category_effects: shown,
    oos_walk_forward: walk,
    oos_median_split: medianSplit,
    bootstrap: boot,
    rows: board.map(radarRow5),
    live,
  };
  return { board, radar };
}

/** The dashboard's dataset as one script: no fetch, no network. */
export function dataScript5(radar: RadarData5): string {
  return 'window.RADAR=' + JSON.stringify(radar) + ';\n';
}
