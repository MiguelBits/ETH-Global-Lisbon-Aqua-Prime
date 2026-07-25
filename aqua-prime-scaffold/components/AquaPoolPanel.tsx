"use client"

import { useEffect, useMemo, useState } from "react"
import { formatUnits } from "viem"
import { useReadContract } from "wagmi"
import { AquaHolo } from "~~/components/AquaHolo"
import { AquaTerm } from "~~/components/AquaTerm"
import deployedContracts from "~~/contracts/deployedContracts"
import { primeDeskManifest } from "~~/contracts/manifestMeta"
import { bpsVs, fmtPoolPrice, midUsdcPerWeth } from "~~/lib/branchBook"
import { DEMO_BOOK, DEMO_ETH_USD_1E18, type AquaBookSnapshot } from "~~/lib/jarvis/aquaBrain"
import { usdSkewPct } from "~~/lib/primeSim"
import { useEthUsd } from "~~/lib/useEthUsd"
import scaffoldConfig from "~~/scaffold.config"

export type AquaBalances = Pick<AquaBookSnapshot, "balBase" | "balQuote" | "ethUsd1e18" | "source">

type Props = {
  awake: boolean
  /** When false, keep fetching balances but render nothing. */
  visible: boolean
  amountIn: bigint
  sellBase: boolean
  onBalances: (book: AquaBalances) => void
}

const CHAIN_ID = scaffoldConfig.targetNetworks[0].id
const contracts = deployedContracts[CHAIN_ID as keyof typeof deployedContracts] ?? deployedContracts[31337]

const fmtWeth = (v: bigint) =>
  Number(formatUnits(v, 18)).toLocaleString("en-US", { maximumFractionDigits: 4 })

const fmtUsdc = (v: bigint) =>
  Number(formatUnits(v, 6)).toLocaleString("en-US", { maximumFractionDigits: 2 })

