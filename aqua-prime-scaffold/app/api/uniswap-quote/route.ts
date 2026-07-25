import { NextRequest, NextResponse } from "next/server"
import { fetchTapeIntel } from "~~/lib/jarvis/tapeIntel"
import { fetchUniswapExactIn } from "~~/lib/jarvis/uniswap"

/**
 * Uniswap reference quote for UI.
 * Default: full tape intel (CLASSIC + BEST). Pass preference=CLASSIC|BEST_PRICE for a single leg.
 */
export async function GET(req: NextRequest) {
  const sellBase = req.nextUrl.searchParams.get("sellBase") !== "false"
  const amountIn = req.nextUrl.searchParams.get("amountIn") ?? "1000000000000000000"
  const preference = req.nextUrl.searchParams.get("preference")
  const wantIntel = req.nextUrl.searchParams.get("intel") !== "0"

  if (wantIntel && !preference) {
    const intel = await fetchTapeIntel({ sellBase, amountIn })
    if (!intel.available) {
      return NextResponse.json({ available: false, reason: intel.reason, tapeIntel: intel })
    }
    return NextResponse.json({
      available: true,
      amountOut: intel.classic?.amountOut ?? null,
      routing: intel.classic?.routing ?? "CLASSIC",
      priceImpactPct: intel.priceImpactPct,
      gasFeeUSD: intel.gasFeeUSD,
      routeString: intel.routeString,
      feeTiers: intel.feeTiers,
      hops: intel.hops,
      bestVsClassicBps: intel.bestVsClassicBps,
      thinLiquidity: intel.thinLiquidity,
      fillerGapWide: intel.fillerGapWide,
      summary: intel.summary,
      tapeIntel: intel,
      network: "mainnet-reference",
      sellBase,
      tokenIn: sellBase ? "WETH" : "USDC",
      tokenOut: sellBase ? "USDC" : "WETH",
    })
  }

  const result = await fetchUniswapExactIn({
    sellBase,
    amountIn,
    routingPreference: preference === "BEST_PRICE" ? "BEST_PRICE" : "CLASSIC",
  })
  if (!result.available) {
    return NextResponse.json({ available: false, reason: result.reason })
  }
  return NextResponse.json({
    available: true,
    amountOut: result.amountOut,
    routing: result.routing,
    gasFeeUSD: result.gasFeeUSD,
    hops: result.hops,
    priceImpactPct: result.priceImpactPct,
    routeString: result.routeString,
    network: "mainnet-reference",
    sellBase,
    tokenIn: sellBase ? "WETH" : "USDC",
    tokenOut: sellBase ? "USDC" : "WETH",
  })
}
