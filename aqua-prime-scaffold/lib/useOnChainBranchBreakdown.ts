"use client";

import { useQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import { LIVE_BRANCH_DESCS, LIVE_SELECTOR_LABELS, type BranchSimResult } from "~~/lib/primeSim";

export type OnChainBranchBreakdown = {
  primeOut: bigint;
  winnerIndex: number;
  branches: BranchSimResult[];
};

type GatewayAbi = readonly {
  type: string;
  name: string;
  inputs?: readonly unknown[];
  outputs?: readonly unknown[];
  stateMutability?: string;
}[];

export function useOnChainBranchBreakdown(
  gateway: `0x${string}` | undefined,
  abi: GatewayAbi,
  amountInWei: bigint,
  sellBase: boolean,
  enabled: boolean,
) {
  const publicClient = usePublicClient();

  return useQuery({
    queryKey: ["onChainBranchBreakdown", gateway, amountInWei.toString(), sellBase],
    enabled: enabled && !!gateway && !!publicClient && amountInWei > 0n,
    queryFn: async (): Promise<OnChainBranchBreakdown> => {
      if (!publicClient || !gateway) throw new Error("RPC client not ready");

      const { result } = await publicClient.simulateContract({
        address: gateway,
        abi,
        functionName: "quoteBranchBreakdown",
        args: [amountInWei, sellBase],
      });

      const [primeOut, branchOuts, scores, postSkewE18, winnerIndex] = result as [
        bigint,
        readonly [bigint, bigint, bigint, bigint],
        readonly [bigint, bigint, bigint, bigint],
        readonly [bigint, bigint, bigint, bigint],
        number,
      ];

      const branches: BranchSimResult[] = LIVE_SELECTOR_LABELS.map((label, i) => ({
        branchIndex: i,
        label,
        desc: LIVE_BRANCH_DESCS[label],
        amountOut: branchOuts[i] ?? 0n,
        postSkewE18: postSkewE18[i] ?? 0n,
        score: scores[i] ?? 0n,
        usdIn: 0n,
        usdOut: 0n,
        edgeVsFairBps: 0,
        capBound: false,
        execPriceUsdcPerWeth: null,
      }));

      return { primeOut, winnerIndex: Number(winnerIndex), branches };
    },
    staleTime: 4_000,
    refetchInterval: 8_000,
  });
}
