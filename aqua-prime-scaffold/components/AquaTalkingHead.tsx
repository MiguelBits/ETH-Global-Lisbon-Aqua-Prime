"use client"

import type { ReactNode } from "react"

type Phase = "asleep" | "waking" | "awake" | "listening" | "thinking" | "speaking"

type Props = {
  phase: Phase
  phaseLabel: string
  words: string[]
  activeWord: number
  hint: ReactNode
  /** Latest Aqua line when not mid-speech (faceplate, not Comms). */
  latestLine?: string | null
  /** Brief success / fail beat after execute. */
  outcome?: "success" | "fail" | null
}

/** Mech faceplate + visor that lights with spoken words. */
export const AquaTalkingHead = ({
  phase,
  phaseLabel,
  words,
  activeWord,
  hint,
  latestLine = null,
  outcome = null,
}: Props) => {
  const speaking = phase === "speaking"
  const listening = phase === "listening"
  const thinking = phase === "thinking"
  const intensity = speaking && activeWord >= 0 ? 0.55 + (activeWord % 3) * 0.15 : speaking ? 0.7 : 0

  return (
    <div
      className={`aqua-head aqua-head--${phase} ${speaking ? "aqua-head--talk" : ""} ${
        outcome === "success" ? "aqua-head--success" : outcome === "fail" ? "aqua-head--fail" : ""
      }`}
      style={{ ["--talk" as string]: intensity }}
      aria-label="Aqua faceplate"
      role="region"
    >
      {listening ? <div className="aqua-listen-ring" aria-hidden /> : null}
      {thinking ? <div className="aqua-think-orb" aria-hidden /> : null}

      <div className="aqua-head-crest aqua-head-crest--l" aria-hidden />
      <div className="aqua-head-crest aqua-head-crest--r" aria-hidden />

      <div className="aqua-head-shell">
        <div className="aqua-head-brow" aria-hidden />

        <div className="aqua-eyes" aria-hidden>
          <span className="aqua-eye aqua-eye--l">
            <i />
          </span>
          <span className="aqua-eye aqua-eye--r">
            <i />
          </span>
        </div>

        <div className="aqua-bridge" aria-hidden>
          <div className="aqua-core">
            <span className="aqua-core-gem" />
            <span className="aqua-core-ring" />
            <span className="aqua-core-radar" />
          </div>
        </div>

        <div className="aqua-mouth" aria-hidden>
          {[0, 1, 2, 3, 4].map(i => (
            <span
              key={i}
              className="aqua-mouth-bar"
              style={{ ["--bar" as string]: i, animationDelay: `${i * 0.05}s` }}
            />
          ))}
        </div>

        <div className="aqua-jaw-chevron" aria-hidden />
        <div className="aqua-veins" aria-hidden />
      </div>

      {speaking && words.length > 0 ? (
        <p className="aqua-speech-line" aria-live="polite">
          {words.map((w, i) => (
            <span
              key={`${w}-${i}`}
              className={
                i === activeWord
                  ? "aqua-speech-word aqua-speech-word--now"
                  : i < activeWord
                    ? "aqua-speech-word aqua-speech-word--said"
                    : "aqua-speech-word"
              }
            >
              {w}
            </span>
          ))}
        </p>
      ) : latestLine && phase !== "asleep" ? (
        <p className="aqua-soul-line aqua-soul-line--live" aria-live="polite">
          {latestLine}
        </p>
      ) : (
        <p className="aqua-status">{phaseLabel}</p>
      )}

      {hint}
    </div>
  )
}
