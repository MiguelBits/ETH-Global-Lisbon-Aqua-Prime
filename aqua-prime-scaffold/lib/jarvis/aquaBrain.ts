/**
 * Shared Aqua desk brain for voice + suggestion chips.
 * Propose / advise / heal-sim prefer 0G; local heuristics remain as fallback.
 */

import { formatUnits } from "viem"
import { computeBestAction, type BestAction } from "~~/lib/bestAction"
import { evaluateOracleConvergence, type HealAction } from "~~/lib/healAction"
import { AQUA_SLEEP } from "./aquaSoul"
import { runHealPathSimulation, type HealSimResult, type HealSimStep } from "./healSim"
import {
  optimizeSizeSide,
  oracleBoundAdvice,
  pickBestRoute,
  type MakerSorPick,
} from "./makerSor"
import type { TapeIntel } from "./tapeIntel"
import { parseProposalJson, clampDeskSet, type JarvisProposal } from "./schema"
import { normalizeHeard, stripCommaBeforeSir } from "./speech"
import { usdSkewPct, type BookState } from "~~/lib/primeSim"

/** Same defaults the propose route used when the console had no live book. */
export const DEMO_BOOK: BookState = {
  balBase: 10n * 10n ** 18n,
  balQuote: 30_000n * 10n ** 6n,
}

export const DEMO_ETH_USD_1E18 = 3000n * 10n ** 18n
export const DEMO_AMOUNT_IN = 10n ** 18n

export type AquaBookSnapshot = {
  balBase: bigint
  balQuote: bigint
  ethUsd1e18: bigint
  amountIn: bigint
  sellBase: boolean
  source: "live" | "demo"
}

export type AquaBrainKind =
  | "sleep"
  | "identity"
  | "propose"
  | "book"
  | "explain"
  | "advise"
  | "simulate"
  | "route"
  | "optimize"
  | "action"
  | "execute"
  | "generic"

export type AquaBrainResult = {
  reply: string
  kind: AquaBrainKind
  proposal?: JarvisProposal
  healSim?: HealSimResult
  advise?: AdviseVerdict
  sorPick?: MakerSorPick
  bestAction?: BestAction
  healAction?: HealAction
}

export type AdviseVerdict = {
  line: string
  preferSellBase: boolean | null
  skewPct: number
  mode: "0g" | "local"
  uniswapOut: string | null
  uniswapAvailable: boolean
  tapeIntel?: TapeIntel | null
}

export type AquaBrainContext = {
  book: AquaBookSnapshot
  lastProposal: JarvisProposal | null
  principalEns?: string | null
  onProposeStart?: () => void
  onProposeResult?: (proposal: JarvisProposal | null) => void
  onHealSim?: (sim: HealSimResult) => void
  onAdviseStart?: () => void
  onAdviseResult?: (verdict: AdviseVerdict | null) => void
  onSorPick?: (pick: MakerSorPick) => void
  onBestAction?: (action: BestAction) => void
  onHealAction?: (action: HealAction) => void
}

const bookPayload = (book: AquaBookSnapshot, principalEns?: string | null) => ({
  amountIn: book.amountIn.toString(),
  sellBase: book.sellBase,
  balBase: book.balBase.toString(),
  balQuote: book.balQuote.toString(),
  ethUsd1e18: book.ethUsd1e18.toString(),
  principalEns: principalEns ?? null,
})

const narrateBook = (book: AquaBookSnapshot): string => {
  const skew = usdSkewPct({ balBase: book.balBase, balQuote: book.balQuote }, book.ethUsd1e18)
  const skewLabel = `${skew >= 0 ? "+" : ""}${skew.toFixed(0)}%`
  const posture =
    Math.abs(skew) < 3 ? "balanced" : skew > 0 ? "quote-heavy — sell WETH" : "base-heavy — buy WETH"
  return `Certainly sir. Skew ${skewLabel}, ${posture}.`
}

const adviseTradeLocal = (book: AquaBookSnapshot): string => {
  const skew = usdSkewPct({ balBase: book.balBase, balQuote: book.balQuote }, book.ethUsd1e18)

  if (Math.abs(skew) < 3) {
    return "Book is balanced sir. Best settings, then Execute."
  }
  if (skew > 0) {
    return "Quote-heavy sir. Prefer sell WETH to heal."
  }
  return "Base-heavy sir. Prefer buy WETH to heal."
}

const explainHeal = (proposal: JarvisProposal | null): string => {
  if (!proposal) {
    return "No proposal yet sir. Press Best settings first."
  }
  return `Certainly sir. Heal knobs armed ${proposal.mode === "0g" ? "via 0G" : "locally"}. Press Execute.`
}

