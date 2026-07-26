"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { AquaHolo } from "~~/components/AquaHolo"
import { AquaGlossText } from "~~/components/AquaGlossText"
import { AquaTerm } from "~~/components/AquaTerm"
import { formatPct1e18 } from "~~/lib/jarvis/fallback"
import {
  formatHealSimBook,
  HEALTHY_SKEW_PCT,
  type HealSimResult,
  type HealSimStep,
} from "~~/lib/jarvis/healSim"

type Props = {
  visible: boolean
  awake: boolean
  result: HealSimResult | null
  /** When true, reveal steps one-by-one for the demo. */
  animate?: boolean
  /** Fired once when the reactor animation finishes. */
  onComplete?: (result: HealSimResult) => void
  /** Arm Best settings + MetaMask for the first (or next) heal clip. */
  onArmMetaMask?: (result: HealSimResult) => void
  arming?: boolean
  armedClip?: number | null
}

type Phase = "boot" | "juice" | "settle" | "done"

const fmtSkew = (skew: number): string => `${skew >= 0 ? "+" : ""}${skew.toFixed(1)}%`

/** Map |skew| → reactor fuel 0–100 (full when healthy). */
const fuelFromSkew = (skew: number, startAbs: number): number => {
  const abs = Math.abs(skew)
  if (abs <= HEALTHY_SKEW_PCT) return 100
  const ceiling = Math.max(startAbs, abs, HEALTHY_SKEW_PCT + 1)
  const span = ceiling - HEALTHY_SKEW_PCT
  if (span <= 0) return 100
  return Math.max(0, Math.min(99, ((ceiling - abs) / span) * 100))
}

const JuiceBars = ({ hot }: { hot: boolean }) => (
  <div className={`aqua-healsim-juice ${hot ? "aqua-healsim-juice--hot" : ""}`} aria-hidden>
    {Array.from({ length: 12 }, (_, i) => (
      <span
        key={i}
        className="aqua-healsim-juice-bar"
        style={{ ["--j" as string]: i, animationDelay: `${i * 0.04}s` }}
      />
    ))}
  </div>
)

