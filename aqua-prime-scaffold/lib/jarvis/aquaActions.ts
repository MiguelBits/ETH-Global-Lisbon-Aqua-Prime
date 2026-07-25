/** Showcase suggestion chips for /jarvis — click path matches spoken utterances. */

export type AquaActionWhen = "asleep" | "awake" | "afterPropose" | "always"

export type AquaAction = {
  id: string
  label: string
  utterance: string
  when: AquaActionWhen
  /** Plain-language hover tip for judges. */
  tip: string
  /** When set, chip navigates instead of speaking. */
  href?: string
}

export const AQUA_ACTIONS: AquaAction[] = [
  {
    id: "wake",
    label: "Wake Aqua",
    utterance: "aqua wake up",
    when: "asleep",
    tip: "Power up the desk agent so you can talk, tune, and trade.",
  },
  {
    id: "read-book",
    label: "Read the book",
    utterance: "read the book",
    when: "awake",
    tip: "Show WETH/USDC inventory and whether the book is balanced or skewed.",
  },
  {
    id: "advise-trade",
    label: "Advise trade",
    utterance: "advise on the trade",
    when: "awake",
    tip: "Ask which side heals the book, with Chainlink oracle band. Still need Best settings before Execute.",
  },
  {
    id: "best-action",
    label: "Best action",
    utterance: "do best action",
    when: "awake",
    tip: "Same as /desk: pick size × side that maximizes HEAL surplus over BASELINE, set the ticket, arm Best settings.",
  },
  {
    id: "best-route",
    label: "Best route",
    utterance: "pick the best route",
    when: "awake",
    tip: "Score BASELINE vs HEAL vs ORACLE (ref) with maker SOR: amountOut − λ·post-skew. Arms the live winner path.",
  },
  {
    id: "best-size",
    label: "Best size",
    utterance: "best size and side",
    when: "awake",
    tip: "Search WETH/USDC size ladder × side for max maker score, then set the ticket.",
  },
  {
    id: "heal-sim",
    label: "Run heal sim",
    utterance: "run heal sim until the pool is healthy",
    when: "awake",
    tip: "Walk 3–4 heal swaps until skew is healthy, then arm Best settings + MetaMask clip-by-clip.",
  },
  {
    id: "tune-desk",
    label: "Best settings",
    utterance: "best settings versus Uniswap",
    when: "awake",
    tip: "0G retunes heal knobs vs the Uniswap tape and arms the desk set for Execute.",
  },
  {
    id: "execute",
    label: "Execute",
    utterance: "execute the trade",
    when: "afterPropose",
    tip: "Commit the retuned desk on-chain (dock/ship) and run the swap in MetaMask.",
  },
  {
    id: "explain-heal",
    label: "Explain heal knobs",
    utterance: "explain the heal knobs",
    when: "afterPropose",
    tip: "Speak the current healK, maxAdj, λ, and premium in plain English.",
  },
  {
    id: "standby",
    label: "Stand by",
    utterance: "stand by",
    when: "awake",
    tip: "Put Aqua to sleep and hide the HUD panels.",
  },
]

export type AquaChipContext = {
  awake: boolean
  hasProposal: boolean
}

export const visibleAquaActions = (ctx: AquaChipContext): AquaAction[] =>
  AQUA_ACTIONS.filter(a => {
    if (a.when === "asleep") return !ctx.awake
    if (a.when === "awake") return ctx.awake
    if (a.when === "afterPropose") return ctx.awake && ctx.hasProposal
    if (a.when === "always") return true
    return false
  })

/** Chip to pulse after wake so judges see the demo path. */
export const NEXT_DEMO_CHIP_ID = "tune-desk"

/** Chip to pulse after best settings land — go execute, don't re-tune. */
export const AFTER_PROPOSE_CHIP_ID = "execute"
