"use client"

import { useEffect, useRef, useState } from "react"
import { AquaHolo } from "~~/components/AquaHolo"
import { AquaTerm } from "~~/components/AquaTerm"
import { formatPct1e18 } from "~~/lib/jarvis/fallback"
import { CALC_KNOB_EXPLAIN, paramExplain, SELECTOR_EXPLAIN } from "~~/lib/jarvis/pricingExplain"
import type { JarvisProposal } from "~~/lib/jarvis/schema"
import { formatEdgeBps, formatUniAmountOut } from "~~/lib/jarvis/uniFormat"

export type CalcPhase = "idle" | "running" | "settled"

type Props = {
  awake: boolean
  /** When false, render nothing (hooks still idle). */
  visible: boolean
  phase: CalcPhase
  proposal: JarvisProposal | null
  amountInWei: bigint
  sellBase: boolean
}

type KnobRow = {
  key: string
  label: string
  value: string
}

const KNOB_TERM: Record<string, string> = {
  healK: "heal",
  maxAdj: "maxAdj",
  lambda: "lambda",
  premium: "premium",
}

const OPCODES = ["skew←", "λ←", "uni.edge", "heal.k", "adj.max", "prem←", "bookΔ", "tape↔"]

const scrambleDec = (digits = 4) => {
  const whole = Math.floor(Math.random() * 90) / 100
  const frac = Math.random().toString().slice(2, 2 + digits)
  return `${whole.toFixed(2)}.${frac}`.slice(0, 8)
}

const scrambleHex = () =>
  `0x${Array.from({ length: 6 }, () => Math.floor(Math.random() * 16).toString(16)).join("")}`

const settledKnobs = (p: JarvisProposal): KnobRow[] => [
  { key: "healK", label: "healK", value: formatPct1e18(p.params.healK) },
  { key: "maxAdj", label: "maxAdj", value: formatPct1e18(p.params.maxAdjustment) },
  { key: "lambda", label: "λ", value: p.params.lambda.toString() },
  { key: "premium", label: "premium", value: formatPct1e18(p.params.healPremium) },
]

const shortHash = (h: string) => (h.length > 14 ? `${h.slice(0, 10)}…${h.slice(-4)}` : h)

