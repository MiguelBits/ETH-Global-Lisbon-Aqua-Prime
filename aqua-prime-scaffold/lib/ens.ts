import { createPublicClient, http, namehash, type Address, type Hex } from "viem"
import { mainnet, sepolia } from "viem/chains"
import { primeDeskManifest } from "~~/contracts/manifestMeta"
import {
  DEFAULT_AGENT_ENS,
  DEFAULT_JARVIS_SOUL,
  DEFAULT_ADDRESS_AS,
  DEFAULT_VOICE,
  DEFAULT_ROLE,
  DEFAULT_CAPABILITIES,
  DEFAULT_DESK_ENS,
  defaultJarvisSoul,
  type JarvisSoul,
} from "~~/lib/jarvis/soul"
import {
  capabilitiesToString,
  decodeEnsContentHash,
  fetchAgentCardFromCid,
  fetchIpfsJson,
  parseIpfsCid,
  parseIpfsPath,
  type JarvisAgentCard,
} from "~~/lib/ipfs"

const ENS_CHAIN = process.env.NEXT_PUBLIC_ENS_CHAIN === "mainnet" ? mainnet : sepolia

const publicClient = createPublicClient({
  chain: ENS_CHAIN,
  transport: http(
    ENS_CHAIN.id === mainnet.id
      ? process.env.NEXT_PUBLIC_MAINNET_RPC_URL ?? "https://ethereum.publicnode.com"
      : process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL ?? "https://rpc.sepolia.org",
  ),
})

const CONTENTHASH_ABI = [
  {
    type: "function",
    name: "contenthash",
    stateMutability: "view",
    inputs: [{ name: "node", type: "bytes32" }],
    outputs: [{ name: "", type: "bytes" }],
  },
] as const

export type DeskEnsProfile = {
  name: string
  address: Address | null
  pair: string | null
  strategyHash: string | null
}

async function ensText(name: string, key: string): Promise<string | null> {
  try {
    return await publicClient.getEnsText({ name, key })
  } catch {
    return null
  }
}

/** Resolve EIP-1577 contenthash via the name's resolver (viem has no getEnsContentHash here). */
async function ensContentHash(name: string): Promise<string | null> {
  try {
    const resolver = await publicClient.getEnsResolver({ name })
    if (!resolver) return null
    const raw = (await publicClient.readContract({
      address: resolver,
      abi: CONTENTHASH_ABI,
      functionName: "contenthash",
      args: [namehash(name)],
    })) as Hex
    return decodeEnsContentHash(raw)
  } catch {
    return null
  }
}

const contentHashToCid = (contentHash: string | null): string | null => {
  if (!contentHash) return null
  return parseIpfsCid(contentHash)
}

export async function resolveDeskEns(name: string, fallbackAddress: Address): Promise<DeskEnsProfile> {
  try {
    const address = await publicClient.getEnsAddress({ name })
    const resolved = (address ?? fallbackAddress) as Address
    const [pair, strategyHash] = await Promise.all([
      ensText(name, "prime.pair"),
      ensText(name, "prime.strategyHash"),
    ])
    return {
      name,
      address: resolved,
      pair: pair ?? "WETH/USDC",
      strategyHash,
    }
  } catch {
    return {
      name,
      address: fallbackAddress,
      pair: "WETH/USDC",
      strategyHash: null,
    }
  }
}

const applyCard = (base: JarvisSoul, card: JarvisAgentCard, markIpfs: boolean): JarvisSoul => {
  const caps = capabilitiesToString(card.capabilities)
  const web = card.protocols?.web
  return {
    ...base,
    soul: card.soul && card.soul.length > 8 ? card.soul : base.soul,
    addressAs: card.addressAs || base.addressAs,
    voice: card.voice || base.voice,
    role: card.role || base.role,
    endpoint: web || base.endpoint,
    desk: card.desk || base.desk,
    model: card.model || base.model,
    capabilities: caps || base.capabilities,
    discoverySource: markIpfs ? "ipfs" : base.discoverySource,
  }
}

