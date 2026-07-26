/** Server-only ENS text writes (attestation + desk knobs). */

import { createWalletClient, http, namehash, type Address, type Hex } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { mainnet, sepolia } from "viem/chains"
import { getLastAttestation, rememberAttestation } from "~~/lib/jarvis/attestationStore"
import { DEFAULT_AGENT_ENS, DEFAULT_DESK_ENS } from "~~/lib/jarvis/soul"
import { primeDeskManifest } from "~~/contracts/manifestMeta"

const ENS_CHAIN = process.env.NEXT_PUBLIC_ENS_CHAIN === "mainnet" ? mainnet : sepolia

const PUBLIC_RESOLVER_ABI = [
  {
    type: "function",
    name: "setText",
    stateMutability: "nonpayable",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "key", type: "string" },
      { name: "value", type: "string" },
    ],
    outputs: [],
  },
] as const

/**
 * Publish last 0G attestation (+ optional heal knobs) to ENS text records.
 * Requires ENS_WRITER_PRIVATE_KEY and ENS_RESOLVER_ADDRESS.
 */
export async function publishAttestationToEns(args?: {
  attestation?: `0x${string}`
  healK?: string
  lambda?: string
}): Promise<{ ok: true; txHash: Hex; agentEns: string } | { ok: false; reason: string }> {
  const pk = process.env.ENS_WRITER_PRIVATE_KEY as Hex | undefined
  const resolver = process.env.ENS_RESOLVER_ADDRESS as Address | undefined
  const agentEns =
    process.env.NEXT_PUBLIC_JARVIS_ENS ||
    (primeDeskManifest as { jarvisEns?: string }).jarvisEns ||
    DEFAULT_AGENT_ENS

  if (!pk) return { ok: false, reason: "ENS_WRITER_PRIVATE_KEY not set" }
  if (!resolver) return { ok: false, reason: "ENS_RESOLVER_ADDRESS not set" }

  const rec = getLastAttestation()
  const attestation = args?.attestation ?? rec?.attestation
  if (!attestation) return { ok: false, reason: "no attestation to publish" }

  try {
    const account = privateKeyToAccount(pk)
    const wallet = createWalletClient({
      account,
      chain: ENS_CHAIN,
      transport: http(
        ENS_CHAIN.id === mainnet.id
          ? process.env.NEXT_PUBLIC_MAINNET_RPC_URL ?? "https://ethereum.publicnode.com"
          : process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL ?? "https://rpc.sepolia.org",
      ),
    })
    const node = namehash(agentEns)
    const txHash = await wallet.writeContract({
      address: resolver,
      abi: PUBLIC_RESOLVER_ABI,
      functionName: "setText",
      args: [node, "agent.attestation", attestation],
    })

    const deskNode = namehash(DEFAULT_DESK_ENS)
    if (args?.healK) {
      await wallet.writeContract({
        address: resolver,
        abi: PUBLIC_RESOLVER_ABI,
        functionName: "setText",
        args: [deskNode, "prime.k", args.healK],
      })
    }
    if (args?.lambda) {
      await wallet.writeContract({
        address: resolver,
        abi: PUBLIC_RESOLVER_ABI,
        functionName: "setText",
        args: [deskNode, "prime.lambda", args.lambda],
      })
    }

    if (rec) rememberAttestation({ ...rec, publishedToEns: true })
    return { ok: true, txHash, agentEns }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "ENS publish failed" }
  }
}
