"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { primeDeskManifest } from "~~/contracts/manifestMeta";
import { fmtPoolPrice } from "~~/lib/branchBook";

type Props = {
  /** Current virtual-book pool mid (USDC per WETH). */
  poolMidUsdcPerWeth: number | null;
  chainlinkUsdPerEth?: number | null;
  uniRefOut: bigint | null;
  sellBase: boolean;
  amountInWei: string;
};

export function TradeTapePanel({
  poolMidUsdcPerWeth,
  chainlinkUsdPerEth = null,
  uniRefOut,
  sellBase,
  amountInWei,
}: Props) {
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

  return (
    <div className="term-panel">
      <div className="term-header">
        <span>TAPE · Uniswap reference</span>
        <span className="text-[10px] font-mono term-value-accent">
          {poolMidUsdcPerWeth ? `pool ${fmtPoolPrice(poolMidUsdcPerWeth)}` : "pool -"}
        </span>
      </div>

      <div className="text-[10px]">
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
                {poolMidUsdcPerWeth ? fmtPoolPrice(poolMidUsdcPerWeth) : "-"}
              </dd>
            </div>
            <div>
              <dt className="term-label">UNI mid</dt>
              <dd className="font-mono">{uniMid ? fmtPoolPrice(uniMid) : "-"}</dd>
            </div>
            <div>
              <dt className="term-label">Mark</dt>
              <dd className="font-mono term-label">
                {chainlinkUsdPerEth ? fmtPoolPrice(chainlinkUsdPerEth) : "-"}
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
