/**
 * Client-side port of Aqua Prime pricing: XYC, USD-skew, LP fair cap, oracle band, selector scoring.
 * Mirrors reference/swap-vm/src/instructions/*.sol and PrimeSelector.sol (bigint 1e18).
 */

export const SKEW_ONE = 10n ** 18n;
export const BASE_DECIMALS = 18;
export const QUOTE_DECIMALS = 6;

/** Deployed middle-ground desk defaults (DeployAquaPrimeSepolia.s.sol). */
export const DEPLOYED_LAMBDA = 1_000_000_000n;
export const DEPLOYED_SKEW_K = 5n * 10n ** 17n; // 0.5e18
export const DEPLOYED_SKEW_MAX = 10n ** 17n; // 0.1e18
export const DEPLOYED_BASELINE_K = 0n;
export const DEPLOYED_LP_PREMIUM = 5n * 10n ** 15n; // 0.005e18
export const DEPLOYED_ORACLE_DECAY = 95n * 10n ** 16n; // 0.95e18 => ±5% band

export type BranchMode = "xyc" | "xyc_oracle" | "xyc_skew_bounded";

export type BranchConfig = {
  id: string;
  label: string;
  desc: string;
  mode: BranchMode;
  k: bigint;
  maxAdjustment: bigint;
  maxLpPremium: bigint;
  maxPriceDecay: bigint;
};

export type RawTuningParams = {
  lambda: bigint;
  baselineK: bigint;
  healK: bigint;
  maxAdjustment: bigint;
  baselinePremium: bigint;
  healPremium: bigint;
  oracleBand: bigint;
};

export type ResolvedBranchParams = {
  k: bigint;
  maxAdjustment: bigint;
  maxLpPremium: bigint;
  maxPriceDecay: bigint;
};

export type BookState = {
  balBase: bigint;
  balQuote: bigint;
};

export type BranchSimResult = {
  branchIndex: number;
  label: string;
  desc: string;
  amountOut: bigint;
  postSkewE18: bigint;
  score: bigint;
  usdIn: bigint;
  usdOut: bigint;
  edgeVsFairBps: number;
  capBound: boolean;
  execPriceUsdcPerWeth: number | null;
};

export type SimResult = {
  winnerIndex: number;
  primeOut: bigint;
  branches: BranchSimResult[];
};

export const DEFAULT_RAW_TUNING: RawTuningParams = {
  lambda: DEPLOYED_LAMBDA,
  baselineK: DEPLOYED_BASELINE_K,
  healK: DEPLOYED_SKEW_K,
  maxAdjustment: DEPLOYED_SKEW_MAX,
  baselinePremium: 0n,
  healPremium: DEPLOYED_LP_PREMIUM,
  oracleBand: DEPLOYED_ORACLE_DECAY,
};

export function deployedBranches(resolved: {
  baseline: ResolvedBranchParams;
  heal: ResolvedBranchParams;
  oracle: ResolvedBranchParams;
}): BranchConfig[] {
  return [
    {
      id: "baseline",
      label: "BASELINE",
      desc: "XYC capped at fair",
      mode: "xyc_skew_bounded",
      ...resolved.baseline,
    },
    {
      id: "heal",
      label: "HEAL",
      desc: "inventory heal",
      mode: "xyc_skew_bounded",
      ...resolved.heal,
    },
    {
      id: "xyc",
      label: "XYC",
      desc: "pure constant product",
      mode: "xyc",
      k: 0n,
      maxAdjustment: 0n,
      maxLpPremium: 0n,
      maxPriceDecay: 0n,
    },
    {
      id: "oracle",
      label: "ORACLE",
      desc: "chainlink band",
      mode: "xyc_oracle",
      k: 0n,
      maxAdjustment: 0n,
      maxLpPremium: 0n,
      maxPriceDecay: resolved.oracle.maxPriceDecay,
    },
  ];
}

/** Live two-branch desk (DeployAquaPrimeStack / Sepolia selector). */
export function deployedDeskBranches(resolved: {
  baseline: ResolvedBranchParams;
  heal: ResolvedBranchParams;
  oracle?: ResolvedBranchParams;
}): BranchConfig[] {
  return deployedBranches({
    baseline: resolved.baseline,
    heal: resolved.heal,
    oracle: resolved.oracle ?? { k: 0n, maxAdjustment: 0n, maxLpPremium: 0n, maxPriceDecay: DEPLOYED_ORACLE_DECAY },
  }).slice(0, 2);
}

