"use client"

import type { TapeIntel } from "~~/lib/jarvis/tapeIntel"

type Props = {
  tape: TapeIntel | null | undefined
  compact?: boolean
}

/**
 * Compact Uniswap tape intel for Jarvis / desk.
 */
export const AquaTapeIntel = ({ tape, compact = false }: Props) => {
  if (!tape) return null

  if (!tape.available) {
    return (
      <section className={`aqua-opp ${compact ? "aqua-opp--compact" : ""}`} aria-label="Uniswap tape">
        <header className="aqua-opp-head">
          <span>UNI TAPE</span>
          <span className="aqua-opp-sub">unavailable</span>
        </header>
        <p className="aqua-opp-label" style={{ padding: "0.25rem 0.45rem" }}>
          {tape.reason ?? "no quote"}
        </p>
      </section>
    )
  }

  const rows: { k: string; v: string }[] = [
    {
      k: "EDGE",
      v:
        tape.edgeDeskVsClassicBps == null
          ? "—"
          : `${tape.edgeDeskVsClassicBps >= 0 ? "+" : ""}${tape.edgeDeskVsClassicBps.toFixed(0)} bps`,
    },
    {
      k: "IMPACT",
      v: tape.priceImpactPct == null ? "—" : `${tape.priceImpactPct.toFixed(2)}%`,
    },
    {
      k: "GAS",
      v: tape.gasFeeUSD == null ? "—" : `$${tape.gasFeeUSD.toFixed(3)}`,
    },
    {
      k: "BESTΔ",
      v:
        tape.bestVsClassicBps == null
          ? "—"
          : `${tape.bestVsClassicBps >= 0 ? "+" : ""}${tape.bestVsClassicBps.toFixed(0)} bps`,
    },
  ]

  return (
    <section
      className={`aqua-opp ${compact ? "aqua-opp--compact" : ""}`}
      aria-label="Uniswap tape intelligence"
    >
      <header className="aqua-opp-head">
        <span>UNI TAPE</span>
        <span className="aqua-opp-sub">
          {tape.thinLiquidity ? "THIN" : "OK"}
          {tape.fillerGapWide ? " · FILLER" : ""}
        </span>
      </header>
      <ul className="aqua-opp-list">
        {rows.map(r => (
          <li key={r.k}>
            <div className="aqua-opp-row aqua-opp-row--current" style={{ cursor: "default" }}>
              <span className="aqua-opp-kind">{r.k}</span>
              <span className="aqua-opp-label">{r.v}</span>
            </div>
          </li>
        ))}
      </ul>
      {tape.routeString ? (
        <p className="aqua-opp-sub" style={{ marginTop: "0.35rem", padding: "0 0.2rem" }}>
          {tape.routeString}
        </p>
      ) : null}
    </section>
  )
}
