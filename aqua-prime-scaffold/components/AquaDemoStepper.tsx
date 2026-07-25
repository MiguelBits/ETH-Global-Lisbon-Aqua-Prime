"use client"

import { DEMO_STEPS, stepIndex, type DemoStepId } from "~~/lib/jarvis/demoFlow"

type Props = {
  step: DemoStepId
  awake: boolean
}

/**
 * Persistent Wake → Book → Tune → Execute progress for the demo path.
 */
export const AquaDemoStepper = ({ step, awake }: Props) => {
  const current = stepIndex(step)
  const activeHint = DEMO_STEPS[Math.min(current, DEMO_STEPS.length - 1)]

  return (
    <nav className="aqua-stepper" aria-label="Demo path">
      <ol className="aqua-stepper-list">
        {DEMO_STEPS.map((s, i) => {
          const done = current > i || step === "done"
          const active = current === i && step !== "done"
          return (
            <li
              key={s.id}
              className={`aqua-step ${done ? "aqua-step--done" : ""} ${active ? "aqua-step--active" : ""}`}
            >
              <span className="aqua-step-dot" aria-hidden />
              <span className="aqua-step-label">{s.label}</span>
            </li>
          )
        })}
      </ol>
      <p className="aqua-stepper-hint">
        {step === "done"
          ? "Path complete — stand by or run another trade."
          : awake
            ? `Next: ${activeHint?.hint ?? "continue"}`
            : "Wake Aqua to start the desk path."}
      </p>
    </nav>
  )
}
