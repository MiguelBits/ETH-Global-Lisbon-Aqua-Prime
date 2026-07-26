/** Server-side Pinata upload for Jarvis agent card / site. */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs"
import { join } from "node:path"
import {
  DEFAULT_AGENT_ENS,
  DEFAULT_ADDRESS_AS,
  DEFAULT_CAPABILITIES,
  DEFAULT_DESK_ENS,
  DEFAULT_JARVIS_SOUL,
  DEFAULT_ROLE,
  DEFAULT_VOICE,
} from "~~/lib/jarvis/soul"
import { primeDeskManifest } from "~~/contracts/manifestMeta"

export type PinAgentResult =
  | {
      ok: true
      cid: string
      uris: {
        gatewayRoot: string
        agentCard: string
        wellKnown: string
        contenthash: string
        endpointA2a: string
      }
      agentEns: string
    }
  | { ok: false; reason: string }

const gatewayBase = () =>
  (process.env.NEXT_PUBLIC_IPFS_GATEWAY || "https://ipfs.io/ipfs").replace(/\/$/, "")

const agentEnsName = () =>
  process.env.NEXT_PUBLIC_JARVIS_ENS ||
  (primeDeskManifest as { jarvisEns?: string }).jarvisEns ||
  DEFAULT_AGENT_ENS

const walkFiles = (dir: string, base = dir): { rel: string; full: string }[] => {
  const out: { rel: string; full: string }[] = []
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...walkFiles(full, base))
    else out.push({ full, rel: full.slice(base.length + 1).replace(/\\/g, "/") })
  }
  return out
}

const buildCardJson = (proposeUrl: string) => {
  const caps = DEFAULT_CAPABILITIES.split(",")
  return {
    name: agentEnsName(),
    role: DEFAULT_ROLE,
    description:
      "Jarvis retunes Aqua Prime heal knobs from the Uniswap tape via 0G Compute. Soul on ENS, brain on 0G, settlement on 1inch Aqua + SwapVM.",
    addressAs: DEFAULT_ADDRESS_AS,
    voice: DEFAULT_VOICE,
    capabilities: caps,
    protocols: {
      web: proposeUrl,
      a2a: "./agent-card.json",
    },
    desk: DEFAULT_DESK_ENS,
    model: "0g:router/0gm-1.0-35b-a3b",
    soul: DEFAULT_JARVIS_SOUL,
  }
}

/**
 * Pin the static public/agent/ directory when available; otherwise pin a single agent-card.json.
 */
export async function pinJarvisAgentToPinata(args?: {
  proposeUrl?: string
}): Promise<PinAgentResult> {
  const jwt = process.env.PINATA_JWT
  if (!jwt) return { ok: false, reason: "PINATA_JWT not set" }

  const proposeUrl =
    args?.proposeUrl ||
    process.env.JARVIS_PUBLIC_PROPOSE_URL ||
    "/api/jarvis/propose"

  const form = new FormData()
  const agentDir = join(process.cwd(), "public", "agent")
  const files = walkFiles(agentDir)

  if (files.length > 0) {
    for (const { full, rel } of files) {
      const buf = new Uint8Array(readFileSync(full))
      form.append("file", new Blob([buf]), `agent/${rel}`)
    }
  } else {
    const card = JSON.stringify(buildCardJson(proposeUrl), null, 2)
    form.append(
      "file",
      new Blob([card], { type: "application/json" }),
      "agent/agent-card.json",
    )
  }

  form.append("pinataMetadata", JSON.stringify({ name: "jarvis.primedesk.eth-agent" }))
  form.append("pinataOptions", JSON.stringify({ cidVersion: 1, wrapWithDirectory: true }))

  try {
    const res = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
      method: "POST",
      headers: { Authorization: `Bearer ${jwt}` },
      body: form,
    })
    const body = (await res.json().catch(() => ({}))) as { IpfsHash?: string; error?: string }
    if (!res.ok || !body.IpfsHash) {
      return {
        ok: false,
        reason: body.error || `Pinata upload failed (${res.status})`,
      }
    }

    const cid = body.IpfsHash
    const g = gatewayBase()
    const agentEns = agentEnsName()
    return {
      ok: true,
      cid,
      agentEns,
      uris: {
        gatewayRoot: `${g}/${cid}/`,
        agentCard: `${g}/${cid}/agent/agent-card.json`,
        wellKnown: `${g}/${cid}/agent/.well-known/agent.json`,
        contenthash: `ipfs://${cid}`,
        endpointA2a: `ipfs://${cid}/agent/agent-card.json`,
      },
    }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "Pinata upload failed" }
  }
}
