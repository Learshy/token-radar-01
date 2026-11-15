// Token Radar's model, radar-2: one snapshot of the protocol universe in, one ranked board out.
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
//   multiple   = the category's market multiple, from the snapshot's own live-token protocols:
//                the median mcap/TVL of the category's live peers, shrunk toward the global
//                median (weight n/(n+5)) so a category with one or two peers cannot set its own
//                price, with the category median capped at 3x before shrinkage and the multiple
//                capped at 1.5x. A category with no live peers takes the global median.
//   growth     = clamp(change_7d, -50, 100) per cent
//   growthMult = 1 + (growth / 100) x 1.0
//   maturity   = 0.6 + min(age_days, 1095) / 1095 x 0.4   (age_days unknown: 365)
//   chainMult  = 1 + 0.02 x (chains - 1), capped at 1.10
//   implied    = max(1, round(tvl_usd x multiple x growthMult x maturity x chainMult))
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
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One category's market multiple, as the methodology panel shows it. */
export interface CategoryMultiple {
  category: string;
  live_peers: number;
  median_multiple: number | null;
  multiple: number;
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
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
  set_aside_above_floor: number;
  set_aside_wrapped_below_floor: number;
  global_multiple: number;
  category_multiples: CategoryMultiple[];
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

/** The market multiples, derived from the snapshot's own live-token protocols. */
export function categoryMultiples(snapshot: Snapshot, model: ModelConstants = MODEL): { global: number; table: CategoryMultiple[] } {
  const live = snapshot.protocols.filter(
    (p) => !isPreToken(p) && p.category !== 'CEX' && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0,
  );
  const global = live.length > 0 ? median(live.map((p) => p.mcap_usd! / p.tvl_usd)) : 0.25;
  const byCategory = new Map<string, number[]>();
  for (const p of live) {
    const c = p.category ?? 'Other';
    const list = byCategory.get(c);
    if (list) list.push(p.mcap_usd! / p.tvl_usd);
    else byCategory.set(c, [p.mcap_usd! / p.tvl_usd]);
  }
  const table: CategoryMultiple[] = [...byCategory.entries()]
    .map(([category, ratios]) => {
      const med = median(ratios);
      const w = ratios.length / (ratios.length + model.shrink_prior);
      const multiple = Math.min(model.multiple_cap, w * Math.min(med, model.median_cap) + (1 - w) * global);
      return { category, live_peers: ratios.length, median_multiple: round4(med), multiple: round6(multiple) };
    })
    .sort((a, b) => b.multiple - a.multiple || (a.category < b.category ? -1 : 1));
  return { global: round6(global), table };
}

/** The multiple one category gets: its shrunk table value, or the global median with no live peers. */
export function multipleFor(category: string | null, multiples: { global: number; table: CategoryMultiple[] }): number {
  const row = multiples.table.find((t) => t.category === (category ?? 'Other'));
  return row === undefined ? multiples.global : row.multiple;
}

/** The multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  multiples: { global: number; table: CategoryMultiple[] },
): { implied: number; multiple: number; growthPct: number; growthMult: number; maturityMult: number; chainMult: number; rising: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const chainMult = Math.min(model.chain_cap, 1 + model.chain_step * (Math.max(1, protocol.chains.length) - 1));
  const multiple = multipleFor(protocol.category, multiples);
  const youth = age === null ? 0.5 : Math.max(0, 1 - age / model.maturity_days);
  const rising = (growthPct / 100) * (0.5 + youth);
  const implied = Math.max(1, Math.round(protocol.tvl_usd * multiple * growthMult * maturityMult * chainMult));
  return { implied, multiple, growthPct, growthMult: round6(growthMult), maturityMult: round6(maturityMult), chainMult: round6(chainMult), rising: round4(rising), age };
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const multiples = categoryMultiples(snapshot, model);
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
    const v = impliedValue(p, snapshot.as_of, model, multiples);
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
      growth_pct: s.growthPct,
      growth_multiplier: s.growthMult,
      maturity_multiplier: s.maturityMult,
      chain_multiplier: s.chainMult,
      rising: s.rising,
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
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
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
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
  const multiples = categoryMultiples(snapshot, model);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const aboveFloor = snapshot.protocols.filter(
    (p) => !snapshot.watchlist.includes(p.slug) && isPreToken(p) && p.tvl_usd >= snapshot.floor_usd,
  ).length;
  const belowFloor = snapshot.protocols.filter(
    (p) => !snapshot.watchlist.includes(p.slug) && isPreToken(p) && p.tvl_usd < snapshot.floor_usd,
  );
  const wrappedBelow = belowFloor.filter((p) => isWrappedProduct(p)).length;
  const boardCategories = new Set(board.map((r) => r.category ?? 'Other'));
  const shownMultiples = multiples.table.filter((t) => boardCategories.has(t.category));
  for (const c of boardCategories) {
    if (!shownMultiples.some((t) => t.category === c)) {
      shownMultiples.push({ category: c, live_peers: 0, median_multiple: null, multiple: multiples.global });
    }
  }
  shownMultiples.sort((a, b) => b.multiple - a.multiple || (a.category < b.category ? -1 : 1));
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
    set_aside_above_floor: aboveFloor,
    set_aside_wrapped_below_floor: wrappedBelow,
    global_multiple: multiples.global,
    category_multiples: shownMultiples,
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
