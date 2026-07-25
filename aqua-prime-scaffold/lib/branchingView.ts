import type { OnChainBranchBreakdown } from "./useOnChainBranchBreakdown";
import {
  LIVE_BRANCH_DESCS,
  LIVE_SELECTOR_LABELS,
  REFERENCE_BRANCH_LABELS,
  type BranchSimResult,
  type SimResult,
} from "./primeSim";

export type BranchDisplayRow = BranchSimResult & {
  isWinner: boolean;
  isReference?: boolean;
};

export function buildBranchDisplayRows(
  onChain: OnChainBranchBreakdown | undefined,
  fallbackLiveSim: SimResult | null,
  referenceSim: SimResult | null,
): BranchDisplayRow[] {
  const liveWinner = onChain?.winnerIndex ?? fallbackLiveSim?.winnerIndex ?? -1;
  const liveBranches = onChain?.branches ?? fallbackLiveSim?.branches ?? [];

  const liveRows: BranchDisplayRow[] = LIVE_SELECTOR_LABELS.map((label, i) => {
    const branch = liveBranches[i];
    return {
      branchIndex: i,
      label,
      desc: LIVE_BRANCH_DESCS[label],
      amountOut: branch?.amountOut ?? 0n,
      postSkewE18: branch?.postSkewE18 ?? 0n,
      score: branch?.score ?? 0n,
      usdIn: branch?.usdIn ?? 0n,
      usdOut: branch?.usdOut ?? 0n,
      edgeVsFairBps: branch?.edgeVsFairBps ?? 0,
      capBound: branch?.capBound ?? false,
      execPriceUsdcPerWeth: branch?.execPriceUsdcPerWeth ?? null,
      isWinner: i === liveWinner,
      isReference: false,
    };
  });

  const refRows: BranchDisplayRow[] = REFERENCE_BRANCH_LABELS.map((label, i) => {
    const branch = referenceSim?.branches[i];
    return {
      branchIndex: LIVE_SELECTOR_LABELS.length + i,
      label,
      desc: LIVE_BRANCH_DESCS[label],
      amountOut: branch?.amountOut ?? 0n,
      postSkewE18: branch?.postSkewE18 ?? 0n,
      score: branch?.score ?? 0n,
      usdIn: branch?.usdIn ?? 0n,
      usdOut: branch?.usdOut ?? 0n,
      edgeVsFairBps: branch?.edgeVsFairBps ?? 0,
      capBound: branch?.capBound ?? false,
      execPriceUsdcPerWeth: branch?.execPriceUsdcPerWeth ?? null,
      isWinner: false,
      isReference: true,
    };
  });

  return [...liveRows, ...refRows];
}
