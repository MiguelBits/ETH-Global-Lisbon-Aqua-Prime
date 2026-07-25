"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { primeDeskManifest } from "~~/contracts/manifestMeta";
import { bpsVs, fmtPoolPrice, midUsdcPerWeth } from "~~/lib/branchBook";
import { fetchRecentSwaps, type BlotterSwap } from "~~/lib/subgraph";

const SUBGRAPH_URL = process.env.NEXT_PUBLIC_SUBGRAPH_URL ?? "";
import { LIVE_SELECTOR_LABELS } from "~~/lib/primeSim";

const BRANCH_LABELS = LIVE_SELECTOR_LABELS;

type TapeRow = {
  id: string;
  source: "prime" | "uniswap";
  time: number;
  side: string;
  branch: string;
  sizeLabel: string;
  execPrice: number | null;
  poolMidAfter: number | null;
  skewPct: number | null;
  edgePoolBps: number | null;
  edgeUniBps: number | null;
  txHash?: string;
};

type Props = {
  /** Current virtual-book pool mid (USDC per WETH). */
  poolMidUsdcPerWeth: number | null;
  chainlinkUsdPerEth?: number | null;
  uniRefOut: bigint | null;
  sellBase: boolean;
  amountInWei: string;
};

function primeRow(s: BlotterSwap, uniMid: number | null): TapeRow {
  const amountIn = BigInt(s.amountIn);
  const amountOut = BigInt(s.amountOut);
  const sellBase = s.sellBase;

  let execPrice: number | null = null;
  if (amountIn > 0n && amountOut > 0n) {
    execPrice = sellBase
      ? Number(amountOut) / 1e6 / (Number(amountIn) / 1e18)
      : Number(amountIn) / 1e6 / (Number(amountOut) / 1e18);
  }

  const poolMidAfter = midUsdcPerWeth(BigInt(s.baseBalAfter), BigInt(s.quoteBalAfter));
  const edgePoolBps = bpsVs(execPrice, poolMidAfter);
  const edgeUniBps =
    execPrice !== null && uniMid !== null && uniMid > 0
      ? ((execPrice - uniMid) / uniMid) * 10000
      : null;

  const sizeLabel = sellBase
    ? `${(Number(amountIn) / 1e18).toFixed(3)} WETH`
    : `${(Number(amountIn) / 1e6).toLocaleString()} USDC`;

  return {
    id: s.id,
    source: "prime",
    time: Number(s.timestamp),
    side: sellBase ? "SELL WETH" : "BUY WETH",
    branch: BRANCH_LABELS[s.winnerIndex] ?? `B${s.winnerIndex}`,
    sizeLabel,
    execPrice,
    poolMidAfter,
    skewPct: Number(s.postSkewE18) / 1e18 * 100,
    edgePoolBps,
    edgeUniBps,
    txHash: s.txHash,
  };
}

