/** Demo path state for /jarvis guided stepper + next-chip pulses. */

export type DemoStepId = "wake" | "book" | "tune" | "execute" | "done"

export type DemoStep = {
  id: DemoStepId
  label: string
  hint: string
}

export const DEMO_STEPS: DemoStep[] = [
  { id: "wake", label: "Wake", hint: "Say aqua wake up" },
  { id: "book", label: "Book", hint: "Read the book" },
  { id: "tune", label: "Tune", hint: "Best settings" },
  { id: "execute", label: "Execute", hint: "Commit & swap" },
]

export type DemoFlowCtx = {
  awake: boolean
  sawBook: boolean
  hasProposal: boolean
  settledOnce: boolean
}

export const resolveDemoStep = (ctx: DemoFlowCtx): DemoStepId => {
  if (ctx.settledOnce) return "done"
  if (!ctx.awake) return "wake"
  if (!ctx.sawBook) return "book"
  if (!ctx.hasProposal) return "tune"
  return "execute"
}

/** Chip id to pulse for the current step. */
export const nextChipForStep = (step: DemoStepId): string | null => {
  switch (step) {
    case "wake":
      return "wake"
    case "book":
      return "read-book"
    case "tune":
      return "tune-desk"
    case "execute":
      return "execute"
    default:
      return null
  }
}

export const stepIndex = (id: DemoStepId): number => {
  if (id === "done") return DEMO_STEPS.length
  return DEMO_STEPS.findIndex(s => s.id === id)
}
