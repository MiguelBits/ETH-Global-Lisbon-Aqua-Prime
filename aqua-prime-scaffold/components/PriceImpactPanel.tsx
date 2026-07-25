"use client";

import { useMemo } from "react";
import { midUsdcPerWeth } from "~~/lib/branchBook";
import {
  branchingPanelBranches,
  simulateBranch,
  simulateBranches,
  sweepAmounts,
  type BookState,
  type BranchConfig,
} from "~~/lib/primeSim";
import type { ResolvedTuning } from "~~/lib/dynamicParams";

type Props = {
  book: BookState;
  ethUsd1e18: bigint;
  sellBase: boolean;
  amountInWei: bigint;
  resolved: ResolvedTuning;
};

type CurvePoint = {
  amountHuman: number;
  execPrice: number;
  slippageBps: number;
  edgeVsFairBps: number;
  capBound: boolean;
};

const W = 280;
const H = 72;
const PAD = 4;

function buildCurve(
  book: BookState,
  ethUsd1e18: bigint,
  sellBase: boolean,
  branch: BranchConfig,
  lambda: bigint,
  amounts: bigint[],
): CurvePoint[] {
  const mid = midUsdcPerWeth(book.balBase, book.balQuote);
  return amounts.map(amt => {
    const r = simulateBranch(book, amt, sellBase, ethUsd1e18, branch, lambda, 0);
    const amountHuman = sellBase ? Number(amt) / 1e18 : Number(amt) / 1e6;
    const exec = r.execPriceUsdcPerWeth ?? 0;
    const slippageBps = mid && mid > 0 ? ((exec - mid) / mid) * 10000 : 0;
    return {
      amountHuman,
      execPrice: exec,
      slippageBps,
      edgeVsFairBps: slippageBps,
      capBound: r.capBound,
    };
  });
}

function polyline(points: { x: number; y: number }[]): string {
  return points.map(p => `${p.x},${p.y}`).join(" ");
}

function MiniChart({
  title,
  series,
  markerX,
  yLabel,
}: {
  title: string;
  series: { label: string; color: string; values: number[]; xs: number[] }[];
  markerX: number | null;
  yLabel: string;
}) {
  const allY = series.flatMap(s => s.values);
  const minY = Math.min(...allY, 0);
  const maxY = Math.max(...allY, 1);
  const range = maxY - minY || 1;

  const toY = (v: number) => PAD + (H - 2 * PAD) * (1 - (v - minY) / range);

  return (
    <div className="mb-2">
      <p className="mb-1 text-[9px] term-label">
        {title} · {yLabel}
      </p>
      <svg width={W} height={H} className="w-full max-w-full">
        {series.map(s => {
          const pts = s.values.map((v, i) => ({
            x: PAD + ((s.xs[i] ?? 0) / (s.xs[s.xs.length - 1] || 1)) * (W - 2 * PAD),
            y: toY(v),
          }));
          return (
            <polyline
              key={s.label}
              fill="none"
              stroke={s.color}
              strokeWidth="1.5"
              points={polyline(pts)}
            />
          );
        })}
        {markerX !== null ? (
          <line
            x1={PAD + markerX * (W - 2 * PAD)}
            x2={PAD + markerX * (W - 2 * PAD)}
            y1={PAD}
            y2={H - PAD}
            stroke="var(--term-amber)"
            strokeDasharray="2 2"
            strokeWidth="1"
          />
        ) : null}
      </svg>
      <div className="flex flex-wrap gap-2 text-[9px] term-label">
        {series.map(s => (
          <span key={s.label} style={{ color: s.color }}>
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

const BRANCH_COLORS = [
  "var(--term-muted)",
  "var(--term-cyan)",
  "var(--term-green)",
  "var(--term-amber)",
] as const;

export function PriceImpactPanel({
  book,
  ethUsd1e18,
  sellBase,
  amountInWei,
  resolved,
}: Props) {
  const branches = useMemo(() => branchingPanelBranches(resolved), [resolved]);

  const amounts = useMemo(() => sweepAmounts(sellBase, sellBase ? 5 : 25000, 10), [sellBase]);

  const curves = useMemo(
    () =>
      branches.map(b => ({
        branch: b,
        points: buildCurve(book, ethUsd1e18, sellBase, b, resolved.lambda, amounts),
      })),
    [book, ethUsd1e18, sellBase, branches, resolved.lambda, amounts],
  );

  const sim = useMemo(
    () => simulateBranches(book, ethUsd1e18, amountInWei, sellBase, branches, resolved.lambda),
    [book, ethUsd1e18, amountInWei, sellBase, branches, resolved.lambda],
  );

  const maxAmt = amounts[amounts.length - 1] ?? 1n;
  const markerFrac =
    maxAmt > 0n && amountInWei > 0n ? Number(amountInWei) / Number(maxAmt) : null;

  const xs = curves[0]?.points.map(p => p.amountHuman) ?? [];

  const execSeries = curves.map((c, i) => ({
    label: c.branch.label,
    color: BRANCH_COLORS[i] ?? "var(--term-muted)",
    values: c.points.map(p => p.execPrice),
    xs,
  }));

  const fairSeries = curves.map((c, i) => ({
    label: c.branch.label,
    color: BRANCH_COLORS[i] ?? "var(--term-muted)",
    values: c.points.map(p => p.edgeVsFairBps),
    xs,
  }));

  const capHits = curves.flatMap(c => c.points.filter(p => p.capBound).length);
  const anyCap = capHits.some(n => n > 0);

  return (
    <div className="term-panel">
      <div className="term-header">
        <span>IMPACT · simulation</span>
        <span className="text-[10px] term-value-accent">
          winner {branches[sim.winnerIndex]?.label ?? "—"}
        </span>
      </div>

      <MiniChart title="Execution price ($/WETH)" series={execSeries} markerX={markerFrac} yLabel="$/WETH" />
      <MiniChart title="Slippage vs pool mid (bps)" series={fairSeries} markerX={markerFrac} yLabel="bps" />

      {anyCap ? (
        <p className="text-[10px] term-value-warn">LP fair cap binds on some sizes (dashed = current ticket).</p>
      ) : (
        <p className="text-[10px] term-label">Dashed line = current ticket size.</p>
      )}

      <dl className="mt-2 grid grid-cols-2 gap-1 text-[10px]">
        <dt className="term-label">Sim out (tuned)</dt>
        <dd className="font-mono term-value-accent">
          {sellBase
            ? (Number(sim.primeOut) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 })
            : (Number(sim.primeOut) / 1e18).toLocaleString(undefined, { maximumFractionDigits: 6 })}{" "}
          {sellBase ? "USDC" : "WETH"}
        </dd>
      </dl>
    </div>
  );
}