const FuelGauge = ({
  fuel,
  label,
  charging,
}: {
  fuel: number
  label: string
  charging: boolean
}) => (
  <div className={`aqua-healsim-fuel ${charging ? "aqua-healsim-fuel--charge" : ""}`}>
    <div className="aqua-healsim-fuel-head">
      <span>
        <AquaTerm id="heal">Reactor</AquaTerm> · inventory fuel
      </span>
      <strong className="aqua-holo-num">{Math.round(fuel)}%</strong>
    </div>
    <div className="aqua-healsim-fuel-track" role="meter" aria-valuenow={Math.round(fuel)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div
        className="aqua-healsim-fuel-fill"
        style={{ ["--fuel" as string]: `${fuel}%` }}
      />
      <div className="aqua-healsim-fuel-ticks" aria-hidden>
        {[25, 50, 75].map(t => (
          <i key={t} style={{ left: `${t}%` }} />
        ))}
      </div>
    </div>
    <p className="aqua-healsim-fuel-cap">{label}</p>
  </div>
)

const StepRow = ({
  step,
  lit,
  startAbs,
}: {
  step: HealSimStep
  lit: boolean
  startAbs: number
}) => {
  const healGain = Math.max(
    0,
    fuelFromSkew(step.skewAfter, startAbs) - fuelFromSkew(step.skewBefore, startAbs),
  )
  return (
    <li className={`aqua-healsim-step ${lit ? "aqua-healsim-step--lit" : "aqua-healsim-step--done"}`}>
      <div className="aqua-healsim-step-head">
        <span className="aqua-healsim-idx">{step.index}</span>
        <span className="aqua-healsim-side">{step.sellBase ? "Sell WETH" : "Buy WETH"}</span>
        <span className="aqua-healsim-winner">{step.winnerLabel}</span>
      </div>
      <div className="aqua-healsim-step-meter" aria-hidden>
        <div
          className="aqua-healsim-step-meter-fill"
          style={{ ["--w" as string]: `${Math.min(100, 18 + healGain * 1.4)}%` }}
        />
      </div>
      <p className="aqua-healsim-line">
        <AquaGlossText text={step.label} />
      </p>
      <p className="aqua-healsim-knobs">
        <AquaTerm id="heal">healK</AquaTerm> {formatPct1e18(step.params.healK)} ·{" "}
        <AquaTerm id="maxAdj">maxAdj</AquaTerm> {formatPct1e18(step.params.maxAdjustment)} ·{" "}
        <AquaTerm id="lambda">λ</AquaTerm> {step.params.lambda.toString()}
      </p>
      <p className="aqua-healsim-skew">
        <AquaTerm id="skew">skew</AquaTerm> {fmtSkew(step.skewBefore)} → {fmtSkew(step.skewAfter)}
        <span className="aqua-healsim-gain"> · +{healGain.toFixed(0)}% fuel</span>
      </p>
    </li>
  )
}

export const AquaHealSimPanel = ({
  visible,
  awake,
  result,
  animate = true,
  onComplete,
  onArmMetaMask,
  arming,
  armedClip,
}: Props) => {
  const [revealed, setRevealed] = useState(0)
  const [phase, setPhase] = useState<Phase>("boot")
  const [displayFuel, setDisplayFuel] = useState(0)
  const fuelRef = useRef(0)
  const completedRef = useRef(false)

  useEffect(() => {
    fuelRef.current = displayFuel
  }, [displayFuel])

  useEffect(() => {
    completedRef.current = false
  }, [result])

  const startAbs = useMemo(
    () => Math.max(Math.abs(result?.startSkew ?? 0), HEALTHY_SKEW_PCT + 5),
    [result?.startSkew],
  )

  const targetFuel = useMemo(() => {
    if (!result) return 0
    if (revealed <= 0) return fuelFromSkew(result.startSkew, startAbs)
    const step = result.steps[revealed - 1]
    if (!step) return fuelFromSkew(result.endSkew, startAbs)
    return fuelFromSkew(step.skewAfter, startAbs)
  }, [result, revealed, startAbs])

  // Staged reveal: boot → juice each step → settle
  useEffect(() => {
    if (!result) return
    if (!animate) {
      setRevealed(result.steps.length)
      setPhase("done")
      setDisplayFuel(fuelFromSkew(result.endSkew, startAbs))
      if (!completedRef.current) {
        completedRef.current = true
        onComplete?.(result)
      }
      return
    }

    setRevealed(0)
    setPhase("boot")
    setDisplayFuel(fuelFromSkew(result.startSkew, startAbs))

    const timers: number[] = []
    let step = 0

    const runStep = () => {
      if (step >= result.steps.length) {
        setPhase("done")
        if (!completedRef.current) {
          completedRef.current = true
          onComplete?.(result)
        }
        return
      }
      setPhase("juice")
      timers.push(
        window.setTimeout(() => {
          step += 1
          setRevealed(step)
          setPhase("settle")
          timers.push(
            window.setTimeout(() => {
              if (step >= result.steps.length) {
                setPhase("done")
                if (!completedRef.current) {
                  completedRef.current = true
                  onComplete?.(result)
                }
              } else runStep()
            }, 420),
          )
        }, 780),
      )
    }

    timers.push(window.setTimeout(runStep, 650))
    return () => timers.forEach(t => window.clearTimeout(t))
  }, [result, animate, startAbs, onComplete])

  // Smooth fuel climb toward target
  useEffect(() => {
    if (!result) return
    let raf = 0
    let alive = true
    let current = fuelRef.current

    const tick = () => {
      if (!alive) return
      const next = current + (targetFuel - current) * 0.16
      if (Math.abs(next - targetFuel) < 0.4) {
        current = targetFuel
        fuelRef.current = targetFuel
        setDisplayFuel(targetFuel)
        return
      }
      current = next
      fuelRef.current = next
      setDisplayFuel(next)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      alive = false
      cancelAnimationFrame(raf)
    }
  }, [targetFuel, result])

  if (!visible || !result) return null

  const show = animate ? Math.min(revealed, result.steps.length) : result.steps.length
  const done = phase === "done" || show >= result.steps.length
  const juicing = phase === "juice" || phase === "boot"
  const fuelLabel = done
    ? result.healthy
      ? "Book healthy — reactor nominal"
      : "Partial heal — reactor still warm"
    : juicing
      ? `Charging swap ${Math.min(show + 1, result.steps.length)}…`
      : `Committed swap ${show}`

  return (
    <AquaHolo
      as="aside"
      className={`aqua-side aqua-healsim ${awake ? "aqua-side--live" : "aqua-side--muted"} ${
        juicing ? "aqua-healsim--hot" : ""
      } ${done && result.healthy ? "aqua-healsim--ok" : ""}`}
      aria-label="Heal path simulation"
      aria-live="polite"
    >
      <header className="aqua-side-head">
        <span>
          <AquaTerm id="heal">Heal path</AquaTerm>
        </span>
        <span className={`aqua-tag ${done && result.healthy ? "aqua-tag--ok" : "aqua-tag--pulse"}`}>
          {done ? (result.healthy ? "healthy" : "partial") : phase === "boot" ? "arming" : "juicing"}
        </span>
      </header>

      <FuelGauge fuel={displayFuel} label={fuelLabel} charging={juicing && !done} />
      <JuiceBars hot={juicing && !done} />

      <p className="aqua-healsim-lede">
        {result.usedScenarioBook ? (
          <>
            Scenario <AquaTerm id="book">book</AquaTerm> (live was already near balance)
          </>
        ) : (
          <>
            From live <AquaTerm id="book">book</AquaTerm>
          </>
        )}{" "}
        · target ±{HEALTHY_SKEW_PCT}% <AquaTerm id="skew">skew</AquaTerm>
      </p>
      <p className="aqua-healsim-book">
        Start <strong className="aqua-holo-num">{formatHealSimBook(result.startBook)}</strong>
        <span className="aqua-healsim-skew-inline"> {fmtSkew(result.startSkew)}</span>
      </p>

      <ol className="aqua-healsim-list" aria-label="Simulated heal swaps">
        {result.steps.slice(0, show).map(step => (
          <StepRow
            key={step.index}
            step={step}
            lit={step.index === show && !done}
            startAbs={startAbs}
          />
        ))}
      </ol>

      {done ? (
        <>
          <p className={`aqua-healsim-end ${result.healthy ? "aqua-healsim-end--ok" : ""}`}>
            End <strong className="aqua-holo-num">{formatHealSimBook(result.endBook)}</strong>
            <span className="aqua-healsim-skew-inline"> {fmtSkew(result.endSkew)}</span>
            {result.healthy ? " · book healthy" : " · still healing"}
          </p>
          {result.steps.length > 0 && onArmMetaMask ? (
            <div className="aqua-healsim-arm">
              <p className="aqua-healsim-arm-copy">
                Next: Best settings for clip {armedClip ?? 1}/{result.steps.length}, then MetaMask
                dock → ship → swap.
              </p>
              <button
                type="button"
                className="aqua-healsim-arm-btn"
                disabled={!!arming}
                onClick={() => onArmMetaMask(result)}
                aria-label="Propose Best settings for MetaMask heal path"
              >
                {arming
                  ? "Arming Best settings…"
                  : armedClip
                    ? `Re-arm clip ${armedClip}`
                    : "Propose → MetaMask"}
              </button>
            </div>
          ) : null}
        </>
      ) : (
        <p className="aqua-healsim-end aqua-healsim-end--run">
          {phase === "boot" ? "Arming heal reactor…" : `Juicing swap ${show + 1} of ${result.steps.length}…`}
        </p>
      )}
    </AquaHolo>
  )
}
