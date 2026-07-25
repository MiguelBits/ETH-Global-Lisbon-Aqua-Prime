import {
  DEPLOYED_LAMBDA,
  DEPLOYED_LP_PREMIUM,
  DEPLOYED_SKEW_K,
  DEPLOYED_SKEW_MAX,
  SKEW_ONE,
  usdSkewPct,
  type BookState,
} from "~~/lib/primeSim"
import type { TapeIntel } from "~~/lib/jarvis/tapeIntel"
import { roughXycOut } from "~~/lib/jarvis/tapeIntel"
import { clampDeskSet, type JarvisDeskSet } from "./schema"
import { stripCommaBeforeSir } from "./speech"

const EDGE_EPS = 8

export type FallbackInput = {
  book: BookState
  ethUsd1e18: bigint
  sellBase: boolean
  amountIn: bigint
  uniswapOut: bigint | null
  addressAs: string
  tape?: TapeIntel | null
}

/**
 * Simple local brain driven by TapeIntel (price impact, route thinness, edge).
 */
export function proposeLocal(input: FallbackInput): {
  params: JarvisDeskSet
  line: string
  edgeVsUniBps: number | null
} {
  const skewPct = usdSkewPct(input.book, input.ethUsd1e18) / 100
  const absSkew = Math.min(Math.abs(skewPct), 1)
  const tape = input.tape

  let healK = BigInt(Math.floor(Number(DEPLOYED_SKEW_K) * (0.35 + absSkew * 1.2)))
  let maxAdjustment = BigInt(Math.floor(Number(DEPLOYED_SKEW_MAX) * (0.5 + absSkew)))
  let healPremium = DEPLOYED_LP_PREMIUM
  let lambda = DEPLOYED_LAMBDA

  const healAligned =
    (skewPct > 0.02 && input.sellBase) || (skewPct < -0.02 && !input.sellBase)

  if (healAligned) {
    healK = (healK * 12n) / 10n
    lambda = (lambda * 12n) / 10n
    healPremium = (healPremium * 15n) / 10n
  } else if (absSkew < 0.05) {
    healK = healK / 2n
    lambda = (lambda * 8n) / 10n
  }

  // Thin Uniswap book → don't shade hard
  if (tape?.thinLiquidity) {
    maxAdjustment = (maxAdjustment * 65n) / 100n
    healK = (healK * 85n) / 100n
  }

  // Wide filler gap → trust CLASSIC only; stay conservative on premium
  if (tape?.fillerGapWide) {
    healPremium = (healPremium * 7n) / 10n
  }

  let edge = tape?.edgeDeskVsClassicBps ?? null
  if (edge == null && input.uniswapOut != null && input.uniswapOut > 0n) {
    const balIn = input.sellBase ? input.book.balBase : input.book.balQuote
    const balOut = input.sellBase ? input.book.balQuote : input.book.balBase
    const xyc = roughXycOut(balIn, balOut, input.amountIn)
    if (xyc > 0n) {
      edge = Number(((xyc - input.uniswapOut) * 10000n) / input.uniswapOut)
    }
  }

  if (edge != null && edge < -EDGE_EPS) {
    healK = (healK * 7n) / 10n
    maxAdjustment = (maxAdjustment * 7n) / 10n
    healPremium = healPremium / 2n
  }

  const params = clampDeskSet({ healK, maxAdjustment, healPremium, lambda })
  const sir = input.addressAs || "sir"
  const skewLabel = `${skewPct >= 0 ? "+" : ""}${(skewPct * 100).toFixed(1)}%`
  const edgeLabel =
    edge == null ? "tape n/a" : `${edge >= 0 ? "+" : ""}${edge.toFixed(0)} bps vs CLASSIC`
  const impact =
    tape?.priceImpactPct != null ? `impact ${tape.priceImpactPct.toFixed(2)}%` : "impact n/a"
  const route = tape?.routeString ? tape.routeString : "route n/a"

  const line =
    absSkew < 0.03
      ? `Certainly ${sir}. Book balanced · ${edgeLabel} · ${impact}. Knobs modest for this ticket.`
      : `Certainly ${sir}. Skew ${skewLabel} · ${edgeLabel} · ${impact} · ${route}. Knobs armed from Uniswap tape.`

  return { params, line: stripCommaBeforeSir(line), edgeVsUniBps: edge }
}

export function formatPct1e18(v: bigint): string {
  return `${((Number(v) / Number(SKEW_ONE)) * 100).toFixed(2)}%`
}
