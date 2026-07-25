/**
 * Thin Uniswap helpers — prefer `tapeIntel.ts` for Jarvis.
 * Kept for `/api/uniswap-quote` UI reference line.
 */

import { fetchTapeIntel, type TapeIntel } from "~~/lib/jarvis/tapeIntel"

export type UniswapRoutingPreference = "CLASSIC" | "BEST_PRICE"

export type UniswapQuoteResult =
  | {
      available: true
      amountOut: string
      routing: string
      gasFeeUSD: string | null
      hops: number | null
      priceImpactPct: number | null
      routeString: string | null
    }
  | { available: false; reason: string }

/** Exact-in quote via tape intel (CLASSIC by default). */
export async function fetchUniswapExactIn(args: {
  amountIn: string
  sellBase: boolean
  apiKey?: string
  routingPreference?: UniswapRoutingPreference
}): Promise<UniswapQuoteResult> {
  const intel = await fetchTapeIntel({
    amountIn: args.amountIn,
    sellBase: args.sellBase,
    apiKey: args.apiKey,
  })

  const preferBest = args.routingPreference === "BEST_PRICE"
  const leg = preferBest ? intel.best ?? intel.classic : intel.classic ?? intel.best
  if (!leg?.ok || !leg.amountOut) {
    return { available: false, reason: intel.reason ?? leg?.reason ?? "quote failed" }
  }

  return {
    available: true,
    amountOut: leg.amountOut,
    routing: leg.routing ?? (preferBest ? "BEST_PRICE" : "CLASSIC"),
    gasFeeUSD: leg.gasFeeUSD != null ? String(leg.gasFeeUSD) : null,
    hops: leg.hops || null,
    priceImpactPct: leg.priceImpactPct,
    routeString: leg.routeString,
  }
}

export const fetchClassicExactIn = (args: {
  amountIn: string
  sellBase: boolean
  apiKey?: string
}): Promise<UniswapQuoteResult> =>
  fetchUniswapExactIn({ ...args, routingPreference: "CLASSIC" })

/** @deprecated use fetchTapeIntel */
export async function fetchTicketTape(args: {
  amountIn: string
  sellBase: boolean
  apiKey?: string
}): Promise<{
  available: boolean
  reason?: string
  classicOut: string | null
  impactBps: number | null
  routing: "CLASSIC"
  gasFeeUSD: string | null
  hops: number | null
  priceImpactPct: number | null
  routeString: string | null
  intel: TapeIntel
}> {
  const intel = await fetchTapeIntel(args)
  return {
    available: intel.available,
    reason: intel.reason,
    classicOut: intel.classic?.amountOut ?? null,
    impactBps:
      intel.priceImpactPct != null ? Math.round(intel.priceImpactPct * -100) : null,
    routing: "CLASSIC",
    gasFeeUSD: intel.gasFeeUSD != null ? String(intel.gasFeeUSD) : null,
    hops: intel.hops || null,
    priceImpactPct: intel.priceImpactPct,
    routeString: intel.routeString,
    intel,
  }
}
