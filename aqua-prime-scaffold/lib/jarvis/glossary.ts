/** Plain-language desk glossary for hover tips on /jarvis. */

import {
  PRICING_METHODS,
  PRICING_PARAMS,
  SELECTOR_EXPLAIN,
} from "~~/lib/jarvis/pricingExplain"

export type GlossaryEntry = {
  /** Canonical id */
  id: string
  /** Display label (short) */
  label: string
  /** Match patterns (longest first when building the regex) */
  aliases: string[]
  /** One dumbed-down sentence */
  tip: string
  /** Optional formula line shown under the tip */
  formula?: string
}

export const AQUA_GLOSSARY: GlossaryEntry[] = [
  {
    id: "skew",
    label: "skew",
    aliases: ["post-skew", "usd skew", "inventory skew", "skew"],
    tip: "USD lopsidedness of the book: (vOut − vIn) / (vOut + vIn). Positive ≈ too much USDC; negative ≈ too much WETH. Post-skew is that value after the simulated trade.",
    formula: "usdSkew = (valueOut − valueIn) / (valueOut + valueIn)  ∈ [−1, +1]",
  },
  {
    id: "quote",
    label: "quote",
    aliases: ["quote-heavy", "USDC-heavy", "quote"],
    tip: "The cash-like side of the pair (here USDC). Quote-heavy means the book is stuffed with USDC relative to WETH.",
  },
  {
    id: "base",
    label: "base",
    aliases: ["base-heavy", "WETH-heavy", "base"],
    tip: "The risky / primary asset in the pair (here WETH). Base-heavy means too much WETH sitting in the book.",
  },
  {
    id: "book",
    label: "book",
    aliases: ["live book", "demo book", "scenario book", "the book", "book"],
    tip: "The maker’s inventory — virtual WETH/USDC balances shipped on Aqua. Tokens stay in the wallet until a swap pulls them.",
  },
  {
    id: "heal",
    label: "HEAL",
    aliases: ["inventory heal", "heal path", "heal sim", "healK", "heal k", "HEAL", "heal"],
    tip: PRICING_METHODS.HEAL.tip,
    formula: PRICING_METHODS.HEAL.formula,
  },
  {
    id: "baseline",
    label: "BASELINE",
    aliases: ["BASELINE", "baseline"],
    tip: PRICING_METHODS.BASELINE.tip,
    formula: PRICING_METHODS.BASELINE.formula,
  },
  {
    id: "xyc",
    label: "XYC",
    aliases: ["XYC", "xyc", "constant product"],
    tip: PRICING_METHODS.XYC.tip,
    formula: PRICING_METHODS.XYC.formula,
  },
  {
    id: "oracle",
    label: "ORACLE",
    aliases: ["ORACLE", "oracle band", "oracle"],
    tip: PRICING_METHODS.ORACLE.tip,
    formula: PRICING_METHODS.ORACLE.formula,
  },
  {
    id: "lambda",
    label: "λ",
    aliases: ["lambda", "λ"],
    tip: PRICING_PARAMS.lambda.tip,
    formula: PRICING_PARAMS.lambda.formula,
  },
  {
    id: "maxAdj",
    label: "maxAdj",
    aliases: ["maxAdj", "max adj", "maxAdjustment", "max adjustment"],
    tip: PRICING_PARAMS.maxAdj.tip,
    formula: PRICING_PARAMS.maxAdj.formula,
  },
  {
    id: "premium",
    label: "premium",
    aliases: ["heal premium", "healPremium", "premium"],
    tip: PRICING_PARAMS.premium.tip,
    formula: PRICING_PARAMS.premium.formula,
  },
  {
    id: "oracleBand",
    label: "oracleBand",
    aliases: ["oracleBand", "maxPriceDecay", "price decay"],
    tip: PRICING_PARAMS.oracleBand.tip,
    formula: PRICING_PARAMS.oracleBand.formula,
  },
  {
    id: "tape",
    label: "tape",
    aliases: ["Uniswap tape", "uni tape", "tape"],
    tip: "Live Uniswap Trade API quote for the same size — Jarvis’s fair tape so heal knobs stay competitive vs mainnet mid.",
  },
  {
    id: "ticket",
    label: "ticket",
    aliases: ["ticket"],
    tip: "The trade you’re about to do — side (sell/buy WETH) and size. Feeds every branch simulation.",
  },
  {
    id: "desk",
    label: "desk",
    aliases: ["desk set", "desk"],
    tip: "On-chain parameter pack: healK, maxAdj, premium, λ, deadline, attestation. Committed via stage → dock → ship → finalize.",
  },
  {
    id: "attestation",
    label: "attestation",
    aliases: ["attestation", "attest"],
    tip: "Fingerprint of the 0G model reply — keccak of the inference, stored in DeskSetCommitted and optional ENS agent.attestation.",
  },
  {
    id: "ens",
    label: "ENS",
    aliases: ["ENS", "agent ens", "principal"],
    tip: "Ethereum Name Service — human names for the agent, desk, and your wallet.",
  },
  {
    id: "mark",
    label: "mark",
    aliases: ["mark", "Chainlink"],
    tip: "Chainlink ETH/USD used to value WETH for USD-skew and to cap quotes at fair ± premium.",
  },
  {
    id: "pool",
    label: "pool",
    aliases: ["XYC pool", "pool mid", "pool"],
    tip: "Virtual AMM balances that set the desk mid (USDC per WETH) before any heal/oracle adjuster.",
  },
  {
    id: "edge",
    label: "edge",
    aliases: ["edge vs uni", "edge"],
    tip: "How Aqua’s quote compares to Uniswap for the same ticket — positive means Aqua looks better for the trader.",
  },
  {
    id: "route",
    label: "route",
    aliases: ["PrimeSelector", "Maker SOR", "best route", "route", "winner", "score"],
    tip: "Maker smart order routing: score = amountOut − λ·|post-skew|. Live desk races BASELINE vs HEAL; ORACLE is a Chainlink-band reference.",
    formula: SELECTOR_EXPLAIN.formula,
  },
  {
    id: "bestSize",
    label: "best size",
    aliases: ["Best size", "best size", "size ladder"],
    tip: "Jarvis searches WETH/USDC sizes on both sides and picks the ticket with the best maker SOR score (heal-biased near ties).",
  },
  {
    id: "bestAction",
    label: "best action",
    aliases: ["Best action", "best action", "do best action"],
    tip: "Desk best-action: size × side that maximizes HEAL surplus over BASELINE (extra output vs the k≈0 branch).",
  },
  {
    id: "0g",
    label: "0G",
    aliases: ["0G", "0g"],
    tip: "AI compute that retunes heal knobs from the live book + Uniswap tape. Caps still live on-chain — the model only proposes inside the legal range.",
  },
]

/** Longest alias first so "quote-heavy" wins over "quote". */
export const GLOSSARY_ALIASES_SORTED = AQUA_GLOSSARY.flatMap(e =>
  e.aliases.map(alias => ({ alias, entry: e })),
).sort((a, b) => b.alias.length - a.alias.length)

export const glossaryById = Object.fromEntries(AQUA_GLOSSARY.map(e => [e.id, e])) as Record<
  string,
  GlossaryEntry
>

export const tipFor = (id: string): string | undefined => glossaryById[id]?.tip

export const formulaFor = (id: string): string | undefined => glossaryById[id]?.formula
