/** IPFS gateway helpers for Jarvis agent card discovery. */

import { hexToBytes, type Hex } from "viem"
// Package exports typings break under moduleResolution bundler; runtime is fine.
// @ts-expect-error multiformats/cid types not resolved via exports map
import { CID } from "multiformats/cid"

const DEFAULT_GATEWAY = "https://ipfs.io/ipfs"

export const ipfsGatewayBase = (): string => {
  const g =
    (typeof process !== "undefined" && process.env.NEXT_PUBLIC_IPFS_GATEWAY) || DEFAULT_GATEWAY
  return g.replace(/\/$/, "")
}

/** Extract CID from ipfs://URI, /ipfs/path, or bare CID. */
export const parseIpfsCid = (uriOrCid: string | null | undefined): string | null => {
  if (!uriOrCid) return null
  const s = uriOrCid.trim()
  if (!s) return null
  if (s.startsWith("ipfs://")) {
    const rest = s.slice("ipfs://".length).replace(/^ipfs\//, "")
    const cid = rest.split("/")[0]
    return cid || null
  }
  const m = s.match(/\/ipfs\/([^/?#]+)/)
  if (m?.[1]) return m[1]
  if (/^[a-zA-Z0-9]{46,}$/.test(s) || s.startsWith("bafy") || s.startsWith("Qm")) return s
  return null
}

/** Path after CID for ipfs://CID/path URIs. */
export const parseIpfsPath = (uri: string | null | undefined): string => {
  if (!uri?.startsWith("ipfs://")) return ""
  const rest = uri.slice("ipfs://".length).replace(/^ipfs\//, "")
  const parts = rest.split("/")
  return parts.slice(1).join("/")
}

export const ipfsGatewayUrl = (cidOrUri: string, path = ""): string => {
  const cid = parseIpfsCid(cidOrUri)
  if (!cid) return ""
  const fromUri = parseIpfsPath(cidOrUri.startsWith("ipfs://") ? cidOrUri : "")
  const p = (path || fromUri).replace(/^\//, "")
  return p ? `${ipfsGatewayBase()}/${cid}/${p}` : `${ipfsGatewayBase()}/${cid}`
}

/**
 * Decode ENS EIP-1577 contenthash bytes to ipfs://CID when possible.
 * Returns null for empty / unsupported codecs.
 */
export const decodeEnsContentHash = (raw: Hex | string | null | undefined): string | null => {
  if (!raw || raw === "0x" || raw === "0x00") return null
  try {
    const bytes = hexToBytes(raw as Hex)
    if (bytes.length < 2) return null
    // 0xe3 = ipfs-ns (EIP-1577)
    if (bytes[0] !== 0xe3) return null
    const cid = CID.decode(bytes.subarray(1))
    return `ipfs://${cid.toString()}`
  } catch {
    return null
  }
}

export type JarvisAgentCard = {
  name?: string
  role?: string
  description?: string
  addressAs?: string
  voice?: string
  capabilities?: string[] | string
  protocols?: { web?: string; a2a?: string }
  desk?: string
  model?: string
  soul?: string
}

export async function fetchIpfsJson<T = unknown>(cidOrUri: string, path = ""): Promise<T | null> {
  const url = ipfsGatewayUrl(cidOrUri, path)
  if (!url) return null
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

/** Try common card paths under a contenthash CID root. */
export async function fetchAgentCardFromCid(cid: string): Promise<JarvisAgentCard | null> {
  const paths = [
    "agent-card.json",
    "agent/agent-card.json",
    ".well-known/agent.json",
    "agent/.well-known/agent.json",
  ]
  for (const p of paths) {
    const card = await fetchIpfsJson<JarvisAgentCard>(cid, p)
    if (card && (card.name || card.role || card.soul || card.protocols)) return card
  }
  return null
}

export const capabilitiesToString = (caps: string[] | string | undefined): string | null => {
  if (!caps) return null
  if (typeof caps === "string") return caps
  return caps.join(",")
}
