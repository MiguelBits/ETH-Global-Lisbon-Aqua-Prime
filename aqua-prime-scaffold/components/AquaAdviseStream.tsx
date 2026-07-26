"use client"

import { useEffect, useRef, useState } from "react"
import { AquaHolo } from "~~/components/AquaHolo"
import { AquaTapeIntel } from "~~/components/AquaTapeIntel"
import { AquaTerm } from "~~/components/AquaTerm"
import type { TapeIntel } from "~~/lib/jarvis/tapeIntel"
import { formatUniAmountOut } from "~~/lib/jarvis/uniFormat"

export type AdvisePhase = "idle" | "scanning" | "settled"

export type AdviseVerdict = {
  line: string
  preferSellBase: boolean | null
  skewPct: number
  mode: "0g" | "local"
  uniswapOut: string | null
  uniswapAvailable: boolean
  tapeIntel?: TapeIntel | null
}

type Props = {
  awake: boolean
  visible: boolean
  phase: AdvisePhase
  verdict: AdviseVerdict | null
  sellBase: boolean
}

const SIGNALS = ["skew↔", "tape·scan", "heal·bias", "ticket↔", "bookΔ", "impact"] as const

const needleDeg = (preferSellBase: boolean | null, wobble: number): number => {
  if (preferSellBase === true) return -38 + wobble
  if (preferSellBase === false) return 38 + wobble
  return wobble * 0.6
}

export const AquaAdviseStream = ({ awake, visible, phase, verdict, sellBase }: Props) => {
  const [wobble, setWobble] = useState(0)
  const [signals, setSignals] = useState<string[]>([])
  const [scanPct, setScanPct] = useState(0)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current)

    if (phase === "scanning") {
      let t = 0
      const frame = () => {
        t += 1
        setWobble(Math.sin(t / 7) * 22)
        setScanPct(Math.min(98, (t % 90) * 1.2))
        if (t % 8 === 0) {
          setSignals(prev => {
            const line = SIGNALS[Math.floor(Math.random() * SIGNALS.length)]
            return [line, ...prev].slice(0, 5)
          })
        }
        rafRef.current = requestAnimationFrame(frame)
      }
      rafRef.current = requestAnimationFrame(frame)
      return () => {
        if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      }
    }

    if (phase === "settled" && verdict) {
      setWobble(0)
      setScanPct(100)
      setSignals(prev =>
        [
          `lock·${verdict.preferSellBase === false ? "buy" : verdict.preferSellBase === true ? "sell" : "flat"}`,
          ...prev,
        ].slice(0, 5),
      )
    }

    if (phase === "idle") {
      setWobble(0)
      setScanPct(0)
      setSignals([])
    }
  }, [phase, verdict])

  const scanning = phase === "scanning"
  const locked = phase === "settled" && !!verdict
  const deg = needleDeg(verdict?.preferSellBase ?? null, wobble)
  const verdictLabel =
    verdict?.preferSellBase === true
      ? "SELL WETH"
      : verdict?.preferSellBase === false
        ? "BUY WETH"
        : "FLAT"

  return (
    <AquaHolo
      as="aside"
      className={`aqua-side aqua-advise ${awake ? "aqua-side--live" : "aqua-side--muted"} ${
        scanning ? "aqua-advise--hot" : ""
      } ${locked ? "aqua-advise--lock" : ""} ${!visible ? "hidden" : ""}`}
      aria-label="Trade advice"
      aria-live="polite"
    >
      <div className="aqua-side-head">
        <span>ADVISE</span>
        <span className="aqua-side-note">{scanning ? "scanning" : locked ? "locked" : "idle"}</span>
      </div>

      {!scanning && !locked ? (
        <p className="aqua-advise-idle">Awaiting trade advice sir.</p>
      ) : (
        <>
          <div className="aqua-advise-radar" aria-hidden>
            <div className="aqua-advise-arc">
              <span className="aqua-advise-pole aqua-advise-pole--l">sell</span>
              <span className="aqua-advise-pole aqua-advise-pole--r">buy</span>
              <div className="aqua-advise-dial">
                <i className="aqua-advise-tick" style={{ ["--t" as string]: 0 }} />
                <i className="aqua-advise-tick" style={{ ["--t" as string]: 1 }} />
                <i className="aqua-advise-tick" style={{ ["--t" as string]: 2 }} />
                <i className="aqua-advise-tick" style={{ ["--t" as string]: 3 }} />
                <i className="aqua-advise-tick" style={{ ["--t" as string]: 4 }} />
                <div
                  className={`aqua-advise-needle ${scanning ? "aqua-advise-needle--scan" : ""}`}
                  style={{ transform: `translateX(-50%) rotate(${deg}deg)` }}
                />
                <span className="aqua-advise-hub" />
              </div>
            </div>
            <div className="aqua-advise-sweep" style={{ ["--scan" as string]: `${scanPct}%` }} />
          </div>

          <div className={`aqua-uni-tape ${scanning ? "aqua-uni-tape--live" : ""}`}>
            <div className="aqua-uni-tape-head">
              <AquaTerm id="tape">Uniswap tape</AquaTerm>
              <span className="aqua-uni-tape-net">mainnet API</span>
            </div>
            <p className="aqua-uni-tape-out aqua-holo-num">
              {locked && verdict.uniswapAvailable
                ? formatUniAmountOut(verdict.uniswapOut, sellBase) ?? "—"
                : scanning
                  ? "quoting…"
                  : locked
                    ? "tape unavailable"
                    : "—"}
            </p>
          </div>

          <dl className="aqua-advise-stats">
            <div>
              <dt>
                <AquaTerm id="ticket">ticket</AquaTerm>
              </dt>
              <dd className="aqua-holo-num">{sellBase ? "Sell WETH" : "Buy WETH"}</dd>
            </div>
            <div>
              <dt>
                <AquaTerm id="skew">skew</AquaTerm>
              </dt>
              <dd className="aqua-holo-num">
                {verdict
                  ? `${verdict.skewPct >= 0 ? "+" : ""}${verdict.skewPct.toFixed(1)}%`
                  : scanning
                    ? "…"
                    : "—"}
              </dd>
            </div>
            <div>
              <dt>bias</dt>
              <dd className={`aqua-holo-num ${locked ? "aqua-advise-verdict" : ""}`}>{verdictLabel}</dd>
            </div>
          </dl>

          <ul className="aqua-advise-signals" aria-hidden>
            {signals.map((s, i) => (
              <li key={`${s}-${i}`} className="aqua-advise-signal">
                {s}
              </li>
            ))}
          </ul>

          {locked ? (
            <p className="aqua-advise-line">{verdict.line}</p>
          ) : (
            <p className="aqua-advise-line aqua-advise-line--run">
              Scanning inventory heal vs Uniswap tape…
            </p>
          )}

          {locked ? <AquaTapeIntel tape={verdict.tapeIntel} /> : null}
        </>
      )}
    </AquaHolo>
  )
}
