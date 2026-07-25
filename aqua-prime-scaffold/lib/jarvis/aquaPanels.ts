/** Which HUD surfaces to reveal for a given Aqua brain intent. */

import type { AquaBrainKind } from "./aquaBrain"

export type AquaHudPanels = {
  /** Book balances / skew dashboard */
  pool: boolean
  /** Sell/buy + amount ticket */
  ticket: boolean
  /** Heal knob / simulation stream */
  calc: boolean
  /** Multi-swap heal path simulation */
  healSim: boolean
  /** Advise trade radar / bias needle */
  advise: boolean
  /** Maker SOR (best route / best size) */
  sor: boolean
  /** Execute (MetaMask commit+swap) affordance on the ticket */
  execute: boolean
  /** PrimeSelector routes + excluded alternatives */
  routes: boolean
}

export const HIDDEN_PANELS: AquaHudPanels = {
  pool: false,
  ticket: false,
  calc: false,
  healSim: false,
  advise: false,
  sor: false,
  execute: false,
  routes: false,
}

/**
 * Map brain kind → visible panels.
 * `hasProposal` unlocks calc simulations / execute when a trade desk-set is already armed.
 */
export function panelsForKind(kind: AquaBrainKind, hasProposal: boolean): AquaHudPanels {
  switch (kind) {
    case "sleep":
      return { ...HIDDEN_PANELS }
    case "book":
      return {
        pool: true,
        ticket: false,
        calc: hasProposal,
        healSim: false,
        advise: false,
        sor: false,
        execute: false,
        routes: hasProposal,
      }
    case "advise":
      return {
        pool: true,
        ticket: true,
        calc: false,
        healSim: false,
        advise: true,
        sor: false,
        execute: true,
        routes: hasProposal,
      }
    case "route":
    case "optimize":
    case "action":
      return {
        pool: true,
        ticket: true,
        calc: hasProposal,
        healSim: false,
        advise: false,
        sor: kind !== "action",
        execute: true,
        routes: true,
      }
    case "propose":
      return {
        pool: true,
        ticket: true,
        calc: true,
        healSim: false,
        advise: false,
        sor: false,
        execute: true,
        routes: true,
      }
    case "simulate":
      return {
        pool: true,
        ticket: false,
        calc: false,
        healSim: true,
        advise: false,
        sor: false,
        execute: false,
        routes: false,
      }
    case "explain":
      return {
        pool: false,
        ticket: hasProposal,
        calc: true,
        healSim: false,
        advise: false,
        sor: false,
        execute: hasProposal,
        routes: hasProposal,
      }
    case "execute":
      return {
        pool: true,
        ticket: true,
        calc: hasProposal,
        healSim: false,
        advise: false,
        sor: false,
        execute: true,
        routes: hasProposal,
      }
    case "identity":
    case "generic":
    default:
      // Caller should keep the previous panel set for these.
      return { ...HIDDEN_PANELS }
  }
}

export function hudLayoutClass(panels: AquaHudPanels): string {
  const parts = ["aqua-hud"]
  if (panels.pool) parts.push("aqua-hud--pool")
  if (panels.calc || panels.healSim || panels.advise || panels.sor) parts.push("aqua-hud--calc")
  if (panels.ticket) parts.push("aqua-hud--ticket")
  if (panels.routes) parts.push("aqua-hud--routes")
  return parts.join(" ")
}
