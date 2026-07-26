import type { TapeIntel } from "~~/lib/jarvis/tapeIntel"
import type { JarvisSoul } from "./soul"
import {
  MAX_ADJUSTMENT,
  MAX_HEAL_K,
  MAX_HEAL_PREMIUM,
  MAX_LAMBDA,
  MIN_LAMBDA,
} from "./schema"

export type BranchScoreCtx = {
  label: string
  amountOut: string
  score: string
  postSkewE18: string
  isWinner: boolean
}

export type HealPathCtx = {
  usedScenarioBook: boolean
  startSkew: number
  endSkew: number
  healthy: boolean
  steps: {
    index: number
    sellBase: boolean
    amountHuman: string
    winnerLabel: string
    skewAfter: number
    poolVsMarkBpsAfter?: number
  }[]
}

export type ProposeMarketCtx = {
  amountIn: string
  sellBase: boolean
  balBase: string
  balQuote: string
  ethUsd1e18: string
  uniswapOut: string | null
  skewPct: number
  poolMidUsdcPerWeth: number | null
  markUsdPerEth: number | null
  poolVsMarkBps: number | null
  branches: BranchScoreCtx[]
  healPath: HealPathCtx | null
  principalEns: string | null
  addressAs: string
  tapeIntel?: TapeIntel | null
}

export function buildJarvisSystemPrompt(soul: JarvisSoul): string {
  return [
    soul.soul,
    `Address the user as "${soul.addressAs}" with no comma before it (e.g. "Certainly ${soul.addressAs}", never "Certainly, ${soul.addressAs}").`,
    `Voice tags: ${soul.voice}.`,
    `Role: ${soul.role}. Desk: ${soul.desk}. Capabilities: ${soul.capabilities}.`,
    "You retune Prime Desk heal parameters only. Never invent settlement amountOut.",
    "Use uniswapTape intel: CLASSIC is the fair AMM reference; BEST_PRICE may be UniswapX filler fantasy if fillerGapWide.",
    "If thinLiquidity or priceImpact is high, cut maxAdjustment. If edgeDeskVsClassicBps < -8, tighten heal/premium.",
    "Mention impact, route, and edge vs CLASSIC briefly in the spoken line.",
    "Output ONLY valid JSON with keys: healK, maxAdjustment, healPremium, lambda (as decimal integer strings in 1e18 / raw units), line (one spoken sentence in character).",
    `Hard caps: healK<=${MAX_HEAL_K}, maxAdjustment<=${MAX_ADJUSTMENT}, healPremium<=${MAX_HEAL_PREMIUM}, lambda in [${MIN_LAMBDA},${MAX_LAMBDA}].`,
  ].join("\n")
}

/** @deprecated use buildProposeUserPrompt */
export function buildJarvisUserPrompt(ctx: {
  amountIn: string
  sellBase: boolean
  balBase: string
  balQuote: string
  ethUsd1e18: string
  uniswapOut: string | null
  skewPct: number
}): string {
  return buildProposeUserPrompt({
    ...ctx,
    poolMidUsdcPerWeth: null,
    markUsdPerEth: null,
    poolVsMarkBps: null,
    branches: [],
    healPath: null,
    principalEns: null,
    addressAs: "sir",
    tapeIntel: null,
  })
}

export function buildProposeUserPrompt(ctx: ProposeMarketCtx): string {
  const t = ctx.tapeIntel
  return JSON.stringify(
    {
      trade: { amountIn: ctx.amountIn, sellBase: ctx.sellBase },
      book: { balBase: ctx.balBase, balQuote: ctx.balQuote, usdSkewPct: ctx.skewPct },
      ethUsd1e18: ctx.ethUsd1e18,
      pool: {
        midUsdcPerWeth: ctx.poolMidUsdcPerWeth,
        markUsdPerEth: ctx.markUsdPerEth,
        poolVsMarkBps: ctx.poolVsMarkBps,
      },
      uniswapTape: t
        ? {
            summary: t.summary,
            classicOut: t.classic?.amountOut ?? null,
            bestOut: t.best?.amountOut ?? null,
            priceImpactPct: t.priceImpactPct,
            gasFeeUSD: t.gasFeeUSD,
            routeString: t.routeString,
            feeTiers: t.feeTiers,
            hops: t.hops,
            edgeDeskVsClassicBps: t.edgeDeskVsClassicBps,
            bestVsClassicBps: t.bestVsClassicBps,
            thinLiquidity: t.thinLiquidity,
            fillerGapWide: t.fillerGapWide,
            blockNumber: t.blockNumber,
            auctionSoftBps: t.best?.auctionSoftBps ?? null,
          }
        : { available: false },
      liveBranches: ctx.branches,
      healPathPreview: ctx.healPath,
      principal: { ens: ctx.principalEns, addressAs: ctx.addressAs },
      task: "Propose healK, maxAdjustment, healPremium, lambda for THIS ticket using uniswapTape. One in-character line.",
    },
    null,
    0,
  )
}

export function buildCritiqueUserPrompt(args: {
  prior: ProposeMarketCtx
  priorParams: { healK: string; maxAdjustment: string; healPremium: string; lambda: string; line: string }
  edgeVsUniBps: number
}): string {
  return JSON.stringify(
    {
      priorMarket: {
        skewPct: args.prior.skewPct,
        uniswapOut: args.prior.uniswapOut,
        tapeSummary: args.prior.tapeIntel?.summary ?? null,
        branches: args.prior.branches,
      },
      priorParams: args.priorParams,
      critique: {
        edgeVsUniBps: args.edgeVsUniBps,
        issue: "Desk estimate trails Uniswap CLASSIC — tighten shade / premium while preserving heal intent.",
      },
      task: "Revise healK, maxAdjustment, healPremium, lambda and line. Output ONLY JSON.",
    },
    null,
    0,
  )
}

export function buildAdviseSystemPrompt(soul: JarvisSoul): string {
  return [
    soul.soul,
    `Address as "${soul.addressAs}" with no comma before it.`,
    `Voice: ${soul.voice}.`,
    "Advise on the ticket side and size for inventory heal vs Uniswap CLASSIC competitiveness.",
    "Output ONLY valid JSON: {\"line\":\"one spoken sentence\",\"preferSellBase\":true|false,\"reason\":\"short\"}.",
  ].join("\n")
}

export function buildAdviseUserPrompt(ctx: {
  amountIn: string
  sellBase: boolean
  skewPct: number
  balBase: string
  balQuote: string
  uniswapOut: string | null
  healHint: string
  principalEns: string | null
  tapeSummary?: string | null
}): string {
  return JSON.stringify({ ...ctx, task: "Advise the trade." }, null, 0)
}

export function buildHealNarrateSystemPrompt(soul: JarvisSoul): string {
  return [
    soul.soul,
    `Address as "${soul.addressAs}" with no comma before it.`,
    "Narrate a multi-swap inventory heal path for judges — concise, confident, no hype.",
    "Output ONLY valid JSON: {\"line\":\"2-4 spoken sentences covering the path\"}.",
  ].join("\n")
}

export function buildHealNarrateUserPrompt(ctx: HealPathCtx & { principalEns: string | null }): string {
  return JSON.stringify({ healPath: ctx, task: "Narrate the heal path." }, null, 0)
}