export function TradeTapePanel({
  poolMidUsdcPerWeth,
  chainlinkUsdPerEth = null,
  uniRefOut,
  sellBase,
  amountInWei,
}: Props) {
  const { data: swaps = [], isLoading: loadingSwaps } = useQuery({
    queryKey: ["tradeTape", "swaps"],
    queryFn: () => fetchRecentSwaps(20),
    refetchInterval: 8000,
    enabled: !!SUBGRAPH_URL,
  });

  const { data: uniData, isLoading: loadingUni } = useQuery({
    queryKey: ["tradeTape", "uniswap", amountInWei, sellBase],
    enabled: BigInt(amountInWei || "0") > 0n,
    queryFn: async () => {
      const res = await fetch(`/api/uniswap-quote?sellBase=${sellBase}&amountIn=${amountInWei}`);
      return res.json() as Promise<{ available: boolean; amountOut?: string; reason?: string }>;
    },
    staleTime: 15_000,
  });

  const uniMid = useMemo(() => {
    if (uniRefOut !== null && BigInt(amountInWei || "0") > 0n) {
      if (sellBase) {
        return Number(uniRefOut) / 1e6 / (Number(amountInWei) / 1e18);
      }
      return Number(amountInWei) / 1e6 / (Number(uniRefOut) / 1e18);
    }
    return null;
  }, [uniRefOut, amountInWei, sellBase]);

  const rows = useMemo(() => {
    const primeRows = swaps.map(s => primeRow(s, uniMid));
    return primeRows.sort((a, b) => b.time - a.time);
  }, [swaps, uniMid]);

  const skewHistory = useMemo(
    () => swaps.map(s => Number(s.postSkewE18) / 1e18).reverse(),
    [swaps],
  );

  const hasSubgraph = !!SUBGRAPH_URL;
  const uniAvailable = uniData?.available && uniData.amountOut;

  return (
    <div className="term-panel">
      <div className="term-header">
        <span>TAPE · fills &amp; impact</span>
        <span className="text-[10px] font-mono term-value-accent">
          {poolMidUsdcPerWeth ? `pool ${fmtPoolPrice(poolMidUsdcPerWeth)}` : "pool —"}
        </span>
      </div>

      {skewHistory.length > 1 ? <SkewSparkline values={skewHistory} /> : null}

      {!hasSubgraph ? (
        <p className="mb-2 text-xs term-label">
          Set <code className="text-white">NEXT_PUBLIC_SUBGRAPH_URL</code> for Prime desk fills.
        </p>
      ) : loadingSwaps ? (
        <p className="text-xs term-label">Loading trade history…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs term-label">No Prime fills yet — execute a swap on the desk.</p>
      ) : (
        <div className="max-h-56 overflow-y-auto text-xs">
          <table className="w-full">
            <thead>
              <tr className="term-label text-left">
                <th>Time</th>
                <th>Side</th>
                <th>Size</th>
                <th>Branch</th>
                <th>Exec $</th>
                <th>Pool $</th>
                <th>vs Pool</th>
                <th>vs Uni</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="blotter-row">
                  <td className="py-0.5 font-mono">{new Date(r.time * 1000).toLocaleTimeString()}</td>
                  <td className="py-0.5">{r.side}</td>
                  <td className="py-0.5 font-mono">{r.sizeLabel}</td>
                  <td className="py-0.5 term-value-accent">{r.branch}</td>
                  <td className="py-0.5 font-mono">
                    {r.execPrice?.toLocaleString(undefined, { maximumFractionDigits: 2 }) ?? "—"}
                  </td>
                  <td className="py-0.5 font-mono term-label">
                    {r.poolMidAfter?.toLocaleString(undefined, { maximumFractionDigits: 2 }) ?? "—"}
                  </td>
                  <td className="py-0.5 font-mono">
                    {r.edgePoolBps !== null ? `${r.edgePoolBps > 0 ? "+" : ""}${r.edgePoolBps.toFixed(0)}` : "—"}
                  </td>
                  <td className="py-0.5 font-mono">
                    {r.edgeUniBps !== null ? `${r.edgeUniBps > 0 ? "+" : ""}${r.edgeUniBps.toFixed(0)}` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-3 border-t border-[var(--term-border)] pt-2 text-[10px]">
        <p className="term-label mb-1">Reference · Uniswap API (mainnet composite)</p>
        {loadingUni ? (
          <p className="term-label">Fetching…</p>
        ) : !uniData?.available ? (
          <p className="term-label">{uniData?.reason ?? "Set UNISWAP_API_KEY for reference quotes."}</p>
        ) : (
          <dl className="grid grid-cols-3 gap-2">
            <div>
              <dt className="term-label">Pool mid</dt>
              <dd className="font-mono term-value-accent">
                {poolMidUsdcPerWeth ? fmtPoolPrice(poolMidUsdcPerWeth) : "—"}
              </dd>
            </div>
            <div>
              <dt className="term-label">UNI mid</dt>
              <dd className="font-mono">{uniMid ? fmtPoolPrice(uniMid) : "—"}</dd>
            </div>
            <div>
              <dt className="term-label">Mark</dt>
              <dd className="font-mono term-label">
                {chainlinkUsdPerEth ? fmtPoolPrice(chainlinkUsdPerEth) : "—"}
              </dd>
            </div>
          </dl>
        )}
      </div>

      <p className="mt-2 text-[9px] term-label">
        Maker · {primeDeskManifest.maker.slice(0, 10)}… · Gateway · {primeDeskManifest.gateway.slice(0, 10)}…
      </p>
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
      <p className="mb-1 text-xs term-label">Post-trade |skew| history</p>
      <svg width={w} height={h} className="text-[var(--term-cyan)]">
        <polyline fill="none" stroke="currentColor" strokeWidth="1.5" points={points} />
      </svg>
    </div>
  );
}
