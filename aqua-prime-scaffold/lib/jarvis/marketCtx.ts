/**
 * Shared market context for Jarvis propose / advise (server-side).
 */

import { midUsdcPerWeth } from "~~/lib/branchBook"
import { runHealPathSimulation } from "~~/lib/jarvis/healSim"
import type { HealPathCtx, ProposeMarketCtx } from "~~/lib/jarvis/prompt"
import type { TapeIntel } from "~~/lib/jarvis/tapeIntel"
import { simulateDeployedDesk } from "~~/lib/parityCheck"
import { usdSkewPct, type BookState } from "~~/lib/primeSim"

export function buildProposeMarketCtx(args: {
  amountIn: bigint
  sellBase: boolean
  book: BookState
  ethUsd1e18: bigint
  uniswapOut: bigint | null
  addressAs: string
  principalEns: string | null
  tapeIntel?: TapeIntel | null
}): ProposeMarketCtx {
  const skewPct = usdSkewPct(args.book, args.ethUsd1e18)
  const poolMid = midUsdcPerWeth(args.book.balBase, args.book.balQuote)
  const markUsd = args.ethUsd1e18 > 0n ? Number(args.ethUsd1e18) / 1e18 : null
  const poolVsMarkBps =
    poolMid != null && markUsd != null && markUsd > 0
      ? ((poolMid - markUsd) / markUsd) * 10_000
      : null

  const sim =
    args.amountIn > 0n
      ? simulateDeployedDesk(args.book, args.ethUsd1e18, args.amountIn, args.sellBase)
      : null

  const branches =
    sim?.branches.map((b, i) => ({
      label: b.label,
      amountOut: b.amountOut.toString(),
      score: b.score.toString(),
      postSkewE18: b.postSkewE18.toString(),
      isWinner: i === sim.winnerIndex,
    })) ?? []

  const heal = runHealPathSimulation({ book: args.book, ethUsd1e18: args.ethUsd1e18 })
  const healPath: HealPathCtx = {
    usedScenarioBook: heal.usedScenarioBook,
    startSkew: heal.startSkew,
    endSkew: heal.endSkew,
    healthy: heal.healthy,
    steps: heal.steps.map(s => ({
      index: s.index,
      sellBase: s.sellBase,
      amountHuman: s.amountHuman,
      winnerLabel: s.winnerLabel,
      skewAfter: s.skewAfter,
    })),
  }

  return {
    amountIn: args.amountIn.toString(),
    sellBase: args.sellBase,
    balBase: args.book.balBase.toString(),
    balQuote: args.book.balQuote.toString(),
    ethUsd1e18: args.ethUsd1e18.toString(),
    uniswapOut: args.uniswapOut?.toString() ?? null,
    skewPct,
    poolMidUsdcPerWeth: poolMid,
    markUsdPerEth: markUsd,
    poolVsMarkBps,
    branches,
    healPath,
    principalEns: args.principalEns,
    addressAs: args.addressAs,
    tapeIntel: args.tapeIntel ?? null,
  }
}

export function healHintFromSkew(skewPct: number, sellBase: boolean): string {
  if (Math.abs(skewPct) < 3) return "Book nearly balanced — either side fine at modest size."
  if (skewPct > 0) {
    return sellBase
      ? "Quote-heavy: selling WETH heals inventory."
      : "Quote-heavy: prefer Sell WETH to heal."
  }
  return sellBase
    ? "Base-heavy: prefer Buy WETH to heal."
    : "Base-heavy: buying WETH heals inventory."
}
