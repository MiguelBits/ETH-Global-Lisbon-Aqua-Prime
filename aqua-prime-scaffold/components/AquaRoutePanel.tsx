"use client"

import { AquaHolo } from "~~/components/AquaHolo"
import { AquaGlossText } from "~~/components/AquaGlossText"
import { AquaTerm } from "~~/components/AquaTerm"
import { branchBookStats, bpsVs, fmtBal, fmtMid, fmtPoolPrice, midUsdcPerWeth } from "~~/lib/branchBook"
import type { BranchDisplayRow } from "~~/lib/branchingView"
import { oracleBoundAdvice } from "~~/lib/jarvis/makerSor"
import { usdSkewPct } from "~~/lib/primeSim"
import { methodExplain, SELECTOR_EXPLAIN } from "~~/lib/jarvis/pricingExplain"

type Props = {
  visible: boolean
  awake: boolean
  amountInWei: bigint
  sellBase: boolean
  balBase: bigint
  balQuote: bigint
  ethUsd1e18: bigint
  rows: BranchDisplayRow[]
  livePrimeOut: bigint | null
  isLoading?: boolean
}

const winnerWhy = (sellBase: boolean, skewPct: number, winnerLabel: string | undefined): string | null => {
  if (!winnerLabel) return null
  const quoteHeavy = skewPct > 3
  const baseHeavy = skewPct < -3
  if (winnerLabel === "HEAL") {
    if (sellBase && quoteHeavy) {
      return `HEAL wins: book is USDC-heavy (skew ${skewPct >= 0 ? "+" : ""}${skewPct.toFixed(1)}%) and ticket sells WETH — inventory heal.`
    }
    if (!sellBase && baseHeavy) {
      return `HEAL wins: book is WETH-heavy (skew ${skewPct.toFixed(1)}%) and ticket buys WETH — inventory heal.`
    }
    return `HEAL wins on score (taker out minus λ·post-skew). Flip side or rebalance the book to see BASELINE compete.`
  }
  if (winnerLabel === "BASELINE") {
    return `BASELINE wins: trade is not the heal direction (or heal edge is capped). Skew ${skewPct >= 0 ? "+" : ""}${skewPct.toFixed(1)}%.`
  }
  return `${winnerLabel} wins on PrimeSelector score.`
}

