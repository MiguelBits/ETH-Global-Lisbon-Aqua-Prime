/**
 * Maker-side SOR for Jarvis: score BASELINE / HEAL / ORACLE (ref),
 * optimize size × side, and Gate quotes against Chainlink band.
 */

import { parseUnits } from "viem"
import { bpsVs, midUsdcPerWeth } from "~~/lib/branchBook"
import { resolveParams, type DynamicContext } from "~~/lib/dynamicParams"
import type { MarketStats } from "~~/lib/marketStats"
import {
  DEFAULT_RAW_TUNING,
  DEPLOYED_ORACLE_DECAY,
  LIVE_SELECTOR_LABELS,
  REFERENCE_BRANCH_LABELS,
  SKEW_ONE,
  branchingPanelBranches,
  deployedDeskBranches,
  referenceDeskBranches,
  simulateBranches,
  type BranchSimResult,
  type BookState,
  type RawTuningParams,
  type SimResult,
  usdSkewPct,
} from "~~/lib/primeSim"
import type { JarvisDeskSet } from "~~/lib/jarvis/schema"

const EMPTY_MARKET: MarketStats = {
  realizedVol: 0.02,
  flowImbalance: 0,
  sampleCount: 0,
  latestMid: null,
  uniswapMid: null,
}

const WETH_LADDER = ["0.35", "0.5", "0.6", "1", "1.5", "2", "3", "5"] as const
const USDC_LADDER = ["800", "1000", "1500", "2500", "4000", "5000", "10000"] as const

export type LiveBranchLabel = (typeof LIVE_SELECTOR_LABELS)[number]
export type RefBranchLabel = (typeof REFERENCE_BRANCH_LABELS)[number]
export type SorBranchLabel = LiveBranchLabel | RefBranchLabel

export type OracleBoundAdvice = {
  poolVsMarkBps: number | null
  markUsdPerEth: number
  poolMid: number | null
  bandBps: number
  xycOut: bigint
  oracleOut: bigint
  bound: "lift" | "cut" | "flat"
  adjustBps: number
  withinBand: boolean
  warn: boolean
  line: string
}

export type MakerSorPick = {
  sellBase: boolean
  amountHuman: string
  amountIn: bigint
  adviceWinner: SorBranchLabel
  liveWinner: LiveBranchLabel
  liveExecutable: boolean
  score: bigint
  amountOut: bigint
  postSkewE18: bigint
  liveSim: SimResult
  allBranches: BranchSimResult[]
  oracle: OracleBoundAdvice
  optimized: boolean
  narrative: string
}

type TuningInput = {
  book: BookState
  ethUsd1e18: bigint
  deskSet?: JarvisDeskSet | null
  oracleStalenessSec?: number
}

const tuningFromDesk = (deskSet?: JarvisDeskSet | null): RawTuningParams => {
  if (!deskSet) return DEFAULT_RAW_TUNING
  return {
    ...DEFAULT_RAW_TUNING,
    healK: deskSet.healK,
    maxAdjustment: deskSet.maxAdjustment,
    healPremium: deskSet.healPremium,
    lambda: deskSet.lambda,
  }
}

const resolveDesk = (args: TuningInput) => {
  const ethUsd1e18 = args.ethUsd1e18 > 0n ? args.ethUsd1e18 : 3000n * 10n ** 18n
  const ctx: DynamicContext = {
    book: args.book,
    ethUsd1e18,
    market: EMPTY_MARKET,
    oracleStalenessSec: args.oracleStalenessSec ?? 0,
    nowSec: Math.floor(Date.now() / 1000),
  }
  return { ethUsd1e18, resolved: resolveParams(tuningFromDesk(args.deskSet), ctx) }
}