export const fetchAquaProposal = async (
  book: AquaBookSnapshot,
  principalEns?: string | null,
): Promise<JarvisProposal> => {
  const res = await fetch("/api/jarvis/propose", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(bookPayload(book, principalEns)),
  })
  if (!res.ok) throw new Error("propose failed")
  const json = await res.json()
  const proposal = parseProposalJson(json)
  try {
    if (proposal.mode === "0g" && typeof window !== "undefined") {
      window.localStorage.setItem(
        "aqua.lastAttestation",
        JSON.stringify({
          agentEns: proposal.agentEns,
          attestation: proposal.params.attestation,
          model: proposal.modelUsed,
          at: Date.now(),
        }),
      )
    }
  } catch {
    /* ignore */
  }
  return proposal
}

const fetchAdvise = async (
  book: AquaBookSnapshot,
  principalEns?: string | null,
): Promise<AdviseVerdict> => {
  const skewPct = usdSkewPct({ balBase: book.balBase, balQuote: book.balQuote }, book.ethUsd1e18)
  const localFallback = (): AdviseVerdict => ({
    line: adviseTradeLocal(book),
    preferSellBase: skewPct > 3 ? true : skewPct < -3 ? false : null,
    skewPct,
    mode: "local",
    uniswapOut: null,
    uniswapAvailable: false,
    tapeIntel: null,
  })

  try {
    const res = await fetch("/api/jarvis/advise", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bookPayload(book, principalEns)),
    })
    if (!res.ok) return localFallback()
    const json = (await res.json()) as {
      line?: string
      preferSellBase?: boolean | null
      mode?: "0g" | "local"
      uniswapOut?: string | null
      uniswapAvailable?: boolean
      tapeIntel?: TapeIntel | null
    }
    const line = json.line && json.line.length > 8 ? json.line : adviseTradeLocal(book)
    return {
      line,
      preferSellBase:
        typeof json.preferSellBase === "boolean"
          ? json.preferSellBase
          : skewPct > 3
            ? true
            : skewPct < -3
              ? false
              : null,
      skewPct,
      mode: json.mode === "0g" ? "0g" : "local",
      uniswapOut: json.uniswapOut ?? null,
      uniswapAvailable: !!json.uniswapAvailable && !!json.uniswapOut,
      tapeIntel: json.tapeIntel ?? null,
    }
  } catch {
    return localFallback()
  }
}

const parseHealSimResponse = (json: {
  narrative: string
  sim: {
    usedScenarioBook: boolean
    startSkew: number
    endSkew: number
    healthy: boolean
    startBook: { balBase: string; balQuote: string }
    endBook: { balBase: string; balQuote: string }
    steps: {
      index: number
      sellBase: boolean
      amountHuman: string
      amountInWei: string
      amountOut: string
      winnerLabel: string
      skewBefore: number
      skewAfter: number
      params: {
        healK: string
        maxAdjustment: string
        healPremium: string
        lambda: string
        deadline: string
        attestation: string
      }
      balBaseAfter: string
      balQuoteAfter: string
      label: string
    }[]
  }
}): HealSimResult => {
  const steps: HealSimStep[] = json.sim.steps.map(s => {
    const row = s as typeof s & {
      poolVsMarkBpsBefore?: number
      poolVsMarkBpsAfter?: number
      midBefore?: number
      midAfter?: number
    }
    return {
      index: s.index,
      sellBase: s.sellBase,
      amountHuman: s.amountHuman,
      amountInWei: BigInt(s.amountInWei),
      amountOut: BigInt(s.amountOut),
      winnerLabel: s.winnerLabel,
      skewBefore: s.skewBefore,
      skewAfter: s.skewAfter,
      poolVsMarkBpsBefore: row.poolVsMarkBpsBefore ?? 0,
      poolVsMarkBpsAfter: row.poolVsMarkBpsAfter ?? 0,
      midBefore: row.midBefore ?? 0,
      midAfter: row.midAfter ?? 0,
      params: clampDeskSet({
        healK: BigInt(s.params.healK),
        maxAdjustment: BigInt(s.params.maxAdjustment),
        healPremium: BigInt(s.params.healPremium),
        lambda: BigInt(s.params.lambda),
        deadline: BigInt(s.params.deadline),
        attestation: s.params.attestation as `0x${string}`,
      }),
      balBaseAfter: BigInt(s.balBaseAfter),
      balQuoteAfter: BigInt(s.balQuoteAfter),
      label: s.label,
    }
  })
  const simExtra = json.sim as typeof json.sim & {
    startVsMarkBps?: number | null
    endVsMarkBps?: number | null
  }
  return {
    usedScenarioBook: json.sim.usedScenarioBook,
    startBook: {
      balBase: BigInt(json.sim.startBook.balBase),
      balQuote: BigInt(json.sim.startBook.balQuote),
    },
    endBook: {
      balBase: BigInt(json.sim.endBook.balBase),
      balQuote: BigInt(json.sim.endBook.balQuote),
    },
    startSkew: json.sim.startSkew,
    endSkew: json.sim.endSkew,
    startVsMarkBps: simExtra.startVsMarkBps ?? null,
    endVsMarkBps: simExtra.endVsMarkBps ?? null,
    steps,
    healthy: json.sim.healthy,
    narrative: json.narrative,
  }
}

