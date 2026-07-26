/**
 * Offline heal-path simulation: retune + apply 3–4 inventory-healing swaps
 * until USD skew is within the healthy band (or the step budget is spent).
 */

import { formatUnits, parseUnits } from "viem"
import { resolveParams } from "~~/lib/dynamicParams"
import { proposeLocal } from "~~/lib/jarvis/fallback"
import type { JarvisDeskSet } from "~~/lib/jarvis/schema"
import {
  DEFAULT_RAW_TUNING,
  deployedDeskBranches,
  simulateBranches,
  tokenToUsd1e18,
  usdSkewPct,
  type BookState,
  type RawTuningParams,
} from "~~/lib/primeSim"

export const HEALTHY_SKEW_PCT = 3
export const HEAL_SIM_MAX_STEPS = 4
export const HEAL_SIM_TARGET_STEPS = 3

const WETH_SIZES = ["0.35", "0.6", "1", "1.5", "2", "3", "5"] as const
const USDC_SIZES = ["800", "1500", "2500", "4000", "6000", "10000"] as const

export type HealSimStep = {
  index: number
  sellBase: boolean
  amountHuman: string
  amountInWei: bigint
  amountOut: bigint
  winnerLabel: string
  skewBefore: number
  skewAfter: number
  params: JarvisDeskSet
  balBaseAfter: bigint
  balQuoteAfter: bigint
  label: string
}

export type HealSimResult = {
  usedScenarioBook: boolean
  startBook: BookState
  endBook: BookState
  startSkew: number
  endSkew: number
  steps: HealSimStep[]
  healthy: boolean
  narrative: string
}

const EMPTY_MARKET = {
  realizedVol: 0.02,
  flowImbalance: 0,
  sampleCount: 0,
  latestMid: null,
  uniswapMid: null,
}

const fmtSkew = (skew: number): string => `${skew >= 0 ? "+" : ""}${skew.toFixed(1)}%`

const applyTrade = (
  book: BookState,
  sellBase: boolean,
  amountIn: bigint,
  amountOut: bigint,
): BookState => {
  if (sellBase) {
    if (book.balBase < amountIn) return book
    return { balBase: book.balBase - amountIn, balQuote: book.balQuote + amountOut }
  }
  if (book.balQuote < amountIn) return book
  return { balBase: book.balBase + amountOut, balQuote: book.balQuote - amountIn }
}

/** Build a quote-heavy scenario book with similar total USD value. */
const seedQuoteHeavyBook = (book: BookState, ethUsd1e18: bigint): BookState => {
  const baseUsd = tokenToUsd1e18(book.balBase, true, ethUsd1e18)
  const quoteUsd = tokenToUsd1e18(book.balQuote, false, ethUsd1e18)
  const total = baseUsd + quoteUsd
  if (total === 0n || ethUsd1e18 === 0n) {
    return {
      balBase: 8n * 10n ** 18n,
      balQuote: 45_000n * 10n ** 6n,
    }
  }
  // ~41% base / 59% quote → skew ≈ +18%
  const targetBaseUsd = (total * 41n) / 100n
  const targetQuoteUsd = total - targetBaseUsd
  const balBase = (targetBaseUsd * 10n ** 18n) / ethUsd1e18
  const balQuote = (targetQuoteUsd * 10n ** 6n) / 10n ** 18n
  return { balBase, balQuote }
}

const deskFromProposal = (params: JarvisDeskSet): RawTuningParams => ({
  ...DEFAULT_RAW_TUNING,
  healK: params.healK,
  maxAdjustment: params.maxAdjustment,
  healPremium: params.healPremium,
  lambda: params.lambda,
})

const simulateTuned = (
  book: BookState,
  ethUsd1e18: bigint,
  amountIn: bigint,
  sellBase: boolean,
  params: JarvisDeskSet,
) => {
  const raw = deskFromProposal(params)
  const resolved = resolveParams(raw, {
    book,
    ethUsd1e18,
    market: EMPTY_MARKET,
    oracleStalenessSec: 0,
    nowSec: Math.floor(Date.now() / 1000),
  })
  const branches = deployedDeskBranches(resolved)
  return simulateBranches(book, ethUsd1e18, amountIn, sellBase, branches, resolved.lambda)
}

const stepLabel = (
  sellBase: boolean,
  amountHuman: string,
  amountOut: bigint,
  winnerLabel: string,
  skewAfter: number,
): string => {
  if (sellBase) {
    const usdc = (Number(amountOut) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 2 })
    return `Sell ${amountHuman} WETH → ${usdc} USDC via ${winnerLabel} · skew ${fmtSkew(skewAfter)}`
  }
  const weth = (Number(amountOut) / 1e18).toLocaleString("en-US", { maximumFractionDigits: 4 })
  return `Buy ${amountHuman} USDC → ${weth} WETH via ${winnerLabel} · skew ${fmtSkew(skewAfter)}`
}

/**
 * Pick a size that heals toward balance without dumping the whole book in one clip.
 * Prefers mid sizes so the path lands around 3–4 swaps.
 */
