"use client"

import { useQuery } from "@tanstack/react-query"
import { useAccount } from "wagmi"
import { AquaTerm } from "~~/components/AquaTerm"
import { defaultAgentName, defaultDeskName, resolveAgentEns, resolvePrincipalEns } from "~~/lib/ens"
import type { JarvisProposal } from "~~/lib/jarvis/schema"

type Props = {
  awake: boolean
  proposal: JarvisProposal | null
}

const shortHash = (h: string) => (h.length > 14 ? `${h.slice(0, 8)}…${h.slice(-4)}` : h)

/**
 * ENS + 0G custody strip for /jarvis — agent soul, desk, principal, attestation.
 */
export const AquaIdentityStrip = ({ awake, proposal }: Props) => {
  const { address } = useAccount()
  const agentName = defaultAgentName()
  const deskName = defaultDeskName()

  const { data: agent } = useQuery({
    queryKey: ["aquaEnsAgent", agentName],
    queryFn: () => resolveAgentEns(agentName),
    staleTime: 60_000,
    enabled: awake,
  })

  const { data: principalEns } = useQuery({
    queryKey: ["aquaPrincipalEns", address],
    queryFn: () => resolvePrincipalEns(address),
    staleTime: 60_000,
    enabled: awake && !!address,
  })

  if (!awake) return null

  const attestation = proposal?.params.attestation
  const zeroAttest = !attestation || /^0x0+$/.test(attestation)

  return (
    <aside className="aqua-id-strip" aria-label="ENS and 0G identity">
      <div className="aqua-id-row">
        <span className="aqua-id-k">
          <AquaTerm id="ens">Agent</AquaTerm>
        </span>
        <span className="aqua-id-v aqua-holo-num">{agent?.name ?? agentName}</span>
      </div>
      <div className="aqua-id-row">
        <span className="aqua-id-k">
          <AquaTerm id="desk">Desk</AquaTerm>
        </span>
        <span className="aqua-id-v">{agent?.desk ?? deskName}</span>
      </div>
      <div className="aqua-id-row">
        <span className="aqua-id-k">
          <AquaTerm id="ens">Principal</AquaTerm>
        </span>
        <span className="aqua-id-v">
          {principalEns ?? (address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "—")}
        </span>
      </div>
      <div className="aqua-id-row">
        <span className="aqua-id-k">
          <AquaTerm id="0g">Model</AquaTerm>
        </span>
        <span className="aqua-id-v">
          {proposal?.modelUsed ?? agent?.model ?? "—"}
          {proposal?.mode ? ` · ${proposal.mode}` : ""}
          {proposal?.critiqued ? " · critiqued" : ""}
        </span>
      </div>
      <div className="aqua-id-row">
        <span className="aqua-id-k">
          <AquaTerm id="attestation">Attest</AquaTerm>
        </span>
        <span className="aqua-id-v aqua-id-attest" title={attestation ?? undefined}>
          {zeroAttest ? "pending" : shortHash(attestation!)}
        </span>
      </div>
      <div className="aqua-id-row">
        <span className="aqua-id-k">
          <AquaTerm id="ens">IPFS</AquaTerm>
        </span>
        <span className="aqua-id-v" title={agent?.contentHash ?? agent?.ipfsCid ?? undefined}>
          {agent?.ipfsCid
            ? `${shortHash(agent.ipfsCid)} · ${agent.discoverySource ?? "ens"}`
            : agent?.discoverySource ?? "fallback"}
        </span>
      </div>
    </aside>
  )
}