const fetchHealSim = async (
  book: AquaBookSnapshot,
  principalEns?: string | null,
): Promise<HealSimResult> => {
  try {
    const res = await fetch("/api/jarvis/heal-sim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        balBase: book.balBase.toString(),
        balQuote: book.balQuote.toString(),
        ethUsd1e18: book.ethUsd1e18.toString(),
        principalEns: principalEns ?? null,
      }),
    })
    if (!res.ok) {
      return runHealPathSimulation({
        book: { balBase: book.balBase, balQuote: book.balQuote },
        ethUsd1e18: book.ethUsd1e18,
      })
    }
    return parseHealSimResponse(await res.json())
  } catch {
    return runHealPathSimulation({
      book: { balBase: book.balBase, balQuote: book.balQuote },
      ethUsd1e18: book.ethUsd1e18,
    })
  }
}

export const runAquaBrain = async (userText: string, ctx: AquaBrainContext): Promise<AquaBrainResult> => {
  const lower = normalizeHeard(userText)
  const out = (
    reply: string,
    kind: AquaBrainKind,
    extra?: {
      proposal?: JarvisProposal
      healSim?: HealSimResult
      advise?: AdviseVerdict
      sorPick?: MakerSorPick
      bestAction?: BestAction
      healAction?: HealAction
    },
  ): AquaBrainResult => ({
    reply: stripCommaBeforeSir(reply),
    kind,
    ...(extra?.proposal ? { proposal: extra.proposal } : {}),
    ...(extra?.healSim ? { healSim: extra.healSim } : {}),
    ...(extra?.advise ? { advise: extra.advise } : {}),
    ...(extra?.sorPick ? { sorPick: extra.sorPick } : {}),
    ...(extra?.bestAction ? { bestAction: extra.bestAction } : {}),
    ...(extra?.healAction ? { healAction: extra.healAction } : {}),
  })

  if (/stand by|go to sleep|goodnight|power down/.test(lower)) {
    return out(AQUA_SLEEP, "sleep")
  }

  if (/who are you|your name|what are you/.test(lower)) {
    return out(
      "I am Aqua sir — the desk intelligence for Prime. Soul and model tip come from ENS; I retune heal settings on 0G against the Uniswap tape.",
      "identity",
    )
  }

  if (/read the book|inventory|balances|skew/.test(lower) && !/tune|propose|heal knob/.test(lower)) {
    return out(narrateBook(ctx.book), "book")
  }

  if (/explain.*(heal|knob|param|setting)|heal knob/.test(lower)) {
    return out(explainHeal(ctx.lastProposal), "explain")
  }

  if (/advise|recommend|what (should|trade)|should i (sell|buy)|trade advice/.test(lower)) {
    ctx.onAdviseStart?.()
    const advise = await fetchAdvise(ctx.book, ctx.principalEns)
    const oracle = oracleBoundAdvice({
      book: { balBase: ctx.book.balBase, balQuote: ctx.book.balQuote },
      ethUsd1e18: ctx.book.ethUsd1e18,
      amountIn: ctx.book.amountIn,
      sellBase: ctx.book.sellBase,
      deskSet: ctx.lastProposal?.params ?? null,
    })
    const line = `${advise.line}${oracle.warn ? " Oracle band warning." : ""}`
    const enriched = { ...advise, line }
    ctx.onAdviseResult?.(enriched)
    return out(line, "advise", { advise: enriched })
  }

  if (
    (/heal action|do heal action/.test(lower) &&
      !/best (heal )?action|max(imize)? heal (surplus|edge)/.test(lower)) ||
    /do heal (trade|clip)/.test(lower)
  ) {
    const decision = evaluateOracleConvergence({
      book: { balBase: ctx.book.balBase, balQuote: ctx.book.balQuote },
      ethUsd1e18: ctx.book.ethUsd1e18,
    })
    if (decision.kind === "hold") {
      return out(`Certainly sir. Hold — ${decision.reason}.`, "action")
    }
    ctx.onHealAction?.(decision)
    const n = decision.steps.length
    return out(
      `Certainly sir. ${decision.narrative} Execute clip 1 of ${n}.`,
      "action",
      { healAction: decision },
    )
  }

  if (
    /best action|do best action|best heal (trade|action)|max(imize)? heal (surplus|edge)/.test(lower)
  ) {
    const action = computeBestAction(
      { balBase: ctx.book.balBase, balQuote: ctx.book.balQuote },
      ctx.book.ethUsd1e18,
    )
    if (!action) {
      return out("No best action on this book sir.", "action")
    }
    ctx.onBestAction?.(action)
    const edge =
      action.healEdgeBps > 0 ? ` · +${action.healEdgeBps.toFixed(0)} bps heal` : ""
    const side = action.sellBase
      ? `Sell ${action.amountHuman} WETH`
      : `Buy with ${action.amountHuman} USDC`
    return out(
      `Certainly sir. Best action: ${side}${edge}. Press Execute.`,
      "action",
      { bestAction: action },
    )
  }

  if (
    /best size|optimize (size|clip|ticket)|size (and|&|x|×) side|best clip|optimal (size|trade)/.test(
      lower,
    )
  ) {
    const pick = optimizeSizeSide({
      book: { balBase: ctx.book.balBase, balQuote: ctx.book.balQuote },
      ethUsd1e18: ctx.book.ethUsd1e18,
      deskSet: ctx.lastProposal?.params ?? null,
    })
    if (!pick) {
      return out(
        "I couldn't find a fundable size on this book sir — balances may be too thin for the ladder.",
        "optimize",
      )
    }
    ctx.onSorPick?.(pick)
    return out(pick.narrative, "optimize", { sorPick: pick })
  }

  if (
    /best route|pick (the )?best route|maker sor|score (the )?branch|which (branch|route)|route (the )?trade/.test(
      lower,
    )
  ) {
    if (ctx.book.amountIn === 0n) {
      return out("Set an amount on the ticket first sir — or say Best size to search the ladder.", "route")
    }
    const rawHuman = formatUnits(ctx.book.amountIn, ctx.book.sellBase ? 18 : 6)
    const amountHuman = Number(rawHuman).toLocaleString("en-US", {
      useGrouping: false,
      maximumFractionDigits: ctx.book.sellBase ? 4 : 2,
    })
    const pick = pickBestRoute({
      book: { balBase: ctx.book.balBase, balQuote: ctx.book.balQuote },
      ethUsd1e18: ctx.book.ethUsd1e18,
      amountIn: ctx.book.amountIn,
      amountHuman,
      sellBase: ctx.book.sellBase,
      deskSet: ctx.lastProposal?.params ?? null,
    })
    if (!pick) {
      return out("I couldn't score branches on this ticket sir — check book and amount.", "route")
    }
    ctx.onSorPick?.(pick)
    return out(pick.narrative, "route", { sorPick: pick })
  }

  if (
    /run (heal |the )?sim|heal path|heal (the )?pool|simulate (heal|swaps|path)|make (the )?pool healthy|until (the )?pool (is )?healthy/.test(
      lower,
    )
  ) {
    const sim = await fetchHealSim(ctx.book, ctx.principalEns)
    ctx.onHealSim?.(sim)
    return out(sim.narrative, "simulate", { healSim: sim })
  }

  // Best settings / propose BEFORE execute — "Uniswap" must not match /\bswap\b/.
  if (
    /best settings|tune( the)? desk|versus uniswap|propose|retune|heal (settings|knobs|params)|desk settings|parameters|lambda/.test(
      lower,
    )
  ) {
    if (ctx.book.amountIn === 0n) {
      return out("Set an amount on the ticket first sir — then press Best settings.", "advise")
    }
    ctx.onProposeStart?.()
    try {
      const proposal = await fetchAquaProposal(ctx.book, ctx.principalEns)
      ctx.onProposeResult?.(proposal)
      const mode = proposal.mode === "0g" ? "via 0G" : "locally"
      return out(
        `Certainly sir. Best settings armed ${mode}. Press Execute.`,
        "propose",
        { proposal },
      )
    } catch {
      ctx.onProposeResult?.(null)
      return out("Couldn't reach the desk model sir.", "propose")
    }
  }

  if (
    /\bexecute\b|\bcommit( desk)?\b|\bswap(\s+now)?\b|\bmetamask\b|send (the )?trade|do the (swap|trade)/.test(
      lower,
    )
  ) {
    if (!ctx.lastProposal) {
      return out("Best settings first sir, then Execute.", "execute")
    }
    return out("Armed sir. Press Execute.", "execute")
  }

  return out(
    "Ask Heal action, Best action, Best route, Best settings, or Execute sir.",
    "generic",
  )
}
