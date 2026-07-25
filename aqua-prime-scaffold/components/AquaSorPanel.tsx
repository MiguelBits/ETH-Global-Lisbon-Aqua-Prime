"use client"

import { formatUnits } from "viem"
import { AquaHolo } from "~~/components/AquaHolo"
import { AquaGlossText } from "~~/components/AquaGlossText"
import { AquaTerm } from "~~/components/AquaTerm"
import type { MakerSorPick } from "~~/lib/jarvis/makerSor"

type Props = {
  visible: boolean
  awake: boolean
  pick: MakerSorPick | null
}

const fmtOut = (amountOut: bigint, sellBase: boolean): string => {
  if (sellBase) {
    return `${Number(formatUnits(amountOut, 6)).toLocaleString("en-US", { maximumFractionDigits: 2 })} USDC`
  }
  return `${Number(formatUnits(amountOut, 18)).toLocaleString("en-US", { maximumFractionDigits: 4 })} WETH`
}

export const AquaSorPanel = ({ visible, awake, pick }: Props) => {
  if (!visible) return null

  if (!pick) {
    return (
      <AquaHolo as="aside" className={`aqua-side aqua-sor ${awake ? "aqua-side--live" : "aqua-side--muted"}`}>
        <header className="aqua-side-head">
          <span>
            <AquaTerm id="route">Maker SOR</AquaTerm>
          </span>
          <span className="aqua-tag">standby</span>
        </header>
        <p className="aqua-ticket-hint">Ask Best route or Best size to score branches.</p>
      </AquaHolo>
    )
  }

  const side = pick.sellBase ? `Sell ${pick.amountHuman} WETH` : `Buy with ${pick.amountHuman} USDC`
  const liveRows = pick.allBranches.filter(b => b.label === "BASELINE" || b.label === "HEAL")
  const refRows = pick.allBranches.filter(b => b.label === "XYC" || b.label === "ORACLE")

  return (
    <AquaHolo
      as="aside"
      className={`aqua-side aqua-sor ${awake ? "aqua-side--live" : "aqua-side--muted"} ${
        pick.oracle.warn ? "aqua-sor--warn" : ""
      }`}
      aria-label="Maker smart order routing"
    >
      <header className="aqua-side-head">
        <span>
          <AquaTerm id="route">Maker SOR</AquaTerm>
          {pick.optimized ? " · size" : " · ticket"}
        </span>
        <span className={`aqua-tag ${pick.liveExecutable ? "aqua-tag--ok" : "aqua-tag--pulse"}`}>
          {pick.adviceWinner}
        </span>
      </header>

      <p className="aqua-sor-ticket">
        {side} → <strong className="aqua-holo-num">{fmtOut(pick.amountOut, pick.sellBase)}</strong>
      </p>

      <p className="aqua-sor-verdict">
        Advice <strong>{pick.adviceWinner}</strong>
        {!pick.liveExecutable ? (
          <>
            {" "}
            (ref) · Execute via <strong>{pick.liveWinner}</strong>
          </>
        ) : (
          <> · live-settlement</>
        )}
      </p>

      <ul className="aqua-sor-list" aria-label="Live branch scores">
        {liveRows.map(b => (
          <li
            key={b.label}
            className={`aqua-sor-row ${b.label === pick.liveWinner ? "aqua-sor-row--win" : ""}`}
          >
            <span>{b.label}</span>
            <span className="aqua-holo-num">{fmtOut(b.amountOut, pick.sellBase)}</span>
          </li>
        ))}
      </ul>

      <ul className="aqua-sor-list aqua-sor-list--ref" aria-label="Reference branch scores">
        {refRows.map(b => (
          <li
            key={b.label}
            className={`aqua-sor-row ${b.label === pick.adviceWinner ? "aqua-sor-row--advice" : ""}`}
          >
            <span>
              {b.label} <em>(ref)</em>
            </span>
            <span className="aqua-holo-num">{fmtOut(b.amountOut, pick.sellBase)}</span>
          </li>
        ))}
      </ul>

      <p className={`aqua-sor-oracle ${pick.oracle.warn ? "aqua-sor-oracle--warn" : ""}`}>
        <AquaTerm id="oracle">Oracle</AquaTerm> ·{" "}
        <AquaGlossText text={pick.oracle.line.replace(/^Oracle gate:\s*/i, "")} />
      </p>
    </AquaHolo>
  )
}
