const SUBGRAPH_URL = process.env.NEXT_PUBLIC_SUBGRAPH_URL ?? "";

export type BlotterSwap = {
  id: string;
  taker: string;
  sellBase: boolean;
  amountIn: string;
  amountOut: string;
  winnerIndex: number;
  postSkewE18: string;
  baseBalAfter: string;
  quoteBalAfter: string;
  timestamp: string;
  txHash: string;
};

const SWAPS_QUERY = `
  query RecentSwaps($first: Int!) {
    swaps(first: $first, orderBy: timestamp, orderDirection: desc) {
      id
      taker
      sellBase
      amountIn
      amountOut
      winnerIndex
      postSkewE18
      baseBalAfter
      quoteBalAfter
      timestamp
      txHash
    }
  }
`;

export async function fetchRecentSwaps(limit = 20): Promise<BlotterSwap[]> {
  if (!SUBGRAPH_URL) return [];
  const res = await fetch(SUBGRAPH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: SWAPS_QUERY, variables: { first: limit } }),
    next: { revalidate: 5 },
  });
  if (!res.ok) return [];
  const json = (await res.json()) as { data?: { swaps?: BlotterSwap[] } };
  return json.data?.swaps ?? [];
}

export async function fetchSkewHistory(limit = 30): Promise<number[]> {
  const swaps = await fetchRecentSwaps(limit);
  return swaps
    .map(s => Number(s.postSkewE18) / 1e18)
    .reverse();
}
