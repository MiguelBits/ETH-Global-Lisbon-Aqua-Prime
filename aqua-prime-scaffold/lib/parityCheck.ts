/**
 * Dev parity check: compare primeSim at deployed params vs on-chain quoteExactIn.
 */

import {
  DEFAULT_RAW_TUNING,
  deployedDeskBranches,
  simulateBranches,
  type BookState,
} from "./primeSim";
import { resolveParams, type DynamicContext } from "./dynamicParams";
import type { MarketStats } from "./marketStats";

const EMPTY_MARKET: MarketStats = {
  realizedVol: 0.02,
  flowImbalance: 0,
  sampleCount: 0,
  latestMid: null,
  uniswapMid: null,
};

export function simulateDeployedDesk(
  book: BookState,
  ethUsd1e18: bigint,
  amountIn: bigint,
  sellBase: boolean,
) {
  const ctx: DynamicContext = {
    book,
    ethUsd1e18,
    market: EMPTY_MARKET,
    oracleStalenessSec: 0,
    nowSec: Math.floor(Date.now() / 1000),
  };
  const resolved = resolveParams(DEFAULT_RAW_TUNING, ctx);
  const branches = deployedDeskBranches(resolved);
  return simulateBranches(book, ethUsd1e18, amountIn, sellBase, branches, resolved.lambda);
}

export function checkParity(
  onChainOut: bigint,
  simOut: bigint,
  toleranceWei = 2n,
): { ok: boolean; delta: bigint } {
  const delta = onChainOut > simOut ? onChainOut - simOut : simOut - onChainOut;
  return { ok: delta <= toleranceWei, delta };
}

/** Log parity result in dev (call from desk page useEffect). */
export function logParityCheck(
  label: string,
  onChainOut: bigint,
  simOut: bigint,
): void {
  if (process.env.NODE_ENV !== "development") return;
  const { ok, delta } = checkParity(onChainOut, simOut);
  const msg = `[primeSim parity] ${label}: onChain=${onChainOut} sim=${simOut} delta=${delta} ${ok ? "OK" : "MISMATCH"}`;
  if (ok) {
    console.debug(msg);
  } else {
    console.warn(msg);
  }
}