export const AquaPoolPanel = ({ awake, visible, amountIn, sellBase, onBalances }: Props) => {
  const gateway = contracts.AquaPrimeSwapGateway.address
  const canRead = primeDeskManifest.deployed
  const { ethUsd1e18: oracleEthUsd } = useEthUsd()

  const { data: virtualBal } = useReadContract({
    address: gateway,
    abi: contracts.AquaPrimeSwapGateway.abi,
    functionName: "virtualBalances",
    query: { enabled: canRead, refetchInterval: 8000 },
  })

  const [uniOut, setUniOut] = useState<string | null>(null)
  const [uniAvailable, setUniAvailable] = useState(false)

  const liveBase = virtualBal?.[0]
  const liveQuote = virtualBal?.[1]
  const hasLive =
    typeof liveBase === "bigint" &&
    typeof liveQuote === "bigint" &&
    (liveBase > 0n || liveQuote > 0n)

  const balBase = hasLive ? liveBase : DEMO_BOOK.balBase
  const balQuote = hasLive ? liveQuote : DEMO_BOOK.balQuote
  const ethUsd1e18 = oracleEthUsd > 0n ? oracleEthUsd : DEMO_ETH_USD_1E18
  const source: AquaBookSnapshot["source"] = hasLive ? "live" : "demo"

  const balances = useMemo<AquaBalances>(
    () => ({ balBase, balQuote, ethUsd1e18, source }),
    [balBase, balQuote, ethUsd1e18, source],
  )

  useEffect(() => {
    onBalances(balances)
  }, [balances, onBalances])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      if (amountIn === 0n) {
        setUniAvailable(false)
        setUniOut(null)
        return
      }
      try {
        const res = await fetch(`/api/uniswap-quote?sellBase=${sellBase}&amountIn=${amountIn.toString()}`)
        const json = (await res.json()) as { available: boolean; amountOut?: string }
        if (cancelled) return
        if (json.available && json.amountOut) {
          setUniAvailable(true)
          setUniOut(json.amountOut)
        } else {
          setUniAvailable(false)
          setUniOut(null)
        }
      } catch {
        if (!cancelled) {
          setUniAvailable(false)
          setUniOut(null)
        }
      }
    }
    void load()
    const t = setInterval(load, 20_000)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [amountIn, sellBase])

  const skewPct = usdSkewPct({ balBase, balQuote }, ethUsd1e18)
  const mag = Math.min(Math.abs(skewPct) / 100, 1)
  const balanced = Math.abs(skewPct) <= 3
  const heavy = skewPct >= 0 ? "USDC" : "WETH"
  const poolXyc = midUsdcPerWeth(balBase, balQuote)
  const markUsd = ethUsd1e18 > 0n ? Number(ethUsd1e18) / 1e18 : null
  const poolVsMark = bpsVs(poolXyc, markUsd)
  const outDecimals = sellBase ? 6 : 18
  const outSym = sellBase ? "USDC" : "WETH"
  const uniLabel =
    uniAvailable && uniOut
      ? `${Number(formatUnits(BigInt(uniOut), outDecimals)).toLocaleString("en-US", {
          maximumFractionDigits: sellBase ? 2 : 6,
        })} ${outSym}`
      : "—"

  if (!visible) return null

  return (
    <AquaHolo
      as="aside"
      className={`aqua-side aqua-pool aqua-panel-dock ${awake ? "aqua-side--live" : "aqua-side--muted"}`}
      aria-label="Pool dashboard"
    >
      <header className="aqua-side-head">
        <span>
          <AquaTerm id="pool">Pool</AquaTerm>
        </span>
        <span className="aqua-side-head-tags">
          <span className={source === "live" ? "aqua-tag aqua-tag--ok" : "aqua-tag aqua-tag--warn"}>
            {source === "live" ? "live book" : "demo book"}
          </span>
          <span className={balanced ? "aqua-tag aqua-tag--ok" : "aqua-tag"}>
            {balanced ? (
              "balanced"
            ) : heavy === "USDC" ? (
              <AquaTerm id="quote">USDC-heavy</AquaTerm>
            ) : (
              <AquaTerm id="base">WETH-heavy</AquaTerm>
            )}
          </span>
        </span>
      </header>

      <div className="aqua-pool-price aqua-stagger-item" style={{ ["--i" as string]: 0 }}>
        <p className="aqua-pool-price-label">
          <AquaTerm id="pool">XYC pool</AquaTerm>
        </p>
        <p className="aqua-pool-price-value aqua-holo-num">
          {fmtPoolPrice(poolXyc)}
          <span className="aqua-pool-price-unit"> / WETH</span>
        </p>
        {poolVsMark !== null ? (
          <p className="aqua-pool-price-mark">
            <AquaTerm id="mark">mark</AquaTerm> {fmtPoolPrice(markUsd)}
            <span className={Math.abs(poolVsMark) > 50 ? "aqua-ticket-hint--warn" : ""}>
              {" "}
              · pool {poolVsMark > 0 ? "+" : ""}
              {poolVsMark.toFixed(0)} bps
            </span>
          </p>
        ) : null}
      </div>

      <dl className="aqua-pool-stats aqua-stagger">
        <div style={{ ["--i" as string]: 1 }}>
          <dt>
            <AquaTerm id="base">WETH</AquaTerm>
          </dt>
          <dd className="aqua-holo-num">{fmtWeth(balBase)}</dd>
        </div>
        <div style={{ ["--i" as string]: 2 }}>
          <dt>
            <AquaTerm id="quote">USDC</AquaTerm>
          </dt>
          <dd className="aqua-holo-num">{fmtUsdc(balQuote)}</dd>
        </div>
      </dl>

      <div className="aqua-skew-meta aqua-stagger-item" style={{ ["--i" as string]: 3 }}>
        <span>
          <AquaTerm id="base">WETH-heavy</AquaTerm>
        </span>
        <span>
          <AquaTerm id="skew">skew</AquaTerm> {skewPct >= 0 ? "+" : ""}
          {skewPct.toFixed(1)}%
        </span>
        <span>
          <AquaTerm id="quote">USDC-heavy</AquaTerm>
        </span>
      </div>
      <div className="aqua-skew-track aqua-stagger-item" style={{ ["--i" as string]: 4 }} aria-hidden>
        <div className="aqua-skew-mid" />
        <div
          className="aqua-skew-fill aqua-skew-fill--draw"
          style={{
            left: skewPct >= 0 ? "50%" : `${50 - mag * 50}%`,
            width: `${mag * 50}%`,
          }}
        />
      </div>

      <div className="aqua-uni-row aqua-stagger-item" style={{ ["--i" as string]: 5 }}>
        <span>
          <AquaTerm id="tape">Uni ref</AquaTerm> · <AquaTerm id="ticket">ticket</AquaTerm>
        </span>
        <strong className="aqua-holo-num">{uniLabel}</strong>
      </div>

      <p className="aqua-side-note aqua-side-note--net">
        Mainnet reference · settles on fork
      </p>

      <p className="aqua-side-note">
        {source === "live" ? (
          <>
            Live gateway <AquaTerm id="book">book</AquaTerm>
          </>
        ) : (
          <>
            Demo <AquaTerm id="book">book</AquaTerm> until gateway inventory is readable
          </>
        )}
      </p>
    </AquaHolo>
  )
}