/** Chainlink band advice for the current ticket (reference ORACLE vs XYC). */
export const oracleBoundAdvice = (args: {
  book: BookState
  ethUsd1e18: bigint
  amountIn: bigint
  sellBase: boolean
  deskSet?: JarvisDeskSet | null
  oracleStalenessSec?: number
}): OracleBoundAdvice => {
  const { ethUsd1e18, resolved } = resolveDesk(args)
  const markUsdPerEth = Number(ethUsd1e18) / 1e18
  const poolMid = midUsdcPerWeth(args.book.balBase, args.book.balQuote)
  const poolVsMarkBps = bpsVs(poolMid, markUsdPerEth)

  const maxDecay = resolved.oracle.maxPriceDecay > 0n ? resolved.oracle.maxPriceDecay : DEPLOYED_ORACLE_DECAY
  const bandBps = Number(((SKEW_ONE - maxDecay) * 10000n) / SKEW_ONE)
  const withinBand =
    poolVsMarkBps === null ? true : Math.abs(poolVsMarkBps) <= Math.max(bandBps, 1)

  const refs = simulateBranches(
    args.book,
    ethUsd1e18,
    args.amountIn,
    args.sellBase,
    referenceDeskBranches(resolved),
    resolved.lambda,
  )
  const xyc = refs.branches.find(b => b.label === "XYC")
  const oracle = refs.branches.find(b => b.label === "ORACLE")
  const xycOut = xyc?.amountOut ?? 0n
  const oracleOut = oracle?.amountOut ?? 0n

  let bound: OracleBoundAdvice["bound"] = "flat"
  if (oracleOut > xycOut) bound = "lift"
  else if (oracleOut < xycOut) bound = "cut"

  const adjustBps =
    xycOut > 0n ? Number(((oracleOut - xycOut) * 10000n) / xycOut) : 0

  const warn =
    !withinBand ||
    Math.abs(adjustBps) >= 25 ||
    (args.oracleStalenessSec != null && args.oracleStalenessSec > 3600)

  const markLabel = markUsdPerEth.toLocaleString("en-US", { maximumFractionDigits: 0 })
  const poolLabel =
    poolVsMarkBps === null
      ? "pool mid unavailable"
      : `pool ${poolVsMarkBps >= 0 ? "+" : ""}${poolVsMarkBps.toFixed(0)} bps vs mark`

  const line = warn
    ? `Oracle gate: mark $${markLabel} · ${poolLabel} · band ±${bandBps.toFixed(0)} bps · ORACLE would ${bound} XYC by ${adjustBps >= 0 ? "+" : ""}${adjustBps.toFixed(0)} bps${
        !withinBand ? " — outside Chainlink band; prefer ORACLE-aware sizing or wait." : "."
      }`
    : `Oracle gate: mark $${markLabel} · ${poolLabel} · within ±${bandBps.toFixed(0)} bps band · ORACLE ${bound} vs XYC (${adjustBps >= 0 ? "+" : ""}${adjustBps.toFixed(0)} bps).`

  return {
    poolVsMarkBps,
    markUsdPerEth,
    poolMid,
    bandBps,
    xycOut,
    oracleOut,
    bound,
    adjustBps,
    withinBand,
    warn,
    line,
  }
}

const pickFromSim = (args: {
  sellBase: boolean
  amountHuman: string
  amountIn: bigint
  liveSim: SimResult
  allBranches: BranchSimResult[]
  oracle: OracleBoundAdvice
  optimized: boolean
}): MakerSorPick => {
  const liveWinnerRow = args.liveSim.branches[args.liveSim.winnerIndex]
  const liveWinner = (liveWinnerRow?.label === "HEAL" ? "HEAL" : "BASELINE") as LiveBranchLabel

  let adviceWinner: SorBranchLabel = liveWinner
  let bestScore = liveWinnerRow?.score ?? 0n
  for (const b of args.allBranches) {
    if (b.amountOut === 0n) continue
    if (b.score > bestScore) {
      bestScore = b.score
      adviceWinner = b.label as SorBranchLabel
    }
  }

  const liveExecutable = adviceWinner === "BASELINE" || adviceWinner === "HEAL"
  const winnerRow =
    args.allBranches.find(b => b.label === adviceWinner) ?? liveWinnerRow ?? args.liveSim.branches[0]!

  const side = args.sellBase
    ? `sell ${args.amountHuman} WETH`
    : `buy with ${args.amountHuman} USDC`

  const narrative = args.optimized
    ? `Certainly sir. Best size: ${side}. ${adviceWinner} leads${liveExecutable ? "" : ` — Execute via ${liveWinner}`}. Press Execute.`
    : `Certainly sir. ${adviceWinner} leads${liveExecutable ? "" : ` — live path ${liveWinner}`}. Press Execute.`

  return {
    sellBase: args.sellBase,
    amountHuman: args.amountHuman,
    amountIn: args.amountIn,
    adviceWinner,
    liveWinner,
    liveExecutable,
    score: liveWinnerRow?.score ?? winnerRow.score,
    amountOut: liveWinnerRow?.amountOut ?? winnerRow.amountOut,
    postSkewE18: liveWinnerRow?.postSkewE18 ?? winnerRow.postSkewE18,
    liveSim: args.liveSim,
    allBranches: args.allBranches,
    oracle: args.oracle,
    optimized: args.optimized,
    narrative,
  }
}

