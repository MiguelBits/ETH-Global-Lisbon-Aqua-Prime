/** Virtual-book math for PrimeSelector branch previews (WETH=18 dec, USDC=6 dec). */

export type BranchBookStats = {
  wethBefore: number;
  usdcBefore: number;
  wethAfter: number;
  usdcAfter: number;
  midBefore: number | null;
  midAfter: number | null;
  execPrice: number | null;
};

/** Mid spot: USDC per 1 WETH from virtual balances. */
export function midUsdcPerWeth(baseWei: bigint, quoteWei: bigint): number | null {
  if (baseWei <= 0n) return null;
  return Number(quoteWei) / 1e6 / (Number(baseWei) / 1e18);
}

export function branchBookStats(
  balBase: bigint,
  balQuote: bigint,
  amountInWei: bigint,
  branchOutWei: bigint,
  sellBase: boolean,
): BranchBookStats {
  const wethBefore = Number(balBase) / 1e18;
  const usdcBefore = Number(balQuote) / 1e6;
  const midBefore = midUsdcPerWeth(balBase, balQuote);

  let baseAfter = balBase;
  let quoteAfter = balQuote;

  if (sellBase) {
    baseAfter = balBase + amountInWei;
    quoteAfter = balQuote > branchOutWei ? balQuote - branchOutWei : 0n;
  } else {
    quoteAfter = balQuote + amountInWei;
    baseAfter = balBase > branchOutWei ? balBase - branchOutWei : 0n;
  }

  const wethAfter = Number(baseAfter) / 1e18;
  const usdcAfter = Number(quoteAfter) / 1e6;
  const midAfter = midUsdcPerWeth(baseAfter, quoteAfter);

  let execPrice: number | null = null;
  if (amountInWei > 0n && branchOutWei > 0n) {
    if (sellBase) {
      execPrice = Number(branchOutWei) / 1e6 / (Number(amountInWei) / 1e18);
    } else {
      execPrice = Number(amountInWei) / 1e6 / (Number(branchOutWei) / 1e18);
    }
  }

  return { wethBefore, usdcBefore, wethAfter, usdcAfter, midBefore, midAfter, execPrice };
}

export function fmtMid(v: number | null) {
  if (v === null || !Number.isFinite(v)) return "—";
  return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/** Pool spot in $/WETH for display (USDC per 1 WETH). */
export function fmtPoolPrice(v: number | null, digits = 2) {
  if (v === null || !Number.isFinite(v)) return "—";
  return v.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: digits,
  });
}

/** Basis points: (a - b) / b * 10_000 */
export function bpsVs(a: number | null, b: number | null): number | null {
  if (a === null || b === null || !Number.isFinite(a) || !Number.isFinite(b) || b === 0) return null;
  return ((a - b) / b) * 10000;
}

export function fmtBal(v: number, symbol: "WETH" | "USDC") {
  return v.toLocaleString("en-US", {
    maximumFractionDigits: symbol === "WETH" ? 4 : 2,
  });
}
