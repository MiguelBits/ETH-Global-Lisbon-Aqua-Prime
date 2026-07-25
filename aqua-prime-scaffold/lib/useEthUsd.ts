"use client";

import { useMemo } from "react";
import { useReadContract } from "wagmi";
import { chainlinkAggregatorAbi } from "~~/contracts/abis";
import { primeDeskManifest } from "~~/contracts/manifestMeta";

const SKEW_ONE = 10n ** 18n;

export type EthUsdFeed = {
  ethUsd1e18: bigint;
  updatedAt: bigint;
  stalenessSec: number;
  isLoading: boolean;
};

export function useEthUsd(): EthUsdFeed {
  const oracle = primeDeskManifest.chainlinkEthUsd;

  const { data: roundData, isLoading: loadingRound } = useReadContract({
    address: oracle,
    abi: chainlinkAggregatorAbi,
    functionName: "latestRoundData",
  });

  const { data: decimals, isLoading: loadingDec } = useReadContract({
    address: oracle,
    abi: chainlinkAggregatorAbi,
    functionName: "decimals",
  });

  const ethUsd1e18 = useMemo(() => {
    if (!roundData) return 0n;
    const answer = roundData[1];
    if (answer <= 0n) return 0n;
    const dec = typeof decimals === "number" ? decimals : 8;
    let price = BigInt(answer);
    if (dec < 18) {
      price = price * 10n ** BigInt(18 - dec);
    } else if (dec > 18) {
      price = price / 10n ** BigInt(dec - 18);
    }
    return price;
  }, [roundData, decimals]);

  const updatedAt = roundData?.[3] ?? 0n;
  const nowSec = Math.floor(Date.now() / 1000);
  const stalenessSec = updatedAt > 0n ? nowSec - Number(updatedAt) : 0;

  return {
    ethUsd1e18,
    updatedAt,
    stalenessSec: Math.max(0, stalenessSec),
    isLoading: loadingRound || loadingDec,
  };
}

export { SKEW_ONE };
