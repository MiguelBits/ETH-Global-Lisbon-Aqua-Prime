"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchRecentSwaps, fetchSkewHistory } from "~~/lib/subgraph";

export function BlotterPanel() {
  const { data: swaps = [], isLoading } = useQuery({
    queryKey: ["blotter"],
    queryFn: () => fetchRecentSwaps(15),
    refetchInterval: 8000,
  });

  const { data: skewHistory = [] } = useQuery({
    queryKey: ["skewHistory"],
    queryFn: () => fetchSkewHistory(24),
    refetchInterval: 8000,
  });

  return (
    <div className="term-panel">
      <div className="term-header">
        <span>BLOTTER · The Graph</span>
        <span>{swaps.length ? `${swaps.length} fills` : "awaiting subgraph"}</span>
      </div>

      {skewHistory.length > 1 ? <SkewSparkline values={skewHistory} /> : null}

      {isLoading ? (
        <p className="text-xs term-label">Loading trade history…</p>
      ) : swaps.length === 0 ? (
        <p className="text-xs term-label">
          Deploy subgraph and set NEXT_PUBLIC_SUBGRAPH_URL. Swaps appear after first fill.
        </p>
      ) : (
        <div className="max-h-48 overflow-y-auto text-xs">
          <table className="w-full">
            <thead>
              <tr className="term-label text-left">
                <th>Time</th>
                <th>Side</th>
                <th>Branch</th>
                <th>Skew</th>
              </tr>
            </thead>
            <tbody>
              {swaps.map(s => (
                <tr key={s.id} className="blotter-row">
                  <td className="py-0.5 font-mono">{new Date(Number(s.timestamp) * 1000).toLocaleTimeString()}</td>
                  <td className="py-0.5">{s.sellBase ? "SELL WETH" : "BUY WETH"}</td>
                  <td className="py-0.5">{["XYC", "ORACLE", "SKEW"][s.winnerIndex] ?? s.winnerIndex}</td>
                  <td className="py-0.5 font-mono">{(Number(s.postSkewE18) / 1e18 * 100).toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SkewSparkline({ values }: { values: number[] }) {
  const max = Math.max(...values, 0.01);
  const w = 200;
  const h = 32;
  const points = values
    .map((v, i) => {
      const x = (i / Math.max(values.length - 1, 1)) * w;
      const y = h - (v / max) * h;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <div className="mb-2">
      <p className="mb-1 text-xs term-label">Skew history (post-trade |skew|)</p>
      <svg width={w} height={h} className="text-[var(--term-cyan)]">
        <polyline fill="none" stroke="currentColor" strokeWidth="1.5" points={points} />
      </svg>
    </div>
  );
}