const pickHealSize = (
  book: BookState,
  ethUsd1e18: bigint,
  sellBase: boolean,
  params: JarvisDeskSet,
  stepsLeft: number,
): { amountHuman: string; amountInWei: bigint; amountOut: bigint; winnerLabel: string } | null => {
  const skew0 = usdSkewPct(book, ethUsd1e18)
  const presets = sellBase ? WETH_SIZES : USDC_SIZES
  const decimals = sellBase ? 18 : 6
  const balIn = sellBase ? book.balBase : book.balQuote

  type Cand = {
    amountHuman: string
    amountInWei: bigint
    amountOut: bigint
    winnerLabel: string
    skewAfter: number
    score: number
  }
  const cands: Cand[] = []

  for (const amountHuman of presets) {
    let amountInWei: bigint
    try {
      amountInWei = parseUnits(amountHuman, decimals)
    } catch {
      continue
    }
    if (amountInWei <= 0n || amountInWei * 100n > balIn * 45n) continue

    const sim = simulateTuned(book, ethUsd1e18, amountInWei, sellBase, params)
    if (sim.primeOut <= 0n) continue
    const next = applyTrade(book, sellBase, amountInWei, sim.primeOut)
    const skewAfter = usdSkewPct(next, ethUsd1e18)
    const improved = Math.abs(skewAfter) < Math.abs(skew0) - 0.05
    if (!improved) continue

    // Prefer leaving a little work for remaining steps, then finishing cleanly.
    const absAfter = Math.abs(skewAfter)
    const idealRemain =
      stepsLeft <= 1 ? 0 : Math.max(HEALTHY_SKEW_PCT * 0.4, Math.abs(skew0) * ((stepsLeft - 1) / stepsLeft))
    const remainPenalty = Math.abs(absAfter - idealRemain)
    const overshootPenalty = absAfter < HEALTHY_SKEW_PCT && stepsLeft > 1 ? 2 : 0
    const score = remainPenalty + overshootPenalty + absAfter * 0.15

    cands.push({
      amountHuman,
      amountInWei,
      amountOut: sim.primeOut,
      winnerLabel: sim.branches[sim.winnerIndex]?.label ?? "HEAL",
      skewAfter,
      score,
    })
  }

  if (cands.length === 0) return null
  cands.sort((a, b) => a.score - b.score)
  const best = cands[0]
  if (!best) return null
  return {
    amountHuman: best.amountHuman,
    amountInWei: best.amountInWei,
    amountOut: best.amountOut,
    winnerLabel: best.winnerLabel,
  }
}

export const runHealPathSimulation = (args: {
  book: BookState
  ethUsd1e18: bigint
}): HealSimResult => {
  const ethUsd1e18 = args.ethUsd1e18 > 0n ? args.ethUsd1e18 : 3000n * 10n ** 18n
  const liveSkew = usdSkewPct(args.book, ethUsd1e18)
  const usedScenarioBook = Math.abs(liveSkew) < HEALTHY_SKEW_PCT
  let book: BookState = usedScenarioBook ? seedQuoteHeavyBook(args.book, ethUsd1e18) : { ...args.book }

  const startBook = { ...book }
  const startSkew = usdSkewPct(book, ethUsd1e18)
  const steps: HealSimStep[] = []

  for (let i = 0; i < HEAL_SIM_MAX_STEPS; i++) {
    const skewBefore = usdSkewPct(book, ethUsd1e18)
    if (Math.abs(skewBefore) < HEALTHY_SKEW_PCT && steps.length >= HEAL_SIM_TARGET_STEPS) break
    if (Math.abs(skewBefore) < HEALTHY_SKEW_PCT && steps.length > 0) break

    const sellBase = skewBefore >= 0
    const stepsLeft = HEAL_SIM_MAX_STEPS - i
    const { params } = proposeLocal({
      book,
      ethUsd1e18,
      sellBase,
      amountIn: sellBase ? 10n ** 18n : 1000n * 10n ** 6n,
      uniswapOut: null,
      addressAs: "sir",
    })

    const pick = pickHealSize(book, ethUsd1e18, sellBase, params, stepsLeft)
    if (!pick) break

    const next = applyTrade(book, sellBase, pick.amountInWei, pick.amountOut)
    const skewAfter = usdSkewPct(next, ethUsd1e18)
    steps.push({
      index: i + 1,
      sellBase,
      amountHuman: pick.amountHuman,
      amountInWei: pick.amountInWei,
      amountOut: pick.amountOut,
      winnerLabel: pick.winnerLabel,
      skewBefore,
      skewAfter,
      params,
      balBaseAfter: next.balBase,
      balQuoteAfter: next.balQuote,
      label: stepLabel(sellBase, pick.amountHuman, pick.amountOut, pick.winnerLabel, skewAfter),
    })
    book = next

    if (Math.abs(skewAfter) < HEALTHY_SKEW_PCT) break
  }

  const endSkew = usdSkewPct(book, ethUsd1e18)
  const healthy = Math.abs(endSkew) < HEALTHY_SKEW_PCT
  const narrative = narrateHealPath({
    usedScenarioBook,
    startSkew,
    endSkew,
    steps,
    healthy,
  })

  return {
    usedScenarioBook,
    startBook,
    endBook: book,
    startSkew,
    endSkew,
    steps,
    healthy,
    narrative,
  }
}

const narrateHealPath = (args: {
  usedScenarioBook: boolean
  startSkew: number
  endSkew: number
  steps: HealSimStep[]
  healthy: boolean
}): string => {
  const { steps, healthy } = args
  if (steps.length === 0) {
    return "Certainly sir. No healing clip on this book."
  }

  const closer = healthy
    ? `Healthy after ${steps.length} swaps.`
    : `Closer after ${steps.length} swaps — still healing.`

  return `Certainly sir. Heal path ready — ${closer} Arming MetaMask next.`
}

export const formatHealSimBook = (book: BookState): string => {
  const weth = Number(formatUnits(book.balBase, 18)).toLocaleString("en-US", { maximumFractionDigits: 3 })
  const usdc = Number(formatUnits(book.balQuote, 6)).toLocaleString("en-US", { maximumFractionDigits: 0 })
  return `${weth} WETH · ${usdc} USDC`
}
