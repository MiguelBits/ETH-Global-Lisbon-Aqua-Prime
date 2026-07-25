"use client";

import { useQuery } from "@tanstack/react-query";

type Props = {
  amountInWei: string;
  sellBase: boolean;
  primeOutWei: bigint | undefined;
  quoteDecimals: 6 | 18;
};

export function ReferenceLinePanel({ amountInWei, sellBase, primeOutWei, quoteDecimals }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ["uniswapRef", amountInWei, sellBase],
    enabled: BigInt(amountInWei || "0") > 0n,
    queryFn: async () => {
      const res = await fetch(
        `/api/uniswap-quote?sellBase=${sellBase}&amountIn=${amountInWei}`,
      );
      return res.json() as Promise<{ available: boolean; amountOut?: string; reason?: string }>;
    },
    staleTime: 15_000,
  });

  const primeOut = primeOutWei
    ? Number(primeOutWei) / 10 ** quoteDecimals
    : null;
  const uniOut = data?.available && data.amountOut
    ? Number(data.amountOut) / 10 ** quoteDecimals
    : null;

  let edgeBps: string | null = null;
  if (primeOut !== null && uniOut !== null && uniOut > 0) {
    edgeBps = (((primeOut - uniOut) / uniOut) * 10000).toFixed(1);
  }

  return (
    <div className="term-panel">
      <div className="term-header">
        <span>REF · Uniswap API</span>
        <span className="text-[10px]">mainnet composite (display only)</span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div>
          <p className="term-label">PRIME OUT</p>
          <p className="term-value font-mono">{primeOut?.toLocaleString(undefined, { maximumFractionDigits: 2 }) ?? "—"}</p>
        </div>
        <div>
          <p className="term-label">UNISWAP REF</p>
          <p className="term-value-warn font-mono">
            {isLoading ? "…" : uniOut?.toLocaleString(undefined, { maximumFractionDigits: 2 }) ?? "N/A"}
          </p>
        </div>
        <div>
          <p className="term-label">EDGE (bps)</p>
          <p className={`font-mono ${edgeBps && Number(edgeBps) < 0 ? "term-value" : "term-value-warn"}`}>
            {edgeBps ?? "—"}
          </p>
        </div>
      </div>
      {data && !data.available ? (
        <p className="mt-1 text-[10px] term-label">{data.reason}</p>
      ) : null}
    </div>
  );
}
