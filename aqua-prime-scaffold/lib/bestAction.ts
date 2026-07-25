import { parseUnits } from "viem";
import { simulateDeployedDesk } from "./parityCheck";
import { tokenToUsd1e18, type BookState } from "./primeSim";

export type BestAction = {
  sellBase: boolean;
  amountHuman: string;
  amountInWei: bigint;
  expectedOut: bigint;
  baselineOut: bigint;
  surplusOut: bigint;
  inSymbol: "WETH" | "USDC";
  outSymbol: "WETH" | "USDC";
  label: string;
  healEdgeBps: number;
};

const WETH_PRESETS = ["0.5", "1", "5", "10"] as const;
const USDC_PRESETS = ["1000", "5000", "10000"] as const;

export type WalletBalances = {
  wethWei: bigint;
  usdcWei: bigint;
};

export function canFund(wallet: WalletBalances | undefined, sellBase: boolean, amountInWei: bigint): boolean {
  if (!wallet) return true;
  return sellBase ? wallet.wethWei >= amountInWei : wallet.usdcWei >= amountInWei;
}

function healEdgeBps(baselineOut: bigint, healOut: bigint): number {
  if (baselineOut === 0n) return 0;
  return Number(((healOut - baselineOut) * 10000n) / baselineOut);
}

function formatSurplus(sellBase: boolean, surplusOut: bigint): string {
  if (surplusOut <= 0n) return "";
  if (sellBase) {
    const usdc = (Number(surplusOut) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 2 });
    return ` (+${usdc} USDC vs baseline)`;
  }
  const weth = (Number(surplusOut) / 1e18).toLocaleString("en-US", { maximumFractionDigits: 6 });
  return ` (+${weth} WETH vs baseline)`;
}

function formatLabel(sellBase: boolean, amountHuman: string, out: bigint, surplusOut: bigint): string {
  if (sellBase) {
    const usdc = (Number(out) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 2 });
    return `Sell ${amountHuman} WETH → ${usdc} USDC${formatSurplus(true, surplusOut)}`;
  }
  const weth = (Number(out) / 1e18).toLocaleString("en-US", { maximumFractionDigits: 6 });
  return `Buy ${amountHuman} USDC → ${weth} WETH${formatSurplus(false, surplusOut)}`;
}

/**
 * Best live-routable trade: maximizes HEAL surplus over BASELINE (extra output token),
 * ranked by USD value of that surplus.
 */
export function computeBestAction(book: BookState, ethUsd1e18: bigint): BestAction | null {
  if (ethUsd1e18 === 0n) return null;

  let best: BestAction | null = null;
  let bestSurplusUsd = -1n;
  let bestEdgeBps = -1;

  for (const sellBase of [true, false] as const) {
    const presets = sellBase ? WETH_PRESETS : USDC_PRESETS;
    const decimals = sellBase ? 18 : 6;

    for (const amountHuman of presets) {
      let amountInWei: bigint;
      try {
        amountInWei = parseUnits(amountHuman, decimals);
      } catch {
        continue;
      }

      const sim = simulateDeployedDesk(book, ethUsd1e18, amountInWei, sellBase);
      const healOut = sim.primeOut;
      const baselineOut = sim.branches[0]?.amountOut ?? 0n;
      if (healOut === 0n || baselineOut === 0n) continue;

      const surplusOut = healOut > baselineOut ? healOut - baselineOut : 0n;
      const edgeBps = healEdgeBps(baselineOut, healOut);
      const surplusUsd = tokenToUsd1e18(surplusOut, !sellBase, ethUsd1e18);

      const better =
        surplusUsd > bestSurplusUsd ||
        (surplusUsd === bestSurplusUsd && edgeBps > bestEdgeBps);

      if (better) {
        bestSurplusUsd = surplusUsd;
        bestEdgeBps = edgeBps;
        best = {
          sellBase,
          amountHuman,
          amountInWei,
          expectedOut: healOut,
          baselineOut,
          surplusOut,
          inSymbol: sellBase ? "WETH" : "USDC",
          outSymbol: sellBase ? "USDC" : "WETH",
          label: formatLabel(sellBase, amountHuman, healOut, surplusOut),
          healEdgeBps: edgeBps,
        };
      }
    }
  }

  return best;
}
