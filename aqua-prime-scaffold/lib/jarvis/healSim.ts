/**
 * Offline heal-path simulation: oracle-convergence clips until pool mid
 * is within ±50 bps of Chainlink (or the step budget is spent).
 */

import { formatUnits } from "viem"
import { evaluateOracleConvergence, type HealActionStep } from "~~/lib/healAction"
import {
  ORACLE_TARGET_BPS,
  snapshotPool,
  withinOracleTarget,
  type PoolSnapshot,
} from "~~/lib/poolState"
import { type BookState } from "~~/lib/primeSim"

export const HEALTHY_SKEW_PCT = 3
export const HEAL_SIM_MAX_STEPS = 6
export const HEAL_SIM_TARGET_STEPS = 3

export type HealSimStep = {
  index: number
  sellBase: boolean
  amountHuman: string
  amountInWei: bigint
  amountOut: bigint
  winnerLabel: string
  skewBefore: number
  skewAfter: number
  poolVsMarkBpsBefore: number
  poolVsMarkBpsAfter: number
  midBefore: number
  midAfter: number
  /** Desk params are not retuned per clip in the oracle planner — empty stub for UI. */
  params: {
    healK: bigint
    maxAdjustment: bigint
    healPremium: bigint
    lambda: bigint
    deadline: bigint
    attestation: `0x${string}`
  }
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
  startVsMarkBps: number | null
  endVsMarkBps: number | null
  steps: HealSimStep[]
  healthy: boolean
  narrative: string
}

const EMPTY_PARAMS: HealSimStep["params"] = {
  healK: 5n * 10n ** 17n,
  maxAdjustment: 10n ** 17n,
  healPremium: 5n * 10n ** 15n,
  lambda: 1_000_000_000n,
  deadline: 0n,
  attestation: "0x0000000000000000000000000000000000000000000000000000000000000000",
}

const fromActionStep = (s: HealActionStep): HealSimStep => ({
  index: s.index,
  sellBase: s.sellBase,
  amountHuman: s.amountHuman,
  amountInWei: s.amountInWei,
  amountOut: s.expectedOut,
  winnerLabel: s.winnerLabel,
  skewBefore: s.skewBefore,
  skewAfter: s.skewAfter,
  poolVsMarkBpsBefore: s.poolVsMarkBpsBefore,
  poolVsMarkBpsAfter: s.poolVsMarkBpsAfter,
  midBefore: s.midBefore,
  midAfter: s.midAfter,
  params: EMPTY_PARAMS,
  balBaseAfter: s.balBaseAfter,
  balQuoteAfter: s.balQuoteAfter,
  label: s.label,
})

/**
 * Live-book oracle convergence plan. Never substitutes a synthetic book for execution.
 */
export const runHealPathSimulation = (args: {
  book: BookState
  ethUsd1e18: bigint
}): HealSimResult => {
  const ethUsd1e18 = args.ethUsd1e18 > 0n ? args.ethUsd1e18 : 3000n * 10n ** 18n
  const startBook = { ...args.book }
  const start: PoolSnapshot = snapshotPool(startBook, ethUsd1e18)

  const decision = evaluateOracleConvergence({ book: startBook, ethUsd1e18 })

  if (decision.kind === "hold") {
    const healthy = withinOracleTarget(start.vsMarkBps)
    return {
      usedScenarioBook: false,
      startBook,
      endBook: startBook,
      startSkew: start.skewPct,
      endSkew: start.skewPct,
      startVsMarkBps: start.vsMarkBps,
      endVsMarkBps: start.vsMarkBps,
      steps: [],
      healthy,
      narrative: healthy
        ? `Certainly sir. Pool already within ${ORACLE_TARGET_BPS} bps of Chainlink — no heal clip.`
        : `Certainly sir. Hold — ${decision.reason}.`,
    }
  }

  const steps = decision.steps.map(fromActionStep)
  const last = steps[steps.length - 1]!
  const endBook = { balBase: last.balBaseAfter, balQuote: last.balQuoteAfter }
  const end = snapshotPool(endBook, ethUsd1e18)
  const healthy = withinOracleTarget(end.vsMarkBps)

  return {
    usedScenarioBook: false,
    startBook,
    endBook,
    startSkew: start.skewPct,
    endSkew: end.skewPct,
    startVsMarkBps: start.vsMarkBps,
    endVsMarkBps: end.vsMarkBps,
    steps,
    healthy,
    narrative: `Certainly sir. ${decision.narrative} Press Execute for clip 1 of ${steps.length}.`,
  }
}

export const formatHealSimBook = (book: BookState): string => {
  const weth = Number(formatUnits(book.balBase, 18)).toLocaleString("en-US", { maximumFractionDigits: 3 })
  const usdc = Number(formatUnits(book.balQuote, 6)).toLocaleString("en-US", { maximumFractionDigits: 0 })
  return `${weth} WETH · ${usdc} USDC`
}

/** Materialize a HealAction plan into the heal-sim panel shape. */
export const healActionToSim = (
  action: import("~~/lib/healAction").HealAction,
  startBook: BookState,
): HealSimResult => {
  const steps = action.steps.map(fromActionStep)
  const last = steps[steps.length - 1]!
  return {
    usedScenarioBook: false,
    startBook: { ...startBook },
    endBook: { balBase: last.balBaseAfter, balQuote: last.balQuoteAfter },
    startSkew: action.skewBefore,
    endSkew: last.skewAfter,
    startVsMarkBps: action.startVsMarkBps,
    endVsMarkBps: action.endVsMarkBps,
    steps,
    healthy: action.withinTarget,
    narrative: action.narrative,
  }
}
