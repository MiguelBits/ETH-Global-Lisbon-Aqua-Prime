"use client";

import { bpsVs, fmtPoolPrice } from "~~/lib/branchBook";
import { ORACLE_TARGET_BPS } from "~~/lib/poolState";

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
 * Inventory-health gauge from the virtual book.
 * Inventory skew is valued at Chainlink mark (not the pool's own mid).
 * Pool price is still shown from reserves for oracle-distance context.
 */
export function InventoryHealthPanel({
  baseUnits,
  quoteUnits,
  poolMidUsdcPerWeth,
  chainlinkUsdPerEth = null,
  baseSymbol,
  quoteSymbol,
}: Props) {
  const hasMark = chainlinkUsdPerEth !== null && chainlinkUsdPerEth > 0;
  const mark = hasMark ? (chainlinkUsdPerEth as number) : null;

  // Value inventory at Chainlink — pool-mid valuation is circular (base×mid ≡ quote).
  const baseAtMark = mark !== null ? baseUnits * mark : 0;
  const quoteAtMark = quoteUnits;
  const bookAtMark = baseAtMark + quoteAtMark;

  // skew > 0 => quote-heavy book => selling BASE heals inventory
  const skew = mark !== null && bookAtMark > 0 ? (quoteAtMark - baseAtMark) / bookAtMark : 0;
  const skewPct = Math.round(skew * 100);
  const mag = Math.min(Math.abs(skew), 1);

  const heavyLeg = skew >= 0 ? quoteSymbol : baseSymbol;
  const poolVsMarkBps = bpsVs(poolMidUsdcPerWeth, chainlinkUsdPerEth);

  // Heal direction follows oracle distance when available; else inventory.
  const healFromOracle =
    poolVsMarkBps !== null && Math.abs(poolVsMarkBps) > ORACLE_TARGET_BPS
      ? poolVsMarkBps > 0
        ? `Sell ${baseSymbol}`
        : `Buy ${baseSymbol}`
      : null;
  const healAction = healFromOracle ?? (skew >= 0 ? `Sell ${baseSymbol}` : `Buy ${baseSymbol}`);
  const balancedInv = Math.abs(skewPct) <= 1;
  const nearOracle = poolVsMarkBps !== null && Math.abs(poolVsMarkBps) <= ORACLE_TARGET_BPS;
  const healthy = nearOracle || (balancedInv && poolVsMarkBps === null);

  return (
    <div className="term-panel">
      <div className="term-header">
        <span>POOL · book</span>
        <span className={healthy ? "term-value" : "term-value-warn"}>
          {nearOracle ? "NEAR MARK" : balancedInv ? "BALANCED" : `${heavyLeg}-HEAVY`}
        </span>
      </div>

      <div className="mb-3 rounded border border-[var(--term-border)] bg-black/20 px-2 py-2">
        <p className="text-[10px] uppercase tracking-wide term-label">Pool price</p>
        <p className="font-mono text-lg term-value-accent">
          {poolMidUsdcPerWeth !== null ? (
            <>
              {fmtPoolPrice(poolMidUsdcPerWeth)}
              <span className="ml-1 text-sm term-label">/ {baseSymbol}</span>
            </>
          ) : (
            "—"
          )}
        </p>
        {mark !== null ? (
          <p className="mt-1 text-[10px] term-label">
            Mark (Chainlink) {fmtPoolPrice(mark)}
            {poolVsMarkBps !== null ? (
              <span className={`ml-2 font-mono ${Math.abs(poolVsMarkBps) > ORACLE_TARGET_BPS ? "term-value-warn" : ""}`}>
                pool {poolVsMarkBps > 0 ? "+" : ""}
                {poolVsMarkBps.toFixed(0)} bps vs mark
              </span>
            ) : null}
          </p>
        ) : null}
      </div>

      <div className="mb-2 flex items-center justify-between text-[10px] term-label">
        <span>{baseSymbol}-heavy</span>
        <span>inventory @ mark {mark !== null ? `${skewPct > 0 ? "+" : ""}${skewPct}%` : "—"}</span>
        <span>{quoteSymbol}-heavy</span>
      </div>

      <div className="meter-track">
        <div className="absolute inset-y-0 left-1/2 w-px bg-[var(--term-muted)]" />
        <div
          className="absolute inset-y-0"
          style={{
            left: skew >= 0 ? "50%" : `${50 - mag * 50}%`,
            width: `${mag * 50}%`,
            background: healthy ? "var(--term-green)" : "var(--term-cyan)",
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
        {mark !== null ? (
          <>
            <dt className="term-label">Book @ mark</dt>
            <dd className="text-right font-mono term-value-accent">{fmtPoolPrice(bookAtMark, 0)}</dd>
          </>
        ) : null}
      </dl>

      <p className="mt-2 text-[11px]">
        {nearOracle ? (
          <span className="term-label">
            Pool within {ORACLE_TARGET_BPS} bps of Chainlink — heal action holds.
          </span>
        ) : (
          <span>
            <span className="term-value-accent">{healAction}</span>{" "}
            <span className="term-label">
              moves pool mid toward Chainlink — Heal action plans clip-by-clip.
            </span>
          </span>
        )}
      </p>
    </div>
  );
}
