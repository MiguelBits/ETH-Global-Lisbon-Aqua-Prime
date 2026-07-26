"use client";

import { useQuery } from "@tanstack/react-query";
import { type Address } from "viem";
import { defaultAgentName, defaultDeskName, resolveAgentEns, resolveDeskEns } from "~~/lib/ens";
import { ipfsGatewayUrl } from "~~/lib/ipfs";

type Props = {
  makerAddress: Address;
};

const shortCid = (cid: string) => (cid.length > 18 ? `${cid.slice(0, 10)}…${cid.slice(-6)}` : cid);

export function EnsIdentityPanel({ makerAddress }: Props) {
  const ensName = defaultDeskName();
  const agentName = defaultAgentName();

  const { data: profile } = useQuery({
    queryKey: ["ensDesk", ensName, makerAddress],
    queryFn: () => resolveDeskEns(ensName, makerAddress),
    staleTime: 60_000,
  });

  const { data: agent } = useQuery({
    queryKey: ["ensAgent", agentName],
    queryFn: () => resolveAgentEns(agentName),
    staleTime: 60_000,
  });

  const gatewayHome = agent?.ipfsCid ? ipfsGatewayUrl(agent.ipfsCid) : null;
  const gatewayCard =
    agent?.endpointA2a?.startsWith("ipfs://")
      ? ipfsGatewayUrl(agent.endpointA2a)
      : agent?.ipfsCid
        ? ipfsGatewayUrl(agent.ipfsCid, "agent/agent-card.json")
        : null;

  return (
    <div className="term-panel space-y-4">
      <div>
        <div className="term-header">
          <span>IDENTITY · DESK</span>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          <dt className="term-label">Desk</dt>
          <dd className="term-value-accent font-mono">{ensName}</dd>
          <dt className="term-label">Maker</dt>
          <dd className="font-mono truncate">{profile?.address ?? makerAddress}</dd>
          <dt className="term-label">Pair</dt>
          <dd className="font-mono">{profile?.pair ?? "WETH/USDC"}</dd>
          <dt className="term-label">Strategy</dt>
          <dd className="truncate font-mono text-[10px]">{profile?.strategyHash ?? "—"}</dd>
        </dl>
      </div>

      <div>
        <div className="term-header">
          <span>IDENTITY · AGENT</span>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          <dt className="term-label">Jarvis</dt>
          <dd className="term-value-accent font-mono">{agent?.name ?? agentName}</dd>
          <dt className="term-label">Role</dt>
          <dd className="font-mono text-[10px]">{agent?.role ?? "—"}</dd>
          <dt className="term-label">Address as</dt>
          <dd className="font-mono">{agent?.addressAs ?? "sir"}</dd>
          <dt className="term-label">Soul</dt>
          <dd className="text-[10px] leading-snug text-[var(--term-muted)] line-clamp-3">
            {agent?.soul ?? "—"}
          </dd>
          <dt className="term-label">Endpoint</dt>
          <dd className="truncate font-mono text-[10px]">{agent?.endpoint ?? "/api/jarvis/propose"}</dd>
          <dt className="term-label">Discovery</dt>
          <dd className="font-mono text-[10px]">{agent?.discoverySource ?? "fallback"}</dd>
          <dt className="term-label">IPFS CID</dt>
          <dd className="font-mono text-[10px]">
            {agent?.ipfsCid ? (
              gatewayHome ? (
                <a
                  href={gatewayHome}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[var(--term-cyan)] underline-offset-2 hover:underline"
                  aria-label="Open agent IPFS gateway"
                  tabIndex={0}
                >
                  {shortCid(agent.ipfsCid)}
                </a>
              ) : (
                shortCid(agent.ipfsCid)
              )
            ) : (
              "—"
            )}
          </dd>
          <dt className="term-label">contenthash</dt>
          <dd className="truncate font-mono text-[10px]" title={agent?.contentHash ?? undefined}>
            {agent?.contentHash ?? "—"}
          </dd>
          {gatewayCard ? (
            <>
              <dt className="term-label">Card</dt>
              <dd className="truncate font-mono text-[10px]">
                <a
                  href={gatewayCard}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[var(--term-cyan)] underline-offset-2 hover:underline"
                  aria-label="Open agent card on IPFS"
                  tabIndex={0}
                >
                  agent-card.json
                </a>
              </dd>
            </>
          ) : null}
        </dl>
      </div>
    </div>
  );
}
