"use client"

import { parseUnits } from "viem"
import { AquaHolo } from "~~/components/AquaHolo"

const PRESETS: Record<"base" | "quote", string[]> = {
  base: ["0.5", "1", "5", "10"],
  quote: ["1000", "5000", "10000"],
}

export type AquaTradeTicketProps = {
  awake: boolean
  amountIn: string
  sellBase: boolean
  hasProposal: boolean
  /** When false, hide Execute / MetaMask path (advise-only ticket). */
  showExecute: boolean
  execBusy: boolean
  execNote: string | null
  canExecute: boolean
  executeDisabledReason: string | null
  onAmountIn: (v: string) => void
  onSellBase: (v: boolean) => void
  onAdvise: () => void
  onTune: () => void
  onExecute: () => void
}

export const AquaTradeTicket = ({
  awake,
  amountIn,
  sellBase,
  hasProposal,
  showExecute,
  execBusy,
  execNote,
  canExecute,
  executeDisabledReason,
  onAmountIn,
  onSellBase,
  onAdvise,
  onTune,
  onExecute,
}: AquaTradeTicketProps) => {
  const sellToken = sellBase ? "WETH" : "USDC"
  const presets = PRESETS[sellBase ? "base" : "quote"]
  const executeBlocked = !canExecute || !!executeDisabledReason

  return (
    <AquaHolo
      as="section"
      className={`aqua-side aqua-ticket aqua-panel-dock ${awake ? "aqua-side--live" : "aqua-side--muted"}`}
      aria-label="Trade ticket"
    >
      <header className="aqua-side-head">
        <span>Ticket</span>
        <span className={`aqua-tag ${hasProposal ? "aqua-tag--ok aqua-tag--pulse" : ""}`}>
          {hasProposal ? "armed" : "set size"}
        </span>
      </header>

      <div className="aqua-ticket-dir aqua-stagger">
        <button
          type="button"
          className={`aqua-dir ${sellBase ? "aqua-dir--on" : ""}`}
          style={{ ["--i" as string]: 0 }}
          onClick={() => onSellBase(true)}
          disabled={!awake || execBusy}
        >
          Sell WETH to USDC
        </button>
        <button
          type="button"
          className={`aqua-dir ${!sellBase ? "aqua-dir--on" : ""}`}
          style={{ ["--i" as string]: 1 }}
          onClick={() => onSellBase(false)}
          disabled={!awake || execBusy}
        >
          Buy WETH from USDC
        </button>
      </div>

      <label className="aqua-ticket-label">
        Amount in ({sellToken})
        <input
          className="aqua-ticket-input"
          inputMode="decimal"
          value={amountIn}
          onChange={e => onAmountIn(e.target.value)}
          disabled={!awake || execBusy}
          aria-label={`Amount in ${sellToken}`}
        />
      </label>

      <div className="aqua-ticket-presets" role="group" aria-label="Amount presets">
        {presets.map(p => (
          <button
            key={p}
            type="button"
            className={`aqua-chip ${amountIn === p ? "aqua-chip--on" : ""}`}
            onClick={() => onAmountIn(p)}
            disabled={!awake || execBusy}
          >
            {p}
          </button>
        ))}
      </div>

      <div className="aqua-ticket-actions">
        <button
          type="button"
          className="aqua-chip"
          disabled={!awake || execBusy || amountWei(amountIn, sellBase) === 0n}
          onClick={onAdvise}
        >
          Advise trade
        </button>
        <button
          type="button"
          className="aqua-chip"
          disabled={!awake || execBusy || amountWei(amountIn, sellBase) === 0n}
          onClick={onTune}
        >
          Best settings
        </button>
      </div>

      {showExecute ? (
        <>
          <button
            type="button"
            className={`aqua-execute ${hasProposal && !execBusy && !executeBlocked ? "aqua-execute--ready" : ""}`}
            disabled={!awake || !hasProposal || execBusy || executeBlocked}
            onClick={onExecute}
            aria-label={
              executeDisabledReason
                ? `Execute blocked: ${executeDisabledReason}`
                : "Execute trade — review risk then MetaMask"
            }
            title={executeDisabledReason ?? undefined}
          >
            {execBusy ? "Executing…" : "Execute trade"}
          </button>

          {!hasProposal ? (
            <p className="aqua-ticket-hint">Press Best settings to arm the desk — then Execute trade.</p>
          ) : null}
          {hasProposal && executeDisabledReason ? (
            <p className="aqua-ticket-hint aqua-ticket-hint--warn">{executeDisabledReason}</p>
          ) : null}
          {hasProposal && canExecute && !executeDisabledReason ? (
            <p className="aqua-ticket-hint">Ready — Execute opens a confirm card, then MetaMask.</p>
          ) : null}
          {execNote ? <p className="aqua-ticket-hint">{execNote}</p> : null}
        </>
      ) : (
        <p className="aqua-ticket-hint">Advise sets direction — Best settings arms Execute.</p>
      )}
    </AquaHolo>
  )
}

export function amountWei(amountIn: string, sellBase: boolean): bigint {
  try {
    return parseUnits(amountIn || "0", sellBase ? 18 : 6)
  } catch {
    return 0n
  }
}