/** Score live + reference branches for a fixed ticket. */
export const pickBestRoute = (args: {
  book: BookState
  ethUsd1e18: bigint
  amountIn: bigint
  amountHuman: string
  sellBase: boolean
  deskSet?: JarvisDeskSet | null
  oracleStalenessSec?: number
}): MakerSorPick | null => {
  if (args.amountIn === 0n) return null
  const { ethUsd1e18, resolved } = resolveDesk(args)
  const liveBranches = deployedDeskBranches(resolved)
  const allBranches = branchingPanelBranches(resolved)
  const liveSim = simulateBranches(
    args.book,
    ethUsd1e18,
    args.amountIn,
    args.sellBase,
    liveBranches,
    resolved.lambda,
  )
  if (liveSim.branches.length === 0 || liveSim.primeOut === 0n) return null

  const full = simulateBranches(
    args.book,
    ethUsd1e18,
    args.amountIn,
    args.sellBase,
    allBranches,
    resolved.lambda,
  )
  const oracle = oracleBoundAdvice(args)

  return pickFromSim({
    sellBase: args.sellBase,
    amountHuman: args.amountHuman,
    amountIn: args.amountIn,
    liveSim,
    allBranches: full.branches,
    oracle,
    optimized: false,
  })
}

/**
 * Search size × side for max live maker score (amountOut − λ·|postSkew|).
 * Prefers healing direction when scores tie within a small band.
 */
export const optimizeSizeSide = (args: {
  book: BookState
  ethUsd1e18: bigint
  deskSet?: JarvisDeskSet | null
  oracleStalenessSec?: number
}): MakerSorPick | null => {
  const { ethUsd1e18, resolved } = resolveDesk(args)
  const liveBranches = deployedDeskBranches(resolved)
  const skew0 = usdSkewPct(args.book, ethUsd1e18)

  let best: {
    sellBase: boolean
    amountHuman: string
    amountIn: bigint
    liveSim: SimResult
    healBias: number
  } | null = null
  let bestScore = -(1n << 120n)

  for (const sellBase of [true, false] as const) {
    const heals =
      (sellBase && skew0 > 1) || (!sellBase && skew0 < -1) ? 1 : sellBase === skew0 > 0 ? 0.5 : 0
    const ladder = sellBase ? WETH_LADDER : USDC_LADDER
    const decimals = sellBase ? 18 : 6

    for (const amountHuman of ladder) {
      let amountIn: bigint
      try {
        amountIn = parseUnits(amountHuman, decimals)
      } catch {
        continue
      }
      if (sellBase ? amountIn > args.book.balBase : amountIn > args.book.balQuote) continue

      const liveSim = simulateBranches(
        args.book,
        ethUsd1e18,
        amountIn,
        sellBase,
        liveBranches,
        resolved.lambda,
      )
      const row = liveSim.branches[liveSim.winnerIndex]
      if (!row || row.amountOut === 0n) continue

      // Tiny heal bias so inventory direction wins near-ties without drowning score.
      const biased = row.score + BigInt(Math.round(heals * 1e6))
      if (biased > bestScore) {
        bestScore = biased
        best = { sellBase, amountHuman, amountIn, liveSim, healBias: heals }
      }
    }
  }

  if (!best) return null

  const full = simulateBranches(
    args.book,
    ethUsd1e18,
    best.amountIn,
    best.sellBase,
    branchingPanelBranches(resolved),
    resolved.lambda,
  )
  const oracle = oracleBoundAdvice({
    book: args.book,
    ethUsd1e18,
    amountIn: best.amountIn,
    sellBase: best.sellBase,
    deskSet: args.deskSet,
    oracleStalenessSec: args.oracleStalenessSec,
  })

  return pickFromSim({
    sellBase: best.sellBase,
    amountHuman: best.amountHuman,
    amountIn: best.amountIn,
    liveSim: best.liveSim,
    allBranches: full.branches,
    oracle,
    optimized: true,
  })
}
