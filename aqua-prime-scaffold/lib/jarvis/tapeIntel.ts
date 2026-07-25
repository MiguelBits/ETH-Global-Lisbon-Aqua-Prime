/**
 * Simple Uniswap → Jarvis tape intel.
 * Two quotes (CLASSIC + BEST_PRICE), parse rich fields, one object for the AI.
 */

const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
const QUOTE_URL = "https://trade-api.gateway.uniswap.org/v1/quote"

export type UniLeg = {
  ok: boolean
  reason?: string
  amountOut: string | null
  routing: string | null
  priceImpactPct: number | null
  gasFeeUSD: number | null
  routeString: string | null
  feeTiers: number[]
  hops: number
  blockNumber: string | null
  auctionStartOut: string | null
  auctionEndOut: string | null
  auctionSoftBps: number | null
}

/** Flat intel pack — what Jarvis / 0G should reason over. */
export type TapeIntel = {
  available: boolean
  reason?: string
  classic: UniLeg | null
  best: UniLeg | null
  edgeDeskVsClassicBps: number | null
  bestVsClassicBps: number | null
  priceImpactPct: number | null
  gasFeeUSD: number | null
  routeString: string | null
  feeTiers: number[]
  hops: number
  blockNumber: string | null
  /** High impact, multi-hop, or high fee tier */
  thinLiquidity: boolean
  /** BEST_PRICE much richer than CLASSIC — filler fantasy */
  fillerGapWide: boolean
  /** One line for prompts / UI */
  summary: string
}

type QuoteJson = {
  routing?: string
  blockNumber?: string | number
  quote?: {
    output?: { amount?: string }
    priceImpact?: string | number
    gasFeeUSD?: string | number
    gasUseEstimate?: string | number
    routeString?: string
    route?: unknown
    blockNumber?: string | number
    orderInfo?: {
      outputs?: { startAmount?: string; endAmount?: string }[]
    }
  }
  // Some gateways put fields at top level
  priceImpact?: string | number
  gasFeeUSD?: string | number
  routeString?: string
  route?: unknown
}

const toNum = (v: unknown): number | null => {
  if (v == null) return null
  const n = typeof v === "number" ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

const emptyLeg = (reason: string): UniLeg => ({
  ok: false,
  reason,
  amountOut: null,
  routing: null,
  priceImpactPct: null,
  gasFeeUSD: null,
  routeString: null,
  feeTiers: [],
  hops: 0,
  blockNumber: null,
  auctionStartOut: null,
  auctionEndOut: null,
  auctionSoftBps: null,
})

const extractFeeTiers = (route: unknown): number[] => {
  const tiers: number[] = []
  const walk = (node: unknown) => {
    if (!node) return
    if (Array.isArray(node)) {
      for (const x of node) walk(x)
      return
    }
    if (typeof node !== "object") return
    const o = node as Record<string, unknown>
    if (o.fee != null) {
      const f = Number(o.fee)
      if (Number.isFinite(f)) tiers.push(f)
    }
    for (const v of Object.values(o)) {
      if (v && typeof v === "object") walk(v)
    }
  }
  walk(route)
  return [...new Set(tiers)]
}

const countHops = (route: unknown): number => {
  if (!Array.isArray(route)) return 0
  // route is often array of paths; each path is array of pools
  if (route.length === 0) return 0
  if (Array.isArray(route[0])) {
    return Math.max(...route.map((p: unknown) => (Array.isArray(p) ? p.length : 0)), 0)
  }
  return route.length
}

export const parseQuoteJson = (data: QuoteJson, fallbackRouting: string): UniLeg => {
  const q = data.quote
  const classicOut = q?.output?.amount ?? null
  const uxStart = q?.orderInfo?.outputs?.[0]?.startAmount ?? null
  const uxEnd = q?.orderInfo?.outputs?.[0]?.endAmount ?? null
  const amountOut = classicOut ?? uxStart
  if (!amountOut) return emptyLeg("missing amountOut")

  const priceImpactPct = toNum(q?.priceImpact ?? data.priceImpact)
  const gasFeeUSD = toNum(q?.gasFeeUSD ?? data.gasFeeUSD)
  const routeString =
    (typeof q?.routeString === "string" && q.routeString) ||
    (typeof data.routeString === "string" && data.routeString) ||
    null
  const route = q?.route ?? data.route
  const feeTiers = extractFeeTiers(route)
  const hops = countHops(route)
  const blockRaw = q?.blockNumber ?? data.blockNumber
  const blockNumber = blockRaw != null ? String(blockRaw) : null

  let auctionSoftBps: number | null = null
  if (uxStart && uxEnd) {
    const s = BigInt(uxStart)
    const e = BigInt(uxEnd)
    if (s > 0n) auctionSoftBps = Number(((s - e) * 10000n) / s)
  }

  return {
    ok: true,
    amountOut,
    routing: data.routing ?? fallbackRouting,
    priceImpactPct,
    gasFeeUSD,
    routeString,
    feeTiers,
    hops,
    blockNumber,
    auctionStartOut: uxStart,
    auctionEndOut: uxEnd,
    auctionSoftBps,
  }
}

async function fetchLeg(
  args: {
    amountIn: string
    sellBase: boolean
    preference: "CLASSIC" | "BEST_PRICE"
    apiKey: string
  },
): Promise<UniLeg> {
  const tokenIn = args.sellBase ? WETH : USDC
  const tokenOut = args.sellBase ? USDC : WETH
  try {
    const res = await fetch(QUOTE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": args.apiKey,
        "x-universal-router-version": "2.0",
      },
      body: JSON.stringify({
        tokenInChainId: "1",
        tokenOutChainId: "1",
        tokenIn,
        tokenOut,
        amount: args.amountIn,
        type: "EXACT_INPUT",
        swapper: "0x0000000000000000000000000000000000000001",
        routingPreference: args.preference,
      }),
    })
    if (!res.ok) return emptyLeg(`HTTP ${res.status}: ${await res.text()}`)
    const data = (await res.json()) as QuoteJson
    return parseQuoteJson(data, args.preference)
  } catch (e) {
    return emptyLeg(e instanceof Error ? e.message : "quote failed")
  }
}