/** Reference curves for routing panel overlay (client sim only). */
export function referenceDeskBranches(resolved: { oracle: ResolvedBranchParams }): BranchConfig[] {
  return deployedBranches({
    baseline: { k: 0n, maxAdjustment: 0n, maxLpPremium: 0n, maxPriceDecay: 0n },
    heal: { k: 0n, maxAdjustment: 0n, maxLpPremium: 0n, maxPriceDecay: 0n },
    oracle: resolved.oracle,
  }).slice(2);
}

/** Branches that compete in the live PrimeSelector (on-chain). */
export const LIVE_SELECTOR_LABELS = ["BASELINE", "HEAL"] as const;

/** Reference-only curves for UI comparison — not routed on-chain. */
export const REFERENCE_BRANCH_LABELS = ["XYC", "ORACLE"] as const;

/** All rows shown in the routing panel (live + reference). */
export const ROUTING_PANEL_LABELS = [...LIVE_SELECTOR_LABELS, ...REFERENCE_BRANCH_LABELS] as const;

/** @deprecated use LIVE_SELECTOR_LABELS */
export const LIVE_BRANCH_LABELS = ROUTING_PANEL_LABELS;

export const LIVE_BRANCH_DESCS: Record<(typeof ROUTING_PANEL_LABELS)[number], string> = {
  BASELINE: "XYC → fair cap (k≈0)",
  HEAL: "XYC → USD skew + fair cap",
  XYC: "pure constant product (ref)",
  ORACLE: "XYC → Chainlink band (ref)",
};

/** @deprecated reference branches are client-side only */
export function referenceOnChainBranches(resolved: { oracle: ResolvedBranchParams }): BranchConfig[] {
  return referenceDeskBranches(resolved);
}

/** Live selector + reference overlay for impact / tuning panels. */
export function branchingPanelBranches(resolved: {
  baseline: ResolvedBranchParams;
  heal: ResolvedBranchParams;
  oracle: ResolvedBranchParams;
}): BranchConfig[] {
  return [...deployedDeskBranches(resolved), ...referenceDeskBranches(resolved)];
}

function mulDiv(a: bigint, b: bigint, c: bigint, rounding: "floor" | "ceil" = "floor"): bigint {
  if (c === 0n) return 0n;
  const product = a * b;
  if (rounding === "floor") return product / c;
  return product % c === 0n ? product / c : product / c + 1n;
}

export function tokenToUsd1e18(
  amount: bigint,
  isBase: boolean,
  ethUsd1e18: bigint,
): bigint {
  if (isBase) {
    return mulDiv(amount, ethUsd1e18, 10n ** BigInt(BASE_DECIMALS));
  }
  return mulDiv(amount, SKEW_ONE, 10n ** BigInt(QUOTE_DECIMALS));
}

function usdToToken1e18(
  usd1e18: bigint,
  isBase: boolean,
  ethUsd1e18: bigint,
  rounding: "floor" | "ceil" = "floor",
): bigint {
  if (isBase) {
    return mulDiv(usd1e18, 10n ** BigInt(BASE_DECIMALS), ethUsd1e18, rounding);
  }
  return mulDiv(usd1e18, 10n ** BigInt(QUOTE_DECIMALS), SKEW_ONE, rounding);
}

function xycExactIn(amountIn: bigint, balanceIn: bigint, balanceOut: bigint): bigint {
  if (balanceIn === 0n || balanceOut === 0n) return 0n;
  return mulDiv(amountIn, balanceOut, balanceIn + amountIn);
}