export const AquaRoutePanel = ({
  visible,
  awake,
  amountInWei,
  sellBase,
  balBase,
  balQuote,
  ethUsd1e18,
  rows,
  livePrimeOut,
  isLoading,
}: Props) => {
  if (!visible) return null
  if (amountInWei === 0n) return null

  const tokenOutLabel = sellBase ? "USDC" : "WETH"
  const dec = sellBase ? 6 : 18
  const poolMid = midUsdcPerWeth(balBase, balQuote)
  const bookBefore = branchBookStats(balBase, balQuote, amountInWei, 0n, sellBase)

  if (isLoading && rows.length === 0) {
    return (
      <AquaHolo as="aside" className={`aqua-side aqua-routes ${awake ? "aqua-side--live" : "aqua-side--muted"}`}>
        <header className="aqua-side-head">
          <span>Route</span>
          <span className="aqua-tag aqua-tag--pulse">scoring…</span>
        </header>
        <p className="aqua-ticket-hint">PrimeSelector scoring branches…</p>
      </AquaHolo>
    )
  }

  if (rows.length === 0) {
    return (
      <AquaHolo as="aside" className={`aqua-side aqua-routes ${awake ? "aqua-side--live" : "aqua-side--muted"}`}>
        <header className="aqua-side-head">
          <span>Route</span>
          <span className="aqua-tag">standby</span>
        </header>
        <p className="aqua-ticket-hint">Awaiting book / oracle for branch simulation.</p>
      </AquaHolo>
    )
  }

  const outs = rows.map(b => Number(b.amountOut) / 10 ** dec)
  const maxOut = Math.max(...outs, 1e-9)
  const baselineOut = outs[0] ?? 0
  const winnerRow = rows.find(r => r.isWinner)
  const excluded = rows.filter(r => !r.isWinner)
  const skewPct = ethUsd1e18 > 0n ? usdSkewPct({ balBase, balQuote }, ethUsd1e18) : 0
  const why = winnerWhy(sellBase, skewPct, winnerRow?.label)
  const oracle =
    ethUsd1e18 > 0n
      ? oracleBoundAdvice({
          book: { balBase, balQuote },
          ethUsd1e18,
          amountIn: amountInWei,
          sellBase,
        })
      : null

  return (
    <AquaHolo
      as="aside"
      className={`aqua-side aqua-routes ${awake ? "aqua-side--live" : "aqua-side--muted"}`}
      aria-label="PrimeSelector routes"
    >
      <header className="aqua-side-head">
        <span>
          <AquaTerm id="route">Route</AquaTerm> · PrimeSelector
        </span>
        <span className="aqua-tag aqua-tag--ok aqua-tag--pulse">2 live + 2 ref</span>
      </header>

      <p className="aqua-routes-book aqua-stagger-item" style={{ ["--i" as string]: 0 }}>
        <AquaTerm id="book">Book</AquaTerm> · WETH {fmtBal(bookBefore.wethBefore, "WETH")} · USDC{" "}
        {fmtBal(bookBefore.usdcBefore, "USDC")}
        {poolMid ? (
          <>
            {" "}
            · mid <strong className="aqua-holo-num">{fmtPoolPrice(poolMid)}</strong>
            <span className="aqua-routes-raw"> ({fmtMid(bookBefore.midBefore)})</span>
          </>
        ) : null}
      </p>

      <p className="aqua-routes-method aqua-stagger-item" style={{ ["--i" as string]: 0 }}>
        <AquaTerm id="route">PrimeSelector</AquaTerm>
        <code className="aqua-calc-formula">{SELECTOR_EXPLAIN.formula}</code>
        <span>{SELECTOR_EXPLAIN.how}</span>
      </p>

      {oracle ? (
        <p
          className={`aqua-routes-oracle aqua-stagger-item ${oracle.warn ? "aqua-routes-oracle--warn" : ""}`}
          style={{ ["--i" as string]: 0 }}
        >
          <AquaTerm id="oracle">Oracle</AquaTerm> ·{" "}
          <AquaGlossText text={oracle.line.replace(/^Oracle gate:\s*/i, "")} />
        </p>
      ) : null}

      <ul className="aqua-route-list aqua-stagger">
        {rows.map((branch, index) => {
          const out = outs[index] ?? 0
          const stats = branchBookStats(balBase, balQuote, amountInWei, branch.amountOut, sellBase)
          const poolShiftBps = bpsVs(stats.midAfter, stats.midBefore)
          const edgeBps = index > 0 && baselineOut > 0 ? ((out - baselineOut) / baselineOut) * 10000 : 0
          const excludedAlt = !branch.isWinner
          const method = methodExplain(branch.label)
          const termId =
            branch.label === "HEAL"
              ? "heal"
              : branch.label === "BASELINE"
                ? "baseline"
                : branch.label === "XYC"
                  ? "xyc"
                  : branch.label === "ORACLE"
                    ? "oracle"
                    : null

          return (
            <li
              key={`${branch.label}-${index}`}
              className={`aqua-route-row ${branch.isWinner ? "aqua-route-row--win aqua-route-row--lock" : ""} ${
                excludedAlt ? "aqua-route-row--alt" : ""
              }`}
              style={{ ["--i" as string]: index + 1 }}
            >
              <div className="aqua-route-top">
                <span>
                  {termId ? <AquaTerm id={termId}>{branch.label}</AquaTerm> : branch.label}
                  {branch.isReference ? " (ref)" : ""}
                  {branch.isWinner ? " ◀" : excludedAlt ? " · excluded" : ""}
                  <em>{branch.desc}</em>
                </span>
                <code className="aqua-holo-num">
                  {out.toLocaleString("en-US", { maximumFractionDigits: dec === 6 ? 2 : 6 })}
                </code>
              </div>
              {method ? (
                <p className="aqua-route-method">
                  <code className="aqua-calc-formula">{method.formula}</code>
                  <span>{method.how}</span>
                </p>
              ) : null}
              <div className="aqua-route-meter" aria-hidden>
                <div
                  className="aqua-route-meter-fill aqua-route-meter-fill--draw"
                  style={{
                    ["--w" as string]: `${(out / maxOut) * 100}%`,
                    opacity: branch.isWinner ? 1 : 0.45,
                  }}
                />
              </div>
              <div className="aqua-route-meta">
                <span>
                  <AquaTerm id="skew">post-skew</AquaTerm>{" "}
                  {((Number(branch.postSkewE18) / 1e18) * 100).toFixed(1)}%
                </span>
                <span className={edgeBps > 0 ? "aqua-route-up" : edgeBps < 0 ? "aqua-route-down" : ""}>
                  {index === 0 ? (
                    <AquaTerm id="baseline">baseline</AquaTerm>
                  ) : (
                    <>
                      {edgeBps > 0 ? "+" : ""}
                      {edgeBps.toFixed(0)} bps vs <AquaTerm id="baseline">baseline</AquaTerm>
                    </>
                  )}
                </span>
              </div>
              {branch.capBound ? <p className="aqua-ticket-hint aqua-ticket-hint--warn">LP fair cap bound</p> : null}
              <p className="aqua-route-exec">
                pool {fmtPoolPrice(stats.midBefore)} to {fmtPoolPrice(stats.midAfter)}
                {poolShiftBps !== null
                  ? ` (${poolShiftBps > 0 ? "+" : ""}${poolShiftBps.toFixed(0)} bps)`
                  : ""}
                {" · "}exec {fmtPoolPrice(stats.execPrice)}
              </p>
            </li>
          )
        })}
      </ul>

      {why ? (
        <p className="aqua-routes-why aqua-stagger-item" style={{ ["--i" as string]: rows.length + 1 }}>
          <AquaGlossText text={why} />
        </p>
      ) : null}

      <p className="aqua-routes-foot aqua-stagger-item" style={{ ["--i" as string]: rows.length + 2 }}>
        Winner{" "}
        <strong className="aqua-holo-num">
          {livePrimeOut !== null
            ? (Number(livePrimeOut) / 10 ** dec).toLocaleString("en-US", {
                maximumFractionDigits: dec === 6 ? 2 : 6,
              })
            : "—"}{" "}
          {tokenOutLabel}
        </strong>
        {winnerRow ? (
          <>
            {" "}
            · pool after{" "}
            <strong className="aqua-holo-num">
              {fmtPoolPrice(
                branchBookStats(balBase, balQuote, amountInWei, winnerRow.amountOut, sellBase).midAfter,
              )}
            </strong>
          </>
        ) : null}
        {excluded.length > 0 ? (
          <span className="aqua-routes-excluded">
            {" "}
            · excluded {excluded.map(e => e.label).join(", ")}
          </span>
        ) : null}
      </p>
    </AquaHolo>
  )
}