const edgeBps = (deskOut: bigint, uniOut: string | null): number | null => {
  if (!uniOut) return null
  const u = BigInt(uniOut)
  if (u <= 0n || deskOut <= 0n) return null
  return Number(((deskOut - u) * 10000n) / u)
}

const buildSummary = (t: Omit<TapeIntel, "summary">): string => {
  if (!t.available || !t.classic?.ok) {
    return `Uniswap tape unavailable${t.reason ? `: ${t.reason}` : ""}.`
  }
  const parts = [
    `CLASSIC out=${t.classic.amountOut}`,
    t.priceImpactPct != null ? `impact=${t.priceImpactPct}%` : null,
    t.gasFeeUSD != null ? `gas≈$${t.gasFeeUSD.toFixed(4)}` : null,
    t.routeString ? `route=${t.routeString}` : null,
    t.edgeDeskVsClassicBps != null
      ? `deskEdge=${t.edgeDeskVsClassicBps >= 0 ? "+" : ""}${t.edgeDeskVsClassicBps.toFixed(0)}bps`
      : null,
    t.bestVsClassicBps != null
      ? `bestVsClassic=${t.bestVsClassicBps >= 0 ? "+" : ""}${t.bestVsClassicBps.toFixed(0)}bps`
      : null,
    t.thinLiquidity ? "flag=THIN" : "flag=OK",
    t.fillerGapWide ? "flag=FILLER_GAP" : null,
  ].filter(Boolean)
  return parts.join(" · ")
}

/**
 * Fetch CLASSIC + BEST_PRICE for this ticket and build AI-ready intel.
 * deskOut = simulated desk amountOut for the same ticket (optional).
 */
export async function fetchTapeIntel(args: {
  amountIn: string
  sellBase: boolean
  deskOut?: bigint | null
  apiKey?: string
}): Promise<TapeIntel> {
  const apiKey = args.apiKey ?? process.env.UNISWAP_API_KEY
  if (!apiKey) {
    return {
      available: false,
      reason: "UNISWAP_API_KEY not set",
      classic: null,
      best: null,
      edgeDeskVsClassicBps: null,
      bestVsClassicBps: null,
      priceImpactPct: null,
      gasFeeUSD: null,
      routeString: null,
      feeTiers: [],
      hops: 0,
      blockNumber: null,
      thinLiquidity: false,
      fillerGapWide: false,
      summary: "Uniswap tape unavailable: no API key.",
    }
  }

  if (BigInt(args.amountIn || "0") <= 0n) {
    return {
      available: false,
      reason: "amountIn is zero",
      classic: null,
      best: null,
      edgeDeskVsClassicBps: null,
      bestVsClassicBps: null,
      priceImpactPct: null,
      gasFeeUSD: null,
      routeString: null,
      feeTiers: [],
      hops: 0,
      blockNumber: null,
      thinLiquidity: false,
      fillerGapWide: false,
      summary: "Uniswap tape unavailable: zero size.",
    }
  }

  const [classic, best] = await Promise.all([
    fetchLeg({
      amountIn: args.amountIn,
      sellBase: args.sellBase,
      preference: "CLASSIC",
      apiKey,
    }),
    fetchLeg({
      amountIn: args.amountIn,
      sellBase: args.sellBase,
      preference: "BEST_PRICE",
      apiKey,
    }),
  ])

  const edgeDeskVsClassicBps =
    args.deskOut != null && classic.ok
      ? edgeBps(args.deskOut, classic.amountOut)
      : null

  let bestVsClassicBps: number | null = null
  if (classic.ok && best.ok && classic.amountOut && best.amountOut) {
    const c = BigInt(classic.amountOut)
    const b = BigInt(best.amountOut)
    if (c > 0n) bestVsClassicBps = Number(((b - c) * 10000n) / c)
  }

  const priceImpactPct = classic.priceImpactPct ?? best.priceImpactPct
  const feeTiers = classic.feeTiers.length ? classic.feeTiers : best.feeTiers
  const hops = classic.hops || best.hops
  const highFee = feeTiers.some(f => f >= 3000)
  const thinLiquidity =
    (priceImpactPct != null && priceImpactPct >= 0.35) || hops > 1 || highFee
  const fillerGapWide = bestVsClassicBps != null && bestVsClassicBps > 15

  const base: Omit<TapeIntel, "summary"> = {
    available: classic.ok,
    reason: classic.ok ? undefined : classic.reason,
    classic: classic.ok ? classic : null,
    best: best.ok ? best : null,
    edgeDeskVsClassicBps,
    bestVsClassicBps,
    priceImpactPct,
    gasFeeUSD: classic.gasFeeUSD ?? best.gasFeeUSD,
    routeString: classic.routeString ?? best.routeString,
    feeTiers,
    hops,
    blockNumber: classic.blockNumber ?? best.blockNumber,
    thinLiquidity,
    fillerGapWide,
  }

  return { ...base, summary: buildSummary(base) }
}

/** Rough XYC desk out for edge when full sim not available. */
export const roughXycOut = (
  balIn: bigint,
  balOut: bigint,
  amountIn: bigint,
): bigint => {
  if (balIn <= 0n || amountIn <= 0n) return 0n
  return (amountIn * balOut) / (balIn + amountIn)
}
