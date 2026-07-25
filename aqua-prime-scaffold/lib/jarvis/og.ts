import { keccak256, toBytes } from "viem"
import { clampDeskSet, type JarvisDeskSet } from "./schema"
import {
  buildAdviseSystemPrompt,
  buildAdviseUserPrompt,
  buildCritiqueUserPrompt,
  buildHealNarrateSystemPrompt,
  buildHealNarrateUserPrompt,
  buildJarvisSystemPrompt,
  buildProposeUserPrompt,
  type HealPathCtx,
  type ProposeMarketCtx,
} from "./prompt"
import { stripCommaBeforeSir } from "./speech"
import type { JarvisSoul } from "./soul"

const ROUTER_URL = process.env.ZEROG_ROUTER_URL ?? "https://router-api.0g.ai/v1"
const DEFAULT_MODEL = process.env.ZEROG_MODEL ?? "0gm-1.0-35b-a3b"

export type OgResult =
  | {
      ok: true
      params: JarvisDeskSet
      line: string
      attestation: `0x${string}`
      model: string
      critiqued: boolean
    }
  | { ok: false; reason: string }

export type OgLineResult =
  | { ok: true; line: string; model: string; raw?: Record<string, unknown> }
  | { ok: false; reason: string }

/** Honor ENS `agent.model` (e.g. `0g:router/0gm-1.0-35b-a3b`) over bare env default. */
export function resolveZeroGModel(soulModel?: string | null): string {
  if (!soulModel) return DEFAULT_MODEL
  const trimmed = soulModel.trim()
  if (!trimmed || /default/i.test(trimmed)) return DEFAULT_MODEL
  const router = trimmed.match(/0g:router\/(.+)$/i)
  if (router?.[1] && !/default/i.test(router[1])) return router[1].trim()
  if (/^[\w./:-]+$/.test(trimmed) && !trimmed.startsWith("0g:")) return trimmed
  return DEFAULT_MODEL
}

function extractJson(text: string): Record<string, unknown> | null {
  const trimmed = text.trim()
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = fence ? fence[1].trim() : trimmed
  const start = body.indexOf("{")
  const end = body.lastIndexOf("}")
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(body.slice(start, end + 1)) as Record<string, unknown>
  } catch {
    return null
  }
}

type ChatOk = { ok: true; content: string; chatId: string | null; model: string }
type ChatFail = { ok: false; reason: string }

