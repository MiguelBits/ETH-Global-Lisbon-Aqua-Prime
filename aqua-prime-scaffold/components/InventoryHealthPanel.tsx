"use client";

import { bpsVs, fmtPoolPrice } from "~~/lib/branchBook";

type Props = {
  baseUnits: number;
  quoteUnits: number;
  /** Spot mid from virtual reserves: USDC per 1 WETH. */
  poolMidUsdcPerWeth: number | null;
  /** Chainlink ETH/USD (optional mark reference). */
  chainlinkUsdPerEth?: number | null;
  baseSymbol: string;
  quoteSymbol: string;
};

/**
 * Inventory-health gauge from the virtual book. Pool price comes from reserves (quote/base);
 * skew is measured at that pool price, not Chainlink USD normalization.
 */
export function InventoryHealthPanel({
  baseUnits,
  quoteUnits,
  poolMidUsdcPerWeth,
  chainlinkUsdPerEth = null,
  baseSymbol,
  quoteSymbol,
}: Props) {
  const priced = poolMidUsdcPerWeth !== null && poolMidUsdcPerWeth > 0;
  const baseAtPool = priced ? baseUnits * (poolMidUsdcPerWeth as number) : 0;
  const quoteAtPool = quoteUnits;
  const bookAtPool = baseAtPool + quoteAtPool;

  // skew > 0 => quote-heavy book => selling BASE heals it
  const skew = priced && bookAtPool > 0 ? (quoteAtPool - baseAtPool) / bookAtPool : 0;
  const skewPct = Math.round(skew * 100);
  const mag = Math.min(Math.abs(skew), 1);

  const heavyLeg = skew >= 0 ? quoteSymbol : baseSymbol;
  const healAction = skew >= 0 ? `Sell ${baseSymbol}` : `Buy ${baseSymbol}`;
  const balanced = Math.abs(skewPct) <= 1;
  const poolVsMarkBps = bpsVs(poolMidUsdcPerWeth, chainlinkUsdPerEth);

  return (
    <div className="term-panel">
      <div className="term-header">
        <span>POOL · book</span>
        <span className={balanced ? "term-value" : "term-value-warn"}>{balanced ? "BALANCED" : `${heavyLeg}-HEAVY`}</span>
      </div>

      <div className="mb-3 rounded border border-[var(--term-border)] bg-black/20 px-2 py-2">
        <p className="text-[10px] uppercase tracking-wide term-label">Pool price</p>
        <p className="font-mono text-lg term-value-accent">
          {priced ? (
            <>
              {fmtPoolPrice(poolMidUsdcPerWeth)}
              <span className="ml-1 text-sm term-label">/ {baseSymbol}</span>
            </>
          ) : (
            "—"
          )}
        </p>
        {chainlinkUsdPerEth !== null && chainlinkUsdPerEth > 0 ? (
          <p className="mt-1 text-[10px] term-label">
            Mark (Chainlink) {fmtPoolPrice(chainlinkUsdPerEth)}
            {poolVsMarkBps !== null ? (
              <span className={`ml-2 font-mono ${Math.abs(poolVsMarkBps) > 50 ? "term-value-warn" : ""}`}>
                pool {poolVsMarkBps > 0 ? "+" : ""}
                {poolVsMarkBps.toFixed(0)} bps vs mark
              </span>
            ) : null}
          </p>
        ) : null}
      </div>

      <div className="mb-2 flex items-center justify-between text-[10px] term-label">
        <span>{baseSymbol}-heavy</span>
        <span>inventory skew {priced ? `${skewPct > 0 ? "+" : ""}${skewPct}%` : "—"}</span>
        <span>{quoteSymbol}-heavy</span>
      </div>

      <div className="meter-track">
        <div className="absolute inset-y-0 left-1/2 w-px bg-[var(--term-muted)]" />
        <div
          className="absolute inset-y-0"
          style={{
            left: skew >= 0 ? "50%" : `${50 - mag * 50}%`,
            width: `${mag * 50}%`,
            background: balanced ? "var(--term-green)" : "var(--term-cyan)",
          }}
        />
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <dt className="term-label">{baseSymbol} in pool</dt>
        <dd className="text-right font-mono term-value">
          {baseUnits.toLocaleString("en-US", { maximumFractionDigits: 4 })}
        </dd>
        <dt className="term-label">{quoteSymbol} in pool</dt>
        <dd className="text-right font-mono term-value">
          {quoteUnits.toLocaleString("en-US", { maximumFractionDigits: 2 })}
        </dd>
        {priced ? (
          <>
            <dt className="term-label">Book @ pool price</dt>
            <dd className="text-right font-mono term-value-accent">{fmtPoolPrice(bookAtPool, 0)}</dd>
          </>
        ) : null}
      </dl>

      <p className="mt-2 text-[11px]">
        {balanced ? (
          <span className="term-label">Pool is balanced — baseline / reference branches compete on price.</span>
        ) : (
          <span>
            <span className="term-value-accent">{healAction}</span>{" "}
            <span className="term-label">moves inventory toward balance — HEAL branch tends to win routing.</span>
          </span>
        )}
      </p>
    </div>
  );
}
