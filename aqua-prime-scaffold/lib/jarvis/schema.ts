/** Jarvis desk-set schema (mirrors AquaPrimeSwapGateway.DeskSet + spoken line). */

import type { TapeIntel } from "~~/lib/jarvis/tapeIntel"
import { stripCommaBeforeSir } from "./speech"

export const MAX_HEAL_K = 8n * 10n ** 17n // 0.8e18
export const MAX_ADJUSTMENT = 10n ** 17n // 0.1e18
export const MAX_HEAL_PREMIUM = 2n * 10n ** 16n // 0.02e18
export const MIN_LAMBDA = 5n * 10n ** 8n
export const MAX_LAMBDA = 5n * 10n ** 9n

export type JarvisMode = "local" | "0g"

export type JarvisDeskSet = {
  healK: bigint
  maxAdjustment: bigint
  healPremium: bigint
  lambda: bigint
  deadline: bigint
  attestation: `0x${string}`
}

export type JarvisProposal = {
  params: JarvisDeskSet
  line: string
  mode: JarvisMode
  uniswapOut: string | null
  uniswapAvailable: boolean
  agentEns: string
  edgeVsUniBps: number | null
  modelUsed?: string | null
  critiqued?: boolean
  /** Rich Uniswap intel for UI + debugging */
  tapeIntel?: TapeIntel | null
}

function clamp(v: bigint, min: bigint, max: bigint): bigint {
  if (v < min) return min
  if (v > max) return max
  return v
}

export function clampDeskSet(raw: {
  healK: bigint
  maxAdjustment: bigint
  healPremium: bigint
  lambda: bigint
  deadline?: bigint
  attestation?: `0x${string}`
}): JarvisDeskSet {
  return {
    healK: clamp(raw.healK, 10n ** 16n, MAX_HEAL_K),
    maxAdjustment: clamp(raw.maxAdjustment, 2n * 10n ** 16n, MAX_ADJUSTMENT),
    healPremium: clamp(raw.healPremium, 0n, MAX_HEAL_PREMIUM),
    lambda: clamp(raw.lambda, MIN_LAMBDA, MAX_LAMBDA),
    deadline: raw.deadline ?? BigInt(Math.floor(Date.now() / 1000) + 180),
    attestation:
      raw.attestation ??
      ("0x0000000000000000000000000000000000000000000000000000000000000000" as const),
  }
}

export function serializeProposal(p: JarvisProposal) {
  return {
    params: {
      healK: p.params.healK.toString(),
      maxAdjustment: p.params.maxAdjustment.toString(),
      healPremium: p.params.healPremium.toString(),
      lambda: p.params.lambda.toString(),
      deadline: p.params.deadline.toString(),
      attestation: p.params.attestation,
    },
    line: p.line,
    mode: p.mode,
    uniswapOut: p.uniswapOut,
    uniswapAvailable: p.uniswapAvailable,
    agentEns: p.agentEns,
    edgeVsUniBps: p.edgeVsUniBps,
    modelUsed: p.modelUsed ?? null,
    critiqued: p.critiqued ?? false,
    tapeIntel: p.tapeIntel ?? null,
  }
}

export function parseProposalJson(body: ReturnType<typeof serializeProposal>): JarvisProposal {
  return {
    params: clampDeskSet({
      healK: BigInt(body.params.healK),
      maxAdjustment: BigInt(body.params.maxAdjustment),
      healPremium: BigInt(body.params.healPremium),
      lambda: BigInt(body.params.lambda),
      deadline: BigInt(body.params.deadline),
      attestation: body.params.attestation as `0x${string}`,
    }),
    line: stripCommaBeforeSir(body.line),
    mode: body.mode,
    uniswapOut: body.uniswapOut,
    uniswapAvailable: body.uniswapAvailable,
    agentEns: body.agentEns,
    edgeVsUniBps: body.edgeVsUniBps,
    modelUsed: body.modelUsed,
    critiqued: body.critiqued,
    tapeIntel: body.tapeIntel ?? null,
  }
}
