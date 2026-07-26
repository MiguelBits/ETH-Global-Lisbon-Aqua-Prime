/**
 * Realized volatility + flow stats from recent fills and Uniswap reference.
 * Fills are optional (session/local); Uniswap mid still drives reference stats.
 */

import { midUsdcPerWeth } from "./branchBook";

export type FillSample = {
  amountIn: string;
  sellBase: boolean;
  baseBalAfter: string;
  quoteBalAfter: string;
};

export type MarketStats = {
  /** Stddev of mid price (USDC/WETH) from recent fills, as fraction (e.g. 0.02 = 2%). */
  realizedVol: number;
  /** Net sell-base flow as fraction of book (positive = more WETH sold). */
  flowImbalance: number;
  /** Sample count used for vol. */
  sampleCount: number;
  /** Latest mid from most recent fill. */
  latestMid: number | null;
  /** Uniswap reference mid (USDC per WETH) if available. */
  uniswapMid: number | null;
};

export function computeMarketStats(
  fills: FillSample[],
  uniswapAmountOut: bigint | null,
  uniswapAmountIn: bigint = 10n ** 18n,
): MarketStats {
  const mids: number[] = [];

  for (const s of fills) {
    const base = BigInt(s.baseBalAfter);
    const quote = BigInt(s.quoteBalAfter);
    const mid = midUsdcPerWeth(base, quote);
    if (mid !== null && Number.isFinite(mid)) mids.push(mid);
  }

  let realizedVol = 0.02;
  if (mids.length >= 2) {
    const returns: number[] = [];
    for (let i = 1; i < mids.length; i++) {
      const prev = mids[i - 1]!;
      const curr = mids[i]!;
      if (prev > 0) returns.push((curr - prev) / prev);
    }
    if (returns.length > 0) {
      const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
      const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length;
      realizedVol = Math.min(Math.max(Math.sqrt(variance), 0.005), 0.15);
    }
  }

  let sellBaseVol = 0n;
  let buyBaseVol = 0n;
  for (const s of fills.slice(0, 10)) {
    const amt = BigInt(s.amountIn);
    if (s.sellBase) sellBaseVol += amt;
    else buyBaseVol += amt;
  }
  const totalFlow = sellBaseVol + buyBaseVol;
  const flowImbalance = totalFlow > 0n ? Number(sellBaseVol - buyBaseVol) / Number(totalFlow) : 0;

  let uniswapMid: number | null = null;
  if (uniswapAmountOut !== null && uniswapAmountIn > 0n) {
    uniswapMid = Number(uniswapAmountOut) / 1e6 / (Number(uniswapAmountIn) / 1e18);
  }

  return {
    realizedVol,
    flowImbalance,
    sampleCount: mids.length,
    latestMid: mids.length > 0 ? mids[mids.length - 1]! : null,
    uniswapMid,
  };
}
