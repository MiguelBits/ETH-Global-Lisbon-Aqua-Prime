/** Format Uniswap Trade API exact-in outputs for HUD / speech. */

import { formatUnits } from "viem"

export const formatUniAmountOut = (
  amountOut: string | null | undefined,
  sellBase: boolean,
): string | null => {
  if (!amountOut) return null
  try {
    const n = Number(formatUnits(BigInt(amountOut), sellBase ? 6 : 18))
    if (!Number.isFinite(n)) return null
    const body = n.toLocaleString("en-US", {
      maximumFractionDigits: sellBase ? 2 : 6,
    })
    return `${body} ${sellBase ? "USDC" : "WETH"}`
  } catch {
    return null
  }
}

export const formatEdgeBps = (bps: number | null | undefined): string | null => {
  if (bps == null || !Number.isFinite(bps)) return null
  return `${bps > 0 ? "+" : ""}${bps.toFixed(1)} bps`
}