async function chatCompletions(args: {
  model: string
  system: string
  user: string
  temperature?: number
}): Promise<ChatOk | ChatFail> {
  const apiKey = process.env.ZEROG_API_KEY
  if (!apiKey) return { ok: false, reason: "ZEROG_API_KEY not set" }

  try {
    const res = await fetch(`${ROUTER_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: args.model,
        temperature: args.temperature ?? 0.2,
        messages: [
          { role: "system", content: args.system },
          { role: "user", content: args.user },
        ],
      }),
    })

    if (!res.ok) {
      return { ok: false, reason: `0G HTTP ${res.status}: ${await res.text()}` }
    }

    const chatId = res.headers.get("ZG-Res-Key") ?? res.headers.get("zg-res-key")
    const data = (await res.json()) as {
      id?: string
      choices?: { message?: { content?: string } }[]
    }
    const content = data.choices?.[0]?.message?.content
    if (!content) return { ok: false, reason: "empty 0G content" }
    return { ok: true, content, chatId: chatId ?? data.id ?? null, model: args.model }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "0G request failed" }
  }
}

/** Ask once; if not JSON, retry with a strict repair turn. */
async function chatJson(args: {
  model: string
  system: string
  user: string
  temperature?: number
}): Promise<(ChatOk & { parsed: Record<string, unknown> }) | ChatFail> {
  const first = await chatCompletions(args)
  if (!first.ok) return first

  let parsed = extractJson(first.content)
  if (parsed) return { ...first, parsed }

  const repair = await chatCompletions({
    model: args.model,
    system: args.system,
    user: [
      "Your previous reply was not valid JSON. Reply with ONLY a JSON object — no prose, no fences.",
      "Original task:",
      args.user,
      "Invalid reply was:",
      first.content.slice(0, 1200),
    ].join("\n"),
    temperature: 0,
  })
  if (!repair.ok) return repair
  parsed = extractJson(repair.content)
  if (!parsed) return { ok: false, reason: "0G response not JSON after retry" }
  return { ...repair, parsed }
}

function deskFromParsed(
  parsed: Record<string, unknown>,
  addressAs: string,
  attestationSource: string,
): { params: JarvisDeskSet; line: string; attestation: `0x${string}` } {
  const healK = BigInt(String(parsed.healK ?? "0"))
  const maxAdjustment = BigInt(String(parsed.maxAdjustment ?? "0"))
  const healPremium = BigInt(String(parsed.healPremium ?? "0"))
  const lambda = BigInt(String(parsed.lambda ?? "0"))
  const line = stripCommaBeforeSir(
    typeof parsed.line === "string" && parsed.line.length > 0
      ? parsed.line
      : `Certainly ${addressAs}. Desk parameters are ready.`,
  )
  const attestation = keccak256(toBytes(attestationSource)) as `0x${string}`
  const params = clampDeskSet({
    healK,
    maxAdjustment,
    healPremium,
    lambda,
    attestation,
  })
  return { params, line, attestation }
}

/**
 * 0G Compute Router propose with enriched market context, JSON repair, optional critique retune.
 */
export async function proposeWithZeroG(args: {
  soul: JarvisSoul
  market: ProposeMarketCtx
  /** When set and edge trails Uni by more than this many bps, run a critique pass. */
  edgeVsUniBps?: number | null
  critiqueBelowBps?: number
}): Promise<OgResult> {
  const model = resolveZeroGModel(args.soul.model)
  const system = buildJarvisSystemPrompt(args.soul)
  const user = buildProposeUserPrompt(args.market)

  const first = await chatJson({ model, system, user })
  if (!first.ok) return first

  let { params, line, attestation } = deskFromParsed(
    first.parsed,
    args.soul.addressAs,
    first.chatId ?? first.content.slice(0, 64),
  )
  let critiqued = false

  const edge = args.edgeVsUniBps
  const floor = args.critiqueBelowBps ?? -8
  if (edge != null && edge < floor) {
    const critique = await chatJson({
      model,
      system,
      user: buildCritiqueUserPrompt({
        prior: args.market,
        priorParams: {
          healK: params.healK.toString(),
          maxAdjustment: params.maxAdjustment.toString(),
          healPremium: params.healPremium.toString(),
          lambda: params.lambda.toString(),
          line,
        },
        edgeVsUniBps: edge,
      }),
      temperature: 0.1,
    })
    if (critique.ok) {
      const revised = deskFromParsed(
        critique.parsed,
        args.soul.addressAs,
        critique.chatId ?? critique.content.slice(0, 64),
      )
      params = revised.params
      line = revised.line
      attestation = revised.attestation
      critiqued = true
    }
  }

  return { ok: true, params, line, attestation, model, critiqued }
}

export async function adviseWithZeroG(args: {
  soul: JarvisSoul
  amountIn: string
  sellBase: boolean
  skewPct: number
  balBase: string
  balQuote: string
  uniswapOut: string | null
  healHint: string
  principalEns: string | null
}): Promise<OgLineResult> {
  const model = resolveZeroGModel(args.soul.model)
  const res = await chatJson({
    model,
    system: buildAdviseSystemPrompt(args.soul),
    user: buildAdviseUserPrompt(args),
    temperature: 0.35,
  })
  if (!res.ok) return res
  const line =
    typeof res.parsed.line === "string" && res.parsed.line.length > 0
      ? stripCommaBeforeSir(res.parsed.line)
      : null
  if (!line) return { ok: false, reason: "advise missing line" }
  return { ok: true, line, model, raw: res.parsed }
}

export async function narrateHealPathWithZeroG(args: {
  soul: JarvisSoul
  healPath: HealPathCtx
  principalEns: string | null
}): Promise<OgLineResult> {
  const model = resolveZeroGModel(args.soul.model)
  const res = await chatJson({
    model,
    system: buildHealNarrateSystemPrompt(args.soul),
    user: buildHealNarrateUserPrompt({ ...args.healPath, principalEns: args.principalEns }),
    temperature: 0.4,
  })
  if (!res.ok) return res
  const line =
    typeof res.parsed.line === "string" && res.parsed.line.length > 0
      ? stripCommaBeforeSir(res.parsed.line)
      : null
  if (!line) return { ok: false, reason: "narrate missing line" }
  return { ok: true, line, model }
}

export type { HealPathCtx, ProposeMarketCtx }
