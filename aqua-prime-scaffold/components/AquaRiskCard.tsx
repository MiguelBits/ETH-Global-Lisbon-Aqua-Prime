"use client"

import { formatUnits } from "viem"
import { formatPct1e18 } from "~~/lib/jarvis/fallback"
import type { JarvisProposal } from "~~/lib/jarvis/schema"

type Props = {
  open: boolean
  proposal: JarvisProposal
  amountIn: string
  sellBase: boolean
  needsApproval: boolean
  execBusy: boolean
  onCancel: () => void
  onConfirm: () => void
}

/**
 * Pre-execute confirmation: size, params, approval, then MetaMask.
 */
export const AquaRiskCard = ({
  open,
  proposal,
  amountIn,
  sellBase,
  needsApproval,
  execBusy,
  onCancel,
  onConfirm,
}: Props) => {
  if (!open) return null

  const sellToken = sellBase ? "WETH" : "USDC"
  const uniOut = proposal.uniswapAvailable && proposal.uniswapOut
    ? sellBase
      ? `${(Number(proposal.uniswapOut) / 1e6).toFixed(2)} USDC`
      : `${Number(formatUnits(BigInt(proposal.uniswapOut), 18)).toFixed(6)} WETH`
    : "tape unavailable"

  return (
    <div className="aqua-risk-scrim" role="presentation">
      <section
        className="aqua-risk-card aqua-panel-dock"
        role="dialog"
        aria-modal="true"
        aria-labelledby="aqua-risk-title"
      >
        <header className="aqua-risk-head">
          <h2 id="aqua-risk-title">Confirm Execute</h2>
          <span className="aqua-tag aqua-tag--ok">armed</span>
        </header>

        <dl className="aqua-risk-grid">
          <div>
            <dt>Ticket</dt>
            <dd>
              {sellBase ? "Sell" : "Buy"} {amountIn} {sellToken}
            </dd>
          </div>
          <div>
            <dt>Uni ref out</dt>
            <dd>{uniOut}</dd>
          </div>
          {proposal.edgeVsUniBps != null ? (
            <div>
              <dt>Edge vs Uni</dt>
              <dd>{proposal.edgeVsUniBps.toFixed(1)} bps</dd>
            </div>
          ) : null}
          <div>
            <dt>Heal k</dt>
            <dd>{formatPct1e18(proposal.params.healK)}</dd>
          </div>
          <div>
            <dt>Max adj</dt>
            <dd>{formatPct1e18(proposal.params.maxAdjustment)}</dd>
          </div>
          <div>
            <dt>Premium</dt>
            <dd>{formatPct1e18(proposal.params.healPremium)}</dd>
          </div>
          <div>
            <dt>Approval</dt>
            <dd>{needsApproval ? "Required before swap" : "Already approved"}</dd>
          </div>
          <div>
            <dt>Settlement</dt>
            <dd>Local fork · Uni quotes are mainnet ref</dd>
          </div>
        </dl>

        <p className="aqua-risk-note">
          MetaMask will prompt: {needsApproval ? "approve → " : ""}stage → dock → ship → swap.
        </p>

        <div className="aqua-risk-actions">
          <button type="button" className="aqua-chip" onClick={onCancel} disabled={execBusy}>
            Cancel
          </button>
          <button
            type="button"
            className="aqua-execute aqua-execute--ready"
            onClick={onConfirm}
            disabled={execBusy}
            aria-label="Confirm execute — open MetaMask"
          >
            {execBusy ? "Executing…" : "Confirm & open MetaMask"}
          </button>
        </div>
      </section>
    </div>
  )
}