/** Resolve Jarvis agent soul + discovery records from ENS (with IPFS card + code fallback). */
export async function resolveAgentEns(name = DEFAULT_AGENT_ENS): Promise<JarvisSoul> {
  const fallback = defaultJarvisSoul()
  const resolvedName =
    (typeof process !== "undefined" && process.env.NEXT_PUBLIC_JARVIS_ENS) || name
  try {
    const [
      soul,
      addressAs,
      voice,
      role,
      endpoint,
      desk,
      model,
      capabilities,
      attestation,
      agentContext,
      endpointWeb,
      endpointA2a,
      contentHash,
    ] = await Promise.all([
      ensText(resolvedName, "agent.soul"),
      ensText(resolvedName, "agent.address_as"),
      ensText(resolvedName, "agent.voice"),
      ensText(resolvedName, "agent.role"),
      ensText(resolvedName, "agent.endpoint"),
      ensText(resolvedName, "agent.desk"),
      ensText(resolvedName, "agent.model"),
      ensText(resolvedName, "agent.capabilities"),
      ensText(resolvedName, "agent.attestation"),
      ensText(resolvedName, "agent-context"),
      ensText(resolvedName, "agent-endpoint[web]"),
      ensText(resolvedName, "agent-endpoint[a2a]"),
      ensContentHash(resolvedName),
    ])

    const preferredEndpoint = endpointWeb || endpoint || fallback.endpoint
    const cidFromContent = contentHashToCid(contentHash)
    const cidFromA2a = parseIpfsCid(endpointA2a)
    const ipfsCid = cidFromContent || cidFromA2a

    let result: JarvisSoul = {
      name: resolvedName,
      soul: soul && soul.length > 8 ? soul : DEFAULT_JARVIS_SOUL,
      addressAs: addressAs || DEFAULT_ADDRESS_AS,
      voice: voice || DEFAULT_VOICE,
      role: role || DEFAULT_ROLE,
      endpoint: preferredEndpoint,
      desk: desk || DEFAULT_DESK_ENS,
      model: model || fallback.model,
      capabilities: capabilities || DEFAULT_CAPABILITIES,
      attestation,
      contentHash,
      ipfsCid,
      agentContext,
      endpointA2a,
      discoverySource: soul || endpointWeb || contentHash || agentContext ? "ens" : "fallback",
    }

    const needCard = !soul || soul.length <= 8
    if (needCard && endpointA2a?.startsWith("ipfs://")) {
      const card = await fetchIpfsJson<JarvisAgentCard>(
        parseIpfsCid(endpointA2a)!,
        parseIpfsPath(endpointA2a) || "agent-card.json",
      )
      if (card) result = applyCard(result, card, true)
    } else if (needCard && ipfsCid) {
      const card = await fetchAgentCardFromCid(ipfsCid)
      if (card) result = applyCard(result, card, true)
    }

    if (result.soul === DEFAULT_JARVIS_SOUL && !soul && !result.ipfsCid && !agentContext) {
      result = { ...result, discoverySource: "fallback" }
    }

    return result
  } catch {
    return { ...fallback, name: resolvedName }
  }
}

/** Reverse-resolve wallet → ENS name for principal addressing. */
export async function resolvePrincipalEns(address: Address | undefined | null): Promise<string | null> {
  if (!address) return null
  try {
    return await publicClient.getEnsName({ address })
  } catch {
    return null
  }
}

export function defaultDeskName() {
  return primeDeskManifest.ensName || DEFAULT_DESK_ENS
}

export function defaultAgentName() {
  return (
    process.env.NEXT_PUBLIC_JARVIS_ENS ??
    (primeDeskManifest as { jarvisEns?: string }).jarvisEns ??
    DEFAULT_AGENT_ENS
  )
}
