/**
 * Pure self-check for tape intel parsers (no network).
 * Run: npx --yes tsx lib/jarvis/tapeIntel.selfcheck.ts
 */

import { parseQuoteJson, roughXycOut } from "./tapeIntel"

const assert = (cond: boolean, msg: string) => {
  if (!cond) throw new Error(msg)
}

const classic = parseQuoteJson(
  {
    routing: "CLASSIC",
    blockNumber: "22000000",
    quote: {
      output: { amount: "3000000000" },
      priceImpact: 0.42,
      gasFeeUSD: "0.85",
      routeString: "[V3] 100% = WETH -- 0.05% USDC",
      route: [
        [
          {
            type: "v3-pool",
            fee: "500",
            amountOut: "3000000000",
          },
        ],
      ],
    },
  },
  "CLASSIC",
)

assert(classic.ok, "classic ok")
assert(classic.amountOut === "3000000000", "amountOut")
assert(classic.priceImpactPct === 0.42, "priceImpact")
assert(classic.gasFeeUSD === 0.85, "gas")
assert(classic.feeTiers.includes(500), "fee tier")
assert(classic.hops === 1, "hops")
assert(!!classic.routeString?.includes("0.05%"), "routeString")

const ux = parseQuoteJson(
  {
    routing: "DUTCH_V2",
    quote: {
      orderInfo: {
        outputs: [{ startAmount: "3010000000", endAmount: "2990000000" }],
      },
    },
  },
  "BEST_PRICE",
)
assert(ux.ok, "ux ok")
assert(ux.auctionSoftBps != null && ux.auctionSoftBps > 0, "auction soft bps")

const xyc = roughXycOut(10n ** 18n, 30_000n * 10n ** 6n, 10n ** 18n)
assert(xyc > 0n, "xyc out")

console.log("tapeIntel.selfcheck: ok")