function applySkewFromValues(
  amountIn: bigint,
  amountOut: bigint,
  valueIn: bigint,
  valueOut: bigint,
  k: bigint,
  maxAdjustment: bigint,
): bigint {
  const denom = valueIn + valueOut;
  if (denom === 0n || k === 0n) return amountOut;

  const overstockedOut = valueOut >= valueIn;
  const absDiff = overstockedOut ? valueOut - valueIn : valueIn - valueOut;

  let absAdj = mulDiv(k, absDiff, denom);
  if (absAdj > maxAdjustment) absAdj = maxAdjustment;
  if (absAdj === 0n) return amountOut;

  const factor = overstockedOut ? SKEW_ONE + absAdj : SKEW_ONE - absAdj;
  return mulDiv(amountOut, factor, SKEW_ONE, "floor");
}

function capToFairValue(
  amountIn: bigint,
  amountOut: bigint,
  ethUsd1e18: bigint,
  tokenInIsBase: boolean,
  tokenOutIsBase: boolean,
  maxLpPremium: bigint,
): { out: bigint; bound: boolean } {
  const usdIn = tokenToUsd1e18(amountIn, tokenInIsBase, ethUsd1e18);
  const usdOutCap = usdIn + mulDiv(usdIn, maxLpPremium, SKEW_ONE);
  const maxAmountOut = usdToToken1e18(usdOutCap, tokenOutIsBase, ethUsd1e18, "floor");
  if (amountOut > maxAmountOut) {
    return { out: maxAmountOut, bound: true };
  }
  return { out: amountOut, bound: false };
}

function applyOracleAdjuster(
  amountIn: bigint,
  amountOut: bigint,
  oraclePrice1e18: bigint,
  maxPriceDecay: bigint,
): bigint {
  if (amountIn === 0n || amountOut === 0n) return amountOut;

  const currentPrice = mulDiv(amountOut, SKEW_ONE, amountIn);
  if (oraclePrice1e18 === currentPrice) return amountOut;

  const maxIncrease = 2n * SKEW_ONE - maxPriceDecay;

  if (oraclePrice1e18 > currentPrice) {
    const priceRatio = mulDiv(oraclePrice1e18, SKEW_ONE, currentPrice);
    const adjustment = priceRatio < maxIncrease ? priceRatio : maxIncrease;
    return mulDiv(amountOut, adjustment, SKEW_ONE, "floor");
  }

  const priceRatio = mulDiv(oraclePrice1e18, SKEW_ONE, currentPrice);
  const adjustment = priceRatio > maxPriceDecay ? priceRatio : maxPriceDecay;
  return mulDiv(amountOut, adjustment, SKEW_ONE, "floor");
}

/** Oracle-implied USDC-per-WETH price in 1e18 (for sellBase path). */
export function oracleUsdcPerWeth1e18(ethUsd1e18: bigint): bigint {
  return mulDiv(ethUsd1e18, 10n ** BigInt(QUOTE_DECIMALS), SKEW_ONE);
}

function postSkewAbsE18(
  balanceIn: bigint,
  balanceOut: bigint,
  branchIn: bigint,
  branchOut: bigint,
): bigint {
  const balanceOutPost = balanceOut > branchOut ? balanceOut - branchOut : 0n;
  const balanceInPost = balanceIn + branchIn;
  const sum = balanceOutPost + balanceInPost;
  if (sum === 0n) return 0n;
  const diff =
    balanceOutPost >= balanceInPost ? balanceOutPost - balanceInPost : balanceInPost - balanceOutPost;
  return mulDiv(diff, SKEW_ONE, sum);
}

function scoreBranch(isExactIn: boolean, branchIn: bigint, branchOut: bigint, postSkew: bigint, lambda: bigint): bigint {
  const takerValue = isExactIn ? branchOut : -branchIn;
  const penalty = mulDiv(lambda, postSkew, SKEW_ONE);
  return takerValue - penalty;
}

function execPriceUsdcPerWeth(amountIn: bigint, amountOut: bigint, sellBase: boolean): number | null {
  if (amountIn === 0n || amountOut === 0n) return null;
  if (sellBase) {
    return Number(amountOut) / 1e6 / (Number(amountIn) / 1e18);
  }
  return Number(amountIn) / 1e6 / (Number(amountOut) / 1e18);
}

