"use client"

import { ConnectButton } from "@rainbow-me/rainbowkit"
import { useAccount } from "wagmi"
import { commitMakerGate } from "~~/lib/jarvis/commitDeskAndSwap"
import { primeDeskManifest } from "~~/contracts/manifestMeta"

type Props = {
  awake: boolean
  bookSource: "live" | "demo"
  makerGate: string | null
}

/**
 * Masthead status: wallet, maker role, live/demo book, mainnet vs fork settlement.
 */
export const AquaStatusBanner = ({ awake, bookSource, makerGate }: Props) => {
  const { address, isConnected } = useAccount()
  const gate = address ? commitMakerGate(address) : "Connect wallet to Execute."
  const isMaker = isConnected && !gate
  const showGate = awake && (makerGate || gate)

  return (
    <aside className="aqua-status-banner" aria-label="Session status">
      <div className="aqua-status-badges">
        <span
          className={`aqua-badge ${bookSource === "live" ? "aqua-badge--ok" : "aqua-badge--warn"}`}
          title={
            bookSource === "live"
              ? "Balances from the live Aqua Prime gateway"
              : "Using demo inventory until the gateway book is readable"
          }
        >
          {bookSource === "live" ? "Live book" : "Demo book"}
        </span>
        <span
          className="aqua-badge aqua-badge--info"
          title="Uniswap quotes are mainnet reference; commits settle on the local fork"
        >
          Uni mainnet · settle fork
        </span>
        {awake ? (
          <span
            className={`aqua-badge ${isMaker ? "aqua-badge--ok" : "aqua-badge--warn"}`}
            title={
              isMaker
                ? "Connected as desk maker — Execute allowed"
                : showGate || "Connect the maker wallet to commit desk sets"
            }
          >
            {isMaker ? "Maker ready" : isConnected ? "Not maker" : "Wallet off"}
          </span>
        ) : null}
        {primeDeskManifest.deployed ? (
          <span className="aqua-badge aqua-badge--mute">Gateway live</span>
        ) : (
          <span className="aqua-badge aqua-badge--warn">Gateway offline</span>
        )}
      </div>

      <div className="aqua-status-wallet">
        <ConnectButton chainStatus="icon" accountStatus="address" showBalance={false} />
      </div>

      {awake && showGate && !isMaker ? (
        <p className="aqua-status-gate" role="status">
          {makerGate ?? gate}
        </p>
      ) : null}
    </aside>
  )
}
