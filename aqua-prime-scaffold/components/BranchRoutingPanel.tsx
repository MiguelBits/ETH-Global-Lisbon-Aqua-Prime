"use client";

import { branchBookStats, bpsVs, fmtBal, fmtMid, fmtPoolPrice, midUsdcPerWeth } from "~~/lib/branchBook";
import type { BranchDisplayRow } from "~~/lib/branchingView";

type Props = {
  amountInWei: bigint;
  sellBase: boolean;
  balBase: bigint;
  balQuote: bigint;
  rows: BranchDisplayRow[];
  livePrimeOut: bigint | null;
  isLoading?: boolean;
};

export function BranchRoutingPanel({
  amountInWei,
  sellBase,
  balBase,
  balQuote,
  rows,
  livePrimeOut,
  isLoading,
}: Props) {
  if (amountInWei === 0n) return null;

  if (isLoading && rows.length === 0) {
    return (
      <div className="term-panel">
        <div className="term-header">ROUTE · PrimeSelector</div>
        <p className="text-xs term-label">Scoring branches…</p>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="term-panel">
        <div className="term-header">ROUTE · PrimeSelector</div>
        <p className="text-xs term-label">Awaiting oracle / book data for simulation.</p>
      </div>
    );
  }

  const tokenOutLabel = sellBase ? "USDC" : "WETH";
  const dec = tokenOutLabel === "USDC" ? 6 : 18;

  const outs = rows.map(b => Number(b.amountOut) / 10 ** dec);
  const maxOut = Math.max(...outs, 1e-9);
  const baselineOut = outs[0] ?? 0;

  const bookBefore = branchBookStats(balBase, balQuote, amountInWei, 0n, sellBase);
  const poolMid = midUsdcPerWeth(balBase, balQuote);

  const renderRow = (branch: BranchDisplayRow, index: number) => {
    const out = outs[index] ?? 0;
    const stats = branchBookStats(balBase, balQuote, amountInWei, branch.amountOut, sellBase);
    const poolShiftBps = bpsVs(stats.midAfter, stats.midBefore);
    const edgeBps = index > 0 && baselineOut > 0 ? ((out - baselineOut) / baselineOut) * 10000 : 0;

    return (
      <div
        key={`${branch.label}-${index}`}
        className={`border-l-2 pl-2 ${branch.isWinner ? "border-[var(--term-cyan)]" : "border-transparent"}`}
      >
        <div className="flex items-baseline justify-between text-xs">
          <span className={branch.isWinner ? "term-value-accent" : branch.isReference ? "term-label" : ""}>
            {branch.label}
            {branch.isReference ? " (ref)" : ""}
            {branch.isWinner ? " ◀" : ""}
            <span className="ml-1 text-[10px] term-label">{branch.desc}</span>
          </span>
          <span className="font-mono">
            {out.toLocaleString("en-US", { maximumFractionDigits: dec === 6 ? 2 : 6 })}
          </span>
        </div>

        <div className="meter-track my-1">
          <div
            className="meter-fill"
            style={{
              width: `${(out / maxOut) * 100}%`,
              background: branch.isWinner ? "var(--term-cyan)" : "var(--term-muted)",
            }}
          />
        </div>

        <div className="flex justify-between text-[10px] term-label">
          <span>post-skew {(Number(branch.postSkewE18) / 1e18 * 100).toFixed(1)}%</span>
          <span className={edgeBps > 0 ? "term-value" : edgeBps < 0 ? "term-value-loss" : ""}>
            {index === 0 ? "baseline" : `${edgeBps > 0 ? "+" : ""}${edgeBps.toFixed(0)} bps vs baseline`}
          </span>
        </div>

        {branch.capBound ? <p className="text-[9px] term-value-warn">LP fair cap bound</p> : null}

        <p className="mt-0.5 text-[10px] font-mono term-label leading-relaxed">
          pool {fmtPoolPrice(stats.midBefore)} →{" "}
          <span className="term-value-accent">{fmtPoolPrice(stats.midAfter)}</span>
          {poolShiftBps !== null ? (
            <span className={poolShiftBps < 0 ? " term-value-loss" : poolShiftBps > 0 ? " term-value" : ""}>
              {" "}
              ({poolShiftBps > 0 ? "+" : ""}
              {poolShiftBps.toFixed(0)} bps)
            </span>
          ) : null}
          {" · "}exec {fmtPoolPrice(stats.execPrice)}
        </p>
      </div>
    );
  };

  const winnerRow = rows.find(r => r.isWinner);

  return (
    <div className="term-panel">
      <div className="term-header">
        <span>ROUTE · PrimeSelector (2 live + 2 ref)</span>
        <span className="text-[10px] font-mono term-value-accent">
          {poolMid ? `pool ${fmtPoolPrice(poolMid)} / WETH` : "pool —"}
        </span>
      </div>

      <p className="mb-2 text-[10px] term-label">
        Book · WETH {fmtBal(bookBefore.wethBefore, "WETH")} · USDC {fmtBal(bookBefore.usdcBefore, "USDC")} · pool mid{" "}
        <span className="term-value-accent">{fmtPoolPrice(poolMid)}</span>
        <span className="term-label"> ({fmtMid(bookBefore.midBefore)} raw)</span>
      </p>

      <div className="space-y-2">{rows.map((branch, i) => renderRow(branch, i))}</div>

      <p className="mt-3 border-t border-[var(--term-border)] pt-2 text-xs">
        Winner:{" "}
        <span className="term-value font-mono">
          {livePrimeOut !== null
            ? (Number(livePrimeOut) / 10 ** dec).toLocaleString("en-US", { maximumFractionDigits: dec === 6 ? 2 : 6 })
            : "—"}
        </span>{" "}
        {tokenOutLabel}
        {winnerRow && amountInWei > 0n ? (
          <span className="term-label">
            {" "}
            · pool after{" "}
            <span className="term-value-accent font-mono">
              {fmtPoolPrice(branchBookStats(balBase, balQuote, amountInWei, winnerRow.amountOut, sellBase).midAfter)}
            </span>
          </span>
        ) : null}
      </p>
    </div>
  );
}