export function simulateBranch(
  book: BookState,
  amountIn: bigint,
  sellBase: boolean,
  ethUsd1e18: bigint,
  branch: BranchConfig,
  lambda: bigint,
  branchIndex: number,
): BranchSimResult {
  const tokenInIsBase = sellBase;
  const tokenOutIsBase = !sellBase;

  const balanceIn = sellBase ? book.balBase : book.balQuote;
  const balanceOut = sellBase ? book.balQuote : book.balBase;

  let amountOut = xycExactIn(amountIn, balanceIn, balanceOut);
  let capBound = false;

  if (branch.mode === "xyc_skew_bounded") {
    const valueIn = tokenToUsd1e18(balanceIn, tokenInIsBase, ethUsd1e18);
    const valueOut = tokenToUsd1e18(balanceOut, tokenOutIsBase, ethUsd1e18);
    amountOut = applySkewFromValues(amountIn, amountOut, valueIn, valueOut, branch.k, branch.maxAdjustment);
    const capped = capToFairValue(
      amountIn,
      amountOut,
      ethUsd1e18,
      tokenInIsBase,
      tokenOutIsBase,
      branch.maxLpPremium,
    );
    amountOut = capped.out;
    capBound = capped.bound;
  } else if (branch.mode === "xyc_oracle") {
    const oraclePrice = sellBase
      ? oracleUsdcPerWeth1e18(ethUsd1e18)
      : mulDiv(SKEW_ONE, 10n ** BigInt(BASE_DECIMALS), ethUsd1e18);
    amountOut = applyOracleAdjuster(amountIn, amountOut, oraclePrice, branch.maxPriceDecay);
  }

  const postSkew = postSkewAbsE18(balanceIn, balanceOut, amountIn, amountOut);
  const sc = scoreBranch(true, amountIn, amountOut, postSkew, lambda);

  const usdIn = tokenToUsd1e18(amountIn, tokenInIsBase, ethUsd1e18);
  const usdOut = tokenToUsd1e18(amountOut, tokenOutIsBase, ethUsd1e18);
  const edgeVsFairBps = usdIn > 0n ? Number(((usdOut - usdIn) * 10000n) / usdIn) : 0;

  return {
    branchIndex,
    label: branch.label,
    desc: branch.desc,
    amountOut,
    postSkewE18: postSkew,
    score: sc,
    usdIn,
    usdOut,
    edgeVsFairBps,
    capBound,
    execPriceUsdcPerWeth: execPriceUsdcPerWeth(amountIn, amountOut, sellBase),
  };
}

export function simulateBranches(
  book: BookState,
  ethUsd1e18: bigint,
  amountIn: bigint,
  sellBase: boolean,
  branches: BranchConfig[],
  lambda: bigint,
): SimResult {
  if (amountIn === 0n || branches.length === 0) {
    return { winnerIndex: 0, primeOut: 0n, branches: [] };
  }

  const results = branches.map((b, i) =>
    simulateBranch(book, amountIn, sellBase, ethUsd1e18, b, lambda, i),
  );

  let winnerIndex = 0;
  let bestScore = results[0]?.score ?? 0n;
  for (let i = 1; i < results.length; i++) {
    const r = results[i];
    if (r && r.score > bestScore) {
      bestScore = r.score;
      winnerIndex = i;
    }
  }

  const primeOut = results[winnerIndex]?.amountOut ?? 0n;
  return { winnerIndex, primeOut, branches: results };
}

/** Sweep sizes for price-impact charts. */
export function sweepAmounts(
  sellBase: boolean,
  maxAmountHuman: number,
  steps = 12,
): bigint[] {
  const dec = sellBase ? BASE_DECIMALS : QUOTE_DECIMALS;
  const scale = 10n ** BigInt(dec);
  const max = BigInt(Math.floor(maxAmountHuman * Number(scale)));
  if (max <= 0n) return [1n];
  const out: bigint[] = [];
  for (let i = 1; i <= steps; i++) {
    out.push((max * BigInt(i)) / BigInt(steps));
  }
  return out;
}

export function usdSkewPct(book: BookState, ethUsd1e18: bigint): number {
  const baseUsd = tokenToUsd1e18(book.balBase, true, ethUsd1e18);
  const quoteUsd = tokenToUsd1e18(book.balQuote, false, ethUsd1e18);
  const total = baseUsd + quoteUsd;
  if (total === 0n) return 0;
  return Number((quoteUsd - baseUsd) * 10000n / total) / 100;
}
