/**
 * Resolve tuning knobs: raw === 0n means use dynamic formula from market/book context.
 */

import type { BookState } from "./primeSim";
import {
  DEPLOYED_LP_PREMIUM,
  DEPLOYED_ORACLE_DECAY,
  DEPLOYED_SKEW_K,
  DEPLOYED_SKEW_MAX,
  SKEW_ONE,
  usdSkewPct,
  type RawTuningParams,
  type ResolvedBranchParams,
} from "./primeSim";
import type { MarketStats } from "./marketStats";

export type DynamicContext = {
  book: BookState;
  ethUsd1e18: bigint;
  market: MarketStats;
  oracleStalenessSec: number;
  nowSec: number;
};

export type ResolvedTuning = {
  lambda: bigint;
  baseline: ResolvedBranchParams;
  heal: ResolvedBranchParams;
  oracle: ResolvedBranchParams;
  /** Which knobs were dynamic (for UI badges). */
  dynamicFlags: Record<keyof RawTuningParams, boolean>;
};

function clampBigint(v: bigint, min: bigint, max: bigint): bigint {
  if (v < min) return min;
  if (v > max) return max;
  return v;
}

function dynamicK(ctx: DynamicContext): bigint {
  const absSkew = Math.abs(usdSkewPct(ctx.book, ctx.ethUsd1e18)) / 100;
  const skewFactor = Math.min(Math.max(absSkew * 2, 0.1), 1);
  return clampBigint(
    BigInt(Math.floor(Number(DEPLOYED_SKEW_K) * skewFactor)),
    10n ** 16n,
    8n * 10n ** 17n,
  );
}

function dynamicMaxAdjustment(ctx: DynamicContext): bigint {
  const vol = ctx.market.realizedVol;
  const staleness = Math.min(ctx.oracleStalenessSec / 3600, 1);
  const widen = 1 + vol * 2 + staleness * 0.5;
  return clampBigint(
    BigInt(Math.floor(Number(DEPLOYED_SKEW_MAX) * widen)),
    2n * 10n ** 16n,
    2n * 10n ** 17n,
  );
}

function dynamicHealPremium(ctx: DynamicContext): bigint {
  const vol = ctx.market.realizedVol;
  const inverse = Math.max(0.25, 1 - vol * 3);
  return clampBigint(
    BigInt(Math.floor(Number(DEPLOYED_LP_PREMIUM) * inverse)),
    0n,
    2n * 10n ** 16n,
  );
}

function dynamicOracleBand(ctx: DynamicContext): bigint {
  const vol = ctx.market.realizedVol;
  const staleness = Math.min(ctx.oracleStalenessSec / 7200, 1);
  const tighten = Math.max(0.5, 1 - vol - staleness * 0.3);
  const decay = 0.95 * tighten;
  return clampBigint(
    BigInt(Math.floor(decay * Number(SKEW_ONE))),
    85n * 10n ** 16n,
    99n * 10n ** 16n,
  );
}

function dynamicLambda(ctx: DynamicContext): bigint {
  const flow = Math.abs(ctx.market.flowImbalance);
  return clampBigint(
    BigInt(Math.floor(1_000_000_000 * (1 + flow))),
    5n * 10n ** 8n,
    5n * 10n ** 9n,
  );
}

function resolveField(
  raw: bigint,
  dynamicFn: (ctx: DynamicContext) => bigint,
  ctx: DynamicContext,
): { value: bigint; isDynamic: boolean } {
  if (raw === 0n) return { value: dynamicFn(ctx), isDynamic: true };
  return { value: raw, isDynamic: false };
}

export function resolveParams(raw: RawTuningParams, ctx: DynamicContext): ResolvedTuning {
  const lambdaR = resolveField(raw.lambda, dynamicLambda, ctx);
  const baselineKR = resolveField(raw.baselineK, () => 0n, ctx);
  const healKR = resolveField(raw.healK, dynamicK, ctx);
  const maxAdjR = resolveField(raw.maxAdjustment, dynamicMaxAdjustment, ctx);
  const baselinePremR = resolveField(raw.baselinePremium, () => 0n, ctx);
  const healPremR = resolveField(raw.healPremium, dynamicHealPremium, ctx);
  const oracleR = resolveField(raw.oracleBand, dynamicOracleBand, ctx);

  return {
    lambda: lambdaR.value,
    baseline: {
      k: baselineKR.value,
      maxAdjustment: maxAdjR.value,
      maxLpPremium: baselinePremR.value,
      maxPriceDecay: oracleR.value,
    },
    heal: {
      k: healKR.value,
      maxAdjustment: maxAdjR.value,
      maxLpPremium: healPremR.value,
      maxPriceDecay: oracleR.value,
    },
    oracle: {
      k: 0n,
      maxAdjustment: 0n,
      maxLpPremium: 0n,
      maxPriceDecay: oracleR.value,
    },
    dynamicFlags: {
      lambda: lambdaR.isDynamic,
      baselineK: baselineKR.isDynamic,
      healK: healKR.isDynamic,
      maxAdjustment: maxAdjR.isDynamic,
      baselinePremium: baselinePremR.isDynamic,
      healPremium: healPremR.isDynamic,
      oracleBand: oracleR.isDynamic,
    },
  };
}

/** Format 1e18-scaled bigint as percent string. */
export function fmtPct1e18(v: bigint, digits = 2): string {
  return `${(Number(v) / 1e18 * 100).toFixed(digits)}%`;
}

/** Parse human percent (e.g. "0.5") to 1e18 bigint. Returns 0n for "dynamic" / empty. */
export function parsePctTo1e18(human: string, allowDynamic = true): bigint {
  if (allowDynamic && (human === "" || human === "0" || human.toLowerCase() === "auto")) return 0n;
  const n = parseFloat(human);
  if (!Number.isFinite(n)) return 0n;
  return BigInt(Math.round(n / 100 * 1e18));
}
