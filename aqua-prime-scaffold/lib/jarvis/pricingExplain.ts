/**
 * Plain-language + formula explanations for Prime Desk pricing methods and knobs.
 * Used by Calc / Route / Tuning UIs and glossary tips.
 */

export type PricingMethodId = "BASELINE" | "HEAL" | "XYC" | "ORACLE"

export type PricingParamId = "healK" | "maxAdj" | "lambda" | "premium" | "oracleBand"

export type PricingExplain = {
  id: string
  label: string
  /** One-line tip (glossary / hover) */
  tip: string
  /** How it enters the quote math */
  formula: string
  /** What it does for the maker / trader */
  how: string
}

/** Live + reference branches shown in the route board. */
export const PRICING_METHODS: Record<PricingMethodId, PricingExplain> = {
  XYC: {
    id: "XYC",
    label: "XYC",
    tip: "Pure constant-product AMM: amountOut = balOut − k / (balIn + amountIn). No inventory shade, no oracle.",
    formula: "amountOut = balOut − (balIn·balOut) / (balIn + amountIn)",
    how: "Reference curve only. Shows what a dumb XYC book would pay with zero heal and zero oracle band.",
  },
  ORACLE: {
    id: "ORACLE",
    label: "ORACLE",
    tip: "XYC quote clamped into a Chainlink band — pulls rich pool quotes down / lifts cheap ones toward mark.",
    formula: "clamp(XYC_out, fair · decay … fair / decay)  ·  decay ≈ 0.95 → ±5% band",
    how: "Reference only. Shows oracle honesty without inventory heal. Live desk uses fair caps inside BASELINE/HEAL instead.",
  },
  BASELINE: {
    id: "BASELINE",
    label: "BASELINE",
    tip: "Live route: XYC → USD-skew with k≈0 → Chainlink fair-value cap. Competitive quote without inventing heal juice.",
    formula: "XYC → SkewPricerValue(k≈0, maxAdj, premium) → usdOut ≤ usdIn·(1+premium)",
    how: "On-chain competitor. Wins when the ticket does not heal the book (or heal edge is capped at fair). Premium only bounds LP giveaway vs mark.",
  },
  HEAL: {
    id: "HEAL",
    label: "HEAL",
    tip: "Live route: XYC → inventory skew (healK) capped by maxAdj, then fair-value premium. Pays more when the swap rebalances USD skew.",
    formula: "skew=(vOut−vIn)/(vOut+vIn); adj=clamp(healK·skew,±maxAdj); out*=(1+adj); then fair cap +premium",
    how: "On-chain competitor. Attracts the side that heals inventory; λ in the selector still punishes leftover post-skew. Never pays worse than Chainlink fair + premium.",
  },
}

/** Desk-set knobs Jarvis proposes / TuningPanel edits. */
export const PRICING_PARAMS: Record<PricingParamId, PricingExplain> = {
  healK: {
    id: "healK",
    label: "healK",
    tip: "Skew sensitivity (1e18). How strongly inventory imbalance shades the quote after XYC.",
    formula: "adjustment = clamp(healK · usdSkew, −maxAdj, +maxAdj)",
    how: "Higher healK → stronger discount when selling the overstocked USD leg (or premium when protecting the scarce leg). Capped on-chain at 0.8e18.",
  },
  maxAdj: {
    id: "maxAdj",
    label: "maxAdj",
    tip: "Hard cap on the skew multiplier so heal cannot runaway-discount the book.",
    formula: "|adjustment| ≤ maxAdj   ·   factor = 1 ± adjustment",
    how: "Even at extreme skew, price move stops at this % (e.g. 0.10e18 → ±10%). Capped on-chain at 0.1e18.",
  },
  premium: {
    id: "premium",
    label: "premium",
    tip: "Max LP giveaway over Chainlink fair value after skew (healPremium).",
    formula: "usdOut ≤ usdIn · (1 + premium)   // exact-in fair cap",
    how: "Kills free money when the pool is rich vs mark. 0 = never pay above fair; 0.005e18 = allow up to +0.5% over fair. Capped at 0.02e18.",
  },
  lambda: {
    id: "lambda",
    label: "λ",
    tip: "PrimeSelector inventory penalty. Chooses the branch that maximizes takerValue − λ·|postSkew|.",
    formula: "score = amountOut_usd − λ · |postTradeUsdSkew|",
    how: "Higher λ prefers cleaner post-trade books even if the taker gets a bit less. Live range ≈ 5e8…5e9; deployed default 1e9.",
  },
  oracleBand: {
    id: "oracleBand",
    label: "oracleBand",
    tip: "Reference ORACLE branch decay vs Chainlink (maxPriceDecay). Not a live desk-set field — Tuning / ref only.",
    formula: "band = ±(1 − decay)   ·   decay 0.95e18 → ±5%",
    how: "Used only for the ORACLE reference curve. Live BASELINE/HEAL use the fair-value premium cap instead of this band.",
  },
}

/** Selector scoring (shared across routes). */
export const SELECTOR_EXPLAIN: PricingExplain = {
  id: "selector",
  label: "PrimeSelector",
  tip: "Maker-side smart order router: runs each branch on the same book and picks max(score).",
  formula: "score = takerValue − λ · |postSkew|; winner’s SwapRegisters settle",
  how: "Not taker best-price. Prefers the branch that pays reasonably while leaving inventory healthier. Quote and swap share the same pure scoring path.",
}

export const methodExplain = (label: string): PricingExplain | undefined =>
  PRICING_METHODS[label as PricingMethodId]

export const paramExplain = (id: string): PricingExplain | undefined =>
  PRICING_PARAMS[id as PricingParamId]

/** Calc panel key → param id */
export const CALC_KNOB_EXPLAIN: Record<string, PricingParamId> = {
  healK: "healK",
  maxAdj: "maxAdj",
  lambda: "lambda",
  premium: "premium",
}