export const AquaCalcStream = ({
  awake,
  visible,
  phase,
  proposal,
  amountInWei,
  sellBase,
}: Props) => {
  const [knobs, setKnobs] = useState<KnobRow[]>([
    { key: "healK", label: "healK", value: "—" },
    { key: "maxAdj", label: "maxAdj", value: "—" },
    { key: "lambda", label: "λ", value: "—" },
    { key: "premium", label: "premium", value: "—" },
  ])
  const [opcodes, setOpcodes] = useState<string[]>([])
  const [modeLabel, setModeLabel] = useState("")
  const [liveUniOut, setLiveUniOut] = useState<string | null>(null)
  const [liveUniReason, setLiveUniReason] = useState<string | null>(null)
  const [uniLoading, setUniLoading] = useState(false)
  const rafRef = useRef<number | null>(null)
  const settleRef = useRef<number | null>(null)

  // Pull live Uniswap Trade API while Best settings runs / when settled.
  useEffect(() => {
    if (!visible || !awake || amountInWei === 0n) {
      setLiveUniOut(null)
      return
    }
    if (phase !== "running" && phase !== "settled") return

    let cancelled = false
    const load = async () => {
      setUniLoading(true)
      try {
        const res = await fetch(
          `/api/uniswap-quote?sellBase=${sellBase}&amountIn=${amountInWei.toString()}`,
        )
        const json = (await res.json()) as {
          available: boolean
          amountOut?: string
          reason?: string
        }
        if (cancelled) return
        if (json.available && json.amountOut) {
          setLiveUniOut(json.amountOut)
          setLiveUniReason(null)
        } else {
          setLiveUniOut(null)
          setLiveUniReason(json.reason ?? "tape unavailable")
        }
      } catch {
        if (!cancelled) {
          setLiveUniOut(null)
          setLiveUniReason("tape fetch failed")
        }
      } finally {
        if (!cancelled) setUniLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [visible, awake, phase, amountInWei, sellBase])

  useEffect(() => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    if (settleRef.current != null) window.clearTimeout(settleRef.current)

    if (phase === "running") {
      setModeLabel("computing")
      let tick = 0
      const frame = () => {
        tick += 1
        setKnobs([
          { key: "healK", label: "healK", value: `${scrambleDec()}%` },
          { key: "maxAdj", label: "maxAdj", value: `${scrambleDec()}%` },
          {
            key: "lambda",
            label: "λ",
            value: String(800_000_000 + Math.floor(Math.random() * 4_000_000_000)),
          },
          { key: "premium", label: "premium", value: `${scrambleDec(3)}%` },
        ])
        if (tick % 3 === 0) {
          setOpcodes(prev => {
            const line = `${OPCODES[Math.floor(Math.random() * OPCODES.length)]} ${scrambleHex()}`
            return [line, ...prev].slice(0, 6)
          })
        }
        rafRef.current = requestAnimationFrame(frame)
      }
      rafRef.current = requestAnimationFrame(frame)
      return () => {
        if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      }
    }

    if (phase === "settled" && proposal) {
      let n = 0
      const ease = () => {
        n += 1
        if (n < 8) {
          setKnobs([
            { key: "healK", label: "healK", value: `${scrambleDec()}%` },
            { key: "maxAdj", label: "maxAdj", value: `${scrambleDec()}%` },
            {
              key: "lambda",
              label: "λ",
              value: String(
                Math.floor(Number(proposal.params.lambda) * (0.9 + Math.random() * 0.2)),
              ),
            },
            { key: "premium", label: "premium", value: `${scrambleDec(3)}%` },
          ])
          settleRef.current = window.setTimeout(ease, 45)
          return
        }
        setKnobs(settledKnobs(proposal))
        setModeLabel(proposal.mode === "0g" ? "0g" : "local")
        setOpcodes(prev => [`settle·${proposal.mode}`, ...prev].slice(0, 6))
      }
      ease()
      return () => {
        if (settleRef.current != null) window.clearTimeout(settleRef.current)
      }
    }

    if ((!awake || phase === "idle") && !proposal) {
      setKnobs([
        { key: "healK", label: "healK", value: "—" },
        { key: "maxAdj", label: "maxAdj", value: "—" },
        { key: "lambda", label: "λ", value: "—" },
        { key: "premium", label: "premium", value: "—" },
      ])
      setOpcodes([])
      setModeLabel("")
    } else if (phase === "idle" && proposal) {
      setKnobs(settledKnobs(proposal))
      setModeLabel(proposal.mode === "0g" ? "0g" : "local")
    }
  }, [phase, proposal, awake])

  const intensifying = phase === "running"

  const tapeOutRaw =
    proposal?.uniswapAvailable && proposal.uniswapOut
      ? proposal.uniswapOut
      : liveUniOut
  const tapeLabel = formatUniAmountOut(tapeOutRaw, sellBase)
  const edgeLabel = formatEdgeBps(proposal?.edgeVsUniBps ?? null)

  if (!visible) return null

  return (
    <AquaHolo
      as="aside"
      className={`aqua-side aqua-calc ${awake ? "aqua-side--live" : "aqua-side--muted"} ${intensifying ? "aqua-calc--hot" : ""}`}
      aria-label="Calculating parameters"
      aria-live="polite"
    >
      <header className="aqua-side-head">
        <span>Calc</span>
        <span className={`aqua-tag ${intensifying ? "aqua-tag--pulse" : modeLabel ? "aqua-tag--ok" : ""}`}>
          {modeLabel || (awake ? "ready" : "standby")}
        </span>
      </header>

      {!awake || (phase === "idle" && !proposal) ? (
        <p className="aqua-calc-idle">Awaiting directive sir.</p>
      ) : (
        <>
          <div className={`aqua-uni-tape ${intensifying ? "aqua-uni-tape--live" : ""}`}>
            <div className="aqua-uni-tape-head">
              <AquaTerm id="tape">Uniswap tape</AquaTerm>
              <span className="aqua-uni-tape-net">mainnet API</span>
            </div>
            <p className="aqua-uni-tape-out aqua-holo-num">
              {uniLoading && !tapeLabel
                ? "quoting…"
                : tapeLabel
                  ? tapeLabel
                  : liveUniReason ?? "tape unavailable"}
            </p>
            {edgeLabel && phase === "settled" ? (
              <p className="aqua-uni-tape-edge">
                <AquaTerm id="edge">desk vs Uni</AquaTerm>{" "}
                <strong className="aqua-holo-num">{edgeLabel}</strong>
              </p>
            ) : intensifying ? (
              <p className="aqua-uni-tape-edge aqua-uni-tape-edge--run">anchoring heal knobs to tape…</p>
            ) : null}
          </div>

          <ul className="aqua-calc-knobs aqua-stagger">
            {knobs.map((k, i) => {
              const explainId = CALC_KNOB_EXPLAIN[k.key]
              const explain = explainId ? paramExplain(explainId) : undefined
              const showHow = Boolean(explain && phase === "settled" && proposal && !intensifying)
              return (
                <li key={k.key} style={{ ["--i" as string]: i }} className={showHow ? "aqua-calc-knob--explain" : ""}>
                  <div className="aqua-calc-knob-row">
                    <span>
                      {KNOB_TERM[k.key] ? (
                        <AquaTerm id={KNOB_TERM[k.key]}>{k.label}</AquaTerm>
                      ) : (
                        k.label
                      )}
                    </span>
                    <code className={intensifying ? "aqua-scramble" : "aqua-holo-num"}>{k.value}</code>
                  </div>
                  {showHow && explain ? (
                    <p className="aqua-calc-how">
                      <code className="aqua-calc-formula">{explain.formula}</code>
                      <span>{explain.how}</span>
                    </p>
                  ) : null}
                </li>
              )
            })}
          </ul>
          {proposal && phase === "settled" && !intensifying ? (
            <p className="aqua-calc-score">
              <AquaTerm id="route">PrimeSelector</AquaTerm>
              <code className="aqua-calc-formula">{SELECTOR_EXPLAIN.formula}</code>
              <span>{SELECTOR_EXPLAIN.how}</span>
            </p>
          ) : null}
          <ul className="aqua-calc-ops" aria-hidden>
            {opcodes.map((line, i) => (
              <li key={`${line}-${i}`} className="aqua-ops-line">
                {line}
              </li>
            ))}
          </ul>
          {proposal && phase === "settled" ? (
            <dl className="aqua-calc-custody">
              <div>
                <dt>
                  <AquaTerm id="0g">mode</AquaTerm>
                </dt>
                <dd className="aqua-holo-num">
                  {proposal.mode}
                  {proposal.critiqued ? " · critiqued" : ""}
                </dd>
              </div>
              {proposal.modelUsed ? (
                <div>
                  <dt>model</dt>
                  <dd className="aqua-holo-num">{proposal.modelUsed}</dd>
                </div>
              ) : null}
              <div>
                <dt>
                  <AquaTerm id="ens">agent</AquaTerm>
                </dt>
                <dd className="aqua-holo-num">{proposal.agentEns}</dd>
              </div>
              <div>
                <dt>
                  <AquaTerm id="attestation">attest</AquaTerm>
                </dt>
                <dd className="aqua-holo-num" title={proposal.params.attestation}>
                  {/^0x0+$/.test(proposal.params.attestation)
                    ? "—"
                    : shortHash(proposal.params.attestation)}
                </dd>
              </div>
            </dl>
          ) : null}
        </>
      )}
    </AquaHolo>
  )
}
