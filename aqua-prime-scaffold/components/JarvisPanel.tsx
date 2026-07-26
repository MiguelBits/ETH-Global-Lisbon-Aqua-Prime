"use client";

import { useEffect, useState } from "react";
import { AquaTapeIntel } from "~~/components/AquaTapeIntel";
import type { JarvisProposal } from "~~/lib/jarvis/schema";
import { formatPct1e18 } from "~~/lib/jarvis/fallback";
import { parseProposalJson } from "~~/lib/jarvis/schema";

export type JarvisUiState = "idle" | "thinking" | "armed" | "committing" | "settled";

type Props = {
  amountInWei: bigint;
  sellBase: boolean;
  balBase: bigint;
  balQuote: bigint;
  ethUsd1e18: bigint;
  busy: boolean;
  state: JarvisUiState;
  proposal: JarvisProposal | null;
  statusNote: string | null;
  onPropose: () => void;
  onCommitAndSwap: () => void;
  canCommit: boolean;
};

export function JarvisPanel({
  amountInWei,
  sellBase,
  busy,
  state,
  proposal,
  statusNote,
  onPropose,
  onCommitAndSwap,
  canCommit,
}: Props) {
  const [pulse, setPulse] = useState(false);
  useEffect(() => {
    if (state === "thinking") {
      setPulse(true);
      return;
    }
    setPulse(false);
  }, [state]);

  return (
    <div className="term-panel">
      <div className="term-header">
        <span>JARVIS · desk agent</span>
        <span className="text-[10px] term-label">
          {state === "thinking" ? "thinking…" : state === "armed" ? "armed" : state === "committing" ? "committing" : state}
        </span>
      </div>

      <p className={`mb-3 text-xs leading-relaxed ${pulse ? "opacity-70" : ""}`}>
        {proposal?.line ??
          (amountInWei === 0n
            ? "Awaiting trade parameters sir."
            : "Ready to consult the Uniswap tape and retune heal settings sir.")}
      </p>

      {proposal ? (
        <dl className="mb-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[10px]">
          <dt className="term-label">Mode</dt>
          <dd className="font-mono uppercase">
            {proposal.mode}
            {proposal.critiqued ? " · critiqued" : ""}
          </dd>
          <dt className="term-label">Agent</dt>
          <dd className="font-mono truncate">{proposal.agentEns}</dd>
          {proposal.modelUsed ? (
            <>
              <dt className="term-label">Model</dt>
              <dd className="font-mono truncate">{proposal.modelUsed}</dd>
            </>
          ) : null}
          <dt className="term-label">Attest</dt>
          <dd className="font-mono truncate text-[10px]">{proposal.params.attestation}</dd>
          <dt className="term-label">Heal k</dt>
          <dd className="font-mono">{formatPct1e18(proposal.params.healK)}</dd>
          <dt className="term-label">Max adj</dt>
          <dd className="font-mono">{formatPct1e18(proposal.params.maxAdjustment)}</dd>
          <dt className="term-label">Premium</dt>
          <dd className="font-mono">{formatPct1e18(proposal.params.healPremium)}</dd>
          <dt className="term-label">λ</dt>
          <dd className="font-mono">{proposal.params.lambda.toString()}</dd>
          <dt className="term-label">Uni out</dt>
          <dd className="font-mono">
            {proposal.uniswapAvailable && proposal.uniswapOut
              ? sellBase
                ? `${(Number(proposal.uniswapOut) / 1e6).toFixed(2)} USDC`
                : `${(Number(proposal.uniswapOut) / 1e18).toFixed(6)} WETH`
              : "tape unavailable"}
          </dd>
          {proposal.edgeVsUniBps != null ? (
            <>
              <dt className="term-label">Edge vs Uni</dt>
              <dd className="font-mono">{proposal.edgeVsUniBps.toFixed(1)} bps</dd>
            </>
          ) : null}
        </dl>
      ) : null}

      {proposal?.tapeIntel ? (
        <div className="mb-3">
          <AquaTapeIntel compact tape={proposal.tapeIntel} />
        </div>
      ) : null}

      {statusNote ? <p className="mb-2 text-[10px] term-label">{statusNote}</p> : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="term-btn text-[10px]"
          disabled={busy || amountInWei === 0n || state === "thinking"}
          onClick={onPropose}
        >
          Consult Jarvis
        </button>
        <button
          type="button"
          className="term-btn text-[10px]"
          disabled={busy || !canCommit || !proposal}
          onClick={onCommitAndSwap}
        >
          Commit desk & swap
        </button>
      </div>
    </div>
  );
}

/** Fetch helper for desk page. */
export async function fetchJarvisProposal(args: {
  amountInWei: bigint;
  sellBase: boolean;
  balBase: bigint;
  balQuote: bigint;
  ethUsd1e18: bigint;
}): Promise<JarvisProposal> {
  const res = await fetch("/api/jarvis/propose", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      amountIn: args.amountInWei.toString(),
      sellBase: args.sellBase,
      balBase: args.balBase.toString(),
      balQuote: args.balQuote.toString(),
      ethUsd1e18: args.ethUsd1e18.toString(),
    }),
  });
  if (!res.ok) throw new Error(await res.text());
  const json = await res.json();
  return parseProposalJson(json);
}
