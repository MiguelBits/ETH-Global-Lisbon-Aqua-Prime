"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import Link from "next/link";
import { BranchRoutingPanel } from "~~/components/BranchRoutingPanel";
import { ClientOnly } from "~~/components/ClientOnly";
import { EnsIdentityPanel } from "~~/components/EnsIdentityPanel";
import { EnsureForkNetwork } from "~~/components/EnsureForkNetwork";
import { InventoryHealthPanel } from "~~/components/InventoryHealthPanel";
import { PriceImpactPanel } from "~~/components/PriceImpactPanel";
import { StatusBar } from "~~/components/StatusBar";
import { TradeTapePanel } from "~~/components/TradeTapePanel";
import { TuningPanel } from "~~/components/TuningPanel";
import { JarvisPanel, fetchJarvisProposal, type JarvisUiState } from "~~/components/JarvisPanel";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { formatUnits, parseUnits, type Address, type Hex } from "viem";
import { useAccount, usePublicClient, useReadContract, useWriteContract } from "wagmi";
import deployedContracts from "~~/contracts/deployedContracts";
import { faucetTokenAbi } from "~~/contracts/abis";
import { primeDeskManifest } from "~~/contracts/manifestMeta";
import { buildBranchDisplayRows } from "~~/lib/branchingView";
import { bpsVs, fmtPoolPrice, midUsdcPerWeth } from "~~/lib/branchBook";
import { computeBestAction, canFund } from "~~/lib/bestAction";
import { resolveParams } from "~~/lib/dynamicParams";
import { computeMarketStats } from "~~/lib/marketStats";
import { logParityCheck, simulateDeployedDesk } from "~~/lib/parityCheck";
import {
  DEFAULT_RAW_TUNING,
  deployedDeskBranches,
  referenceDeskBranches,
  simulateBranches,
  type RawTuningParams,
} from "~~/lib/primeSim";
import type { JarvisProposal } from "~~/lib/jarvis/schema";
import { useEthUsd } from "~~/lib/useEthUsd";
import { useOnChainBranchBreakdown } from "~~/lib/useOnChainBranchBreakdown";
import { approveWriteRequest, swapExactInWriteRequest } from "~~/lib/approveAndSwap";
import { commitDeskAndSwap, commitMakerGate, formatCommitError } from "~~/lib/jarvis/commitDeskAndSwap";
import scaffoldConfig from "~~/scaffold.config";

const CHAIN_ID = scaffoldConfig.targetNetworks[0].id;
const contracts = deployedContracts[CHAIN_ID as keyof typeof deployedContracts] ?? deployedContracts[31337];

const PRESETS: Record<"base" | "quote", string[]> = {
  base: ["0.5", "1", "5", "10"],
  quote: ["1000", "5000", "10000"],
};

function fmt(v: unknown, decimals: number, max: number) {
  if (typeof v !== "bigint") return "—";
  return Number(formatUnits(v, decimals)).toLocaleString("en-US", { maximumFractionDigits: max });
}
const fmtEth = (v: unknown) => fmt(v, 18, 4);
const fmtUsdc = (v: unknown) => fmt(v, 6, 2);

export default function PrimeDeskPage() {
  const { address, isConnected } = useAccount();
  const [amountIn, setAmountIn] = useState("1");
  const [sellBase, setSellBase] = useState(true);
  const [txBusy, setTxBusy] = useState(false);
  const [rawTuning, setRawTuning] = useState<RawTuningParams>(DEFAULT_RAW_TUNING);
  const [jarvisState, setJarvisState] = useState<JarvisUiState>("idle");
  const [jarvisProposal, setJarvisProposal] = useState<JarvisProposal | null>(null);
  const [jarvisNote, setJarvisNote] = useState<string | null>(null);

  const { ethUsd1e18, stalenessSec, isLoading: loadingOracle } = useEthUsd();

  const gateway = contracts.AquaPrimeSwapGateway.address;
  const weth = contracts.WETH.address;
  const usdc = contracts.USDC.address;
  const isZeroGateway = !primeDeskManifest.deployed;

  const sellToken = sellBase ? "WETH" : "USDC";
  const buyToken = sellBase ? "USDC" : "WETH";
  const tokenIn = sellBase ? weth : usdc;
  const amountDecimals = sellBase ? 18 : 6;
  const outDecimals = sellBase ? 6 : 18;

  const amountInWei = useMemo(() => {
    try {
      return parseUnits(amountIn || "0", amountDecimals);
    } catch {
      return 0n;
    }
  }, [amountIn, amountDecimals]);

  const { data: quoteOut, refetch: refetchQuote } = useReadContract({
    address: gateway,
    abi: contracts.AquaPrimeSwapGateway.abi,
    functionName: "quoteExactIn",
    args: [amountInWei, sellBase],
    query: { enabled: !isZeroGateway && amountInWei > 0n },
  });

  const { data: virtualBal, refetch: refetchVirtual } = useReadContract({
    address: gateway,
    abi: contracts.AquaPrimeSwapGateway.abi,
    functionName: "virtualBalances",
    query: { enabled: !isZeroGateway },
  });

  const { data: wethBal, refetch: refetchWeth } = useReadContract({
    address: weth,
    abi: contracts.WETH.abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const { data: usdcBal, refetch: refetchUsdc } = useReadContract({
    address: usdc,
    abi: contracts.USDC.abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: tokenIn,
    abi: contracts.USDC.abi,
    functionName: "allowance",
    args: address ? [address, gateway] : undefined,
    query: { enabled: !!address && !isZeroGateway },
  });

  const { data: uniRefData } = useQuery({
    queryKey: ["uniRef", amountInWei.toString(), sellBase],
    enabled: amountInWei > 0n,
    queryFn: async () => {
      const res = await fetch(`/api/uniswap-quote?sellBase=${sellBase}&amountIn=${amountInWei}`);
      return res.json() as Promise<{ available: boolean; amountOut?: string }>;
    },
    staleTime: 15_000,
  });

  const uniRefOut = uniRefData?.available && uniRefData.amountOut ? BigInt(uniRefData.amountOut) : null;

  const { writeContractAsync, isPending } = useWriteContract();
  const publicClient = usePublicClient();
  const queryClient = useQueryClient();

  const refreshAll = useCallback(async () => {
    await Promise.all([
      refetchQuote(),
      refetchVirtual(),
      refetchWeth(),
      refetchUsdc(),
      refetchAllowance(),
    ]);
    await queryClient.invalidateQueries({ queryKey: ["tradeTape"] });
  }, [queryClient, refetchAllowance, refetchQuote, refetchUsdc, refetchVirtual, refetchWeth]);

  const waitForTx = useCallback(
    async (hash: `0x${string}`, label: string) => {
      if (!publicClient) throw new Error("RPC client not ready");
      toast.loading(`${label}…`, { id: "tx" });
      const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
      if (receipt.status === "reverted") throw new Error("Transaction reverted");
      toast.success(`${label} confirmed`, { id: "tx" });
      await refreshAll();
    },
    [publicClient, refreshAll],
  );

  const isBusy = txBusy || isPending;
  const allowanceBn = typeof allowance === "bigint" ? allowance : undefined;
  const needsApproval = allowanceBn !== undefined && amountInWei > 0n && allowanceBn < amountInWei;

  const [balBase, balQuote] = (virtualBal as readonly [bigint, bigint] | undefined) ?? [0n, 0n];
  const book = useMemo(() => ({ balBase, balQuote }), [balBase, balQuote]);
  const poolMidUsdcPerWeth = useMemo(() => midUsdcPerWeth(balBase, balQuote), [balBase, balQuote]);
  const chainlinkUsdPerEth = ethUsd1e18 > 0n ? Number(ethUsd1e18) / 1e18 : null;
  const poolVsMarkBps = bpsVs(poolMidUsdcPerWeth, chainlinkUsdPerEth);

  const marketStats = useMemo(
    () => computeMarketStats([], uniRefOut, sellBase ? amountInWei : parseUnits("1", 18)),
    [uniRefOut, sellBase, amountInWei],
  );

  const resolvedTuning = useMemo(() => {
    if (ethUsd1e18 === 0n) return null;
    return resolveParams(rawTuning, {
      book,
      ethUsd1e18,
      market: marketStats,
      oracleStalenessSec: stalenessSec,
      nowSec: Math.floor(Date.now() / 1000),
    });
  }, [rawTuning, book, ethUsd1e18, marketStats, stalenessSec]);

  const simDeployed = useMemo(() => {
    if (ethUsd1e18 === 0n || amountInWei === 0n) return null;
    return simulateDeployedDesk(book, ethUsd1e18, amountInWei, sellBase);
  }, [book, ethUsd1e18, amountInWei, sellBase]);

  const simTuned = useMemo(() => {
    if (!resolvedTuning || ethUsd1e18 === 0n || amountInWei === 0n) return null;
    const branches = deployedDeskBranches(resolvedTuning);
    return simulateBranches(book, ethUsd1e18, amountInWei, sellBase, branches, resolvedTuning.lambda);
  }, [resolvedTuning, book, ethUsd1e18, amountInWei, sellBase]);

  const simReference = useMemo(() => {
    if (!resolvedTuning || ethUsd1e18 === 0n || amountInWei === 0n) return null;
    const branches = referenceDeskBranches(resolvedTuning);
    return simulateBranches(book, ethUsd1e18, amountInWei, sellBase, branches, resolvedTuning.lambda);
  }, [resolvedTuning, book, ethUsd1e18, amountInWei, sellBase]);

  const { data: onChainBreakdown, isLoading: loadingOnChainBranches } = useOnChainBranchBreakdown(
    isZeroGateway ? undefined : gateway,
    contracts.AquaPrimeSwapGateway.abi,
    amountInWei,
    sellBase,
    !isZeroGateway,
  );

  const branchRows = useMemo(
    () => buildBranchDisplayRows(onChainBreakdown, simDeployed, simReference),
    [onChainBreakdown, simDeployed, simReference],
  );

  const bestAction = useMemo(
    () => (ethUsd1e18 > 0n ? computeBestAction(book, ethUsd1e18) : null),
    [book, ethUsd1e18],
  );

  const bestActionFundable =
    bestAction &&
    isConnected &&
    typeof wethBal === "bigint" &&
    typeof usdcBal === "bigint" &&
    canFund({ wethWei: wethBal, usdcWei: usdcBal }, bestAction.sellBase, bestAction.amountInWei);

  const ticketMatchesBest =
    bestAction !== null &&
    sellBase === bestAction.sellBase &&
    amountIn === bestAction.amountHuman;

  useEffect(() => {
    if (typeof quoteOut !== "bigint" || !simDeployed) return;
    logParityCheck("deployed desk", quoteOut, simDeployed.primeOut);
  }, [quoteOut, simDeployed]);

  const execPrice =
    typeof quoteOut === "bigint" && amountInWei > 0n
      ? Number(formatUnits(quoteOut, outDecimals)) / Number(formatUnits(amountInWei, amountDecimals))
      : null;

  const simOutHuman = useMemo(() => {
    if (!simTuned) return null;
    return sellBase
      ? Number(simTuned.primeOut) / 1e6
      : Number(simTuned.primeOut) / 1e18;
  }, [simTuned, sellBase]);

  const liveOutHuman = useMemo(() => {
    if (typeof quoteOut !== "bigint") return null;
    return sellBase ? Number(quoteOut) / 1e6 : Number(quoteOut) / 1e18;
  }, [quoteOut, sellBase]);

  const insufficient =
    isConnected &&
    amountInWei > 0n &&
    typeof (sellBase ? wethBal : usdcBal) === "bigint" &&
    (sellBase ? (wethBal as bigint) : (usdcBal as bigint)) < amountInWei;

  const runJarvisPropose = useCallback(
    async (ticket: { amountInWei: bigint; sellBase: boolean; note?: string }) => {
      if (ticket.amountInWei === 0n) return;
      setJarvisState("thinking");
      setJarvisNote(ticket.note ?? "Reading Uniswap CLASSIC tape and consulting desk model…");
      try {
        const proposal = await fetchJarvisProposal({
          amountInWei: ticket.amountInWei,
          sellBase: ticket.sellBase,
          balBase,
          balQuote,
          ethUsd1e18: ethUsd1e18 > 0n ? ethUsd1e18 : 3000n * 10n ** 18n,
        });
        setJarvisProposal(proposal);
        setRawTuning(prev => ({
          ...prev,
          healK: proposal.params.healK,
          maxAdjustment: proposal.params.maxAdjustment,
          healPremium: proposal.params.healPremium,
          lambda: proposal.params.lambda,
        }));
        setJarvisState("armed");
        const regime = proposal.tapeIntel?.thinLiquidity
          ? "THIN"
          : proposal.tapeIntel?.fillerGapWide
            ? "FILLER_GAP"
            : proposal.tapeIntel?.available
              ? "OK"
              : null;
        setJarvisNote(
          proposal.mode === "0g"
            ? `0G inference complete${regime ? ` · tape ${regime}` : ""}. Desk set armed sir.`
            : `Local heuristics armed${regime ? ` · tape ${regime}` : ""}. Desk set ready sir.`,
        );
      } catch (e) {
        setJarvisState("idle");
        setJarvisNote(null);
        toast.error(e instanceof Error ? e.message : "Jarvis propose failed");
      }
    },
    [balBase, balQuote, ethUsd1e18],
  );

  const onProposeJarvis = useCallback(async () => {
    await runJarvisPropose({ amountInWei, sellBase });
  }, [amountInWei, sellBase, runJarvisPropose]);

  const onCommitAndSwap = async () => {
    if (!isConnected || !address || !jarvisProposal || !publicClient) return;
    const gate = commitMakerGate(address);
    if (gate) {
      toast.error(gate);
      return;
    }

    setTxBusy(true);
    setJarvisState("committing");
    try {
      await commitDeskAndSwap({
        address,
        publicClient,
        writeContractAsync: writeContractAsync as (req: Record<string, unknown>) => Promise<Hex>,
        waitForTx,
        proposal: jarvisProposal,
        amountInWei,
        sellBase,
        needsApproval,
        onStatus: setJarvisNote,
      });
      setJarvisState("settled");
    } catch (e) {
      setJarvisState(jarvisProposal ? "armed" : "idle");
      setJarvisNote(null);
      toast.error(formatCommitError(e), { id: "tx" });
    } finally {
      setTxBusy(false);
    }
  };

  const onSwap = async () => {
    if (!isConnected) return;
    setTxBusy(true);
    try {
      if (needsApproval) {
        const approveHash = await writeContractAsync(approveWriteRequest(tokenIn, gateway));
        await waitForTx(approveHash, "Approve");
      }
      const swapHash = await writeContractAsync(swapExactInWriteRequest(gateway, amountInWei, sellBase));
      await waitForTx(swapHash, "Swap");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Swap failed", { id: "tx" });
    } finally {
      setTxBusy(false);
    }
  };

  const onFaucet = async () => {
    if (!isConnected) return;
    setTxBusy(true);
    try {
      const wethHash = await writeContractAsync({ address: weth, abi: faucetTokenAbi, functionName: "faucet" });
      await waitForTx(wethHash, "Mint pWETH");
      const usdcHash = await writeContractAsync({ address: usdc, abi: faucetTokenAbi, functionName: "faucet" });
      await waitForTx(usdcHash, "Mint pUSDC");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Faucet failed", { id: "tx" });
    } finally {
      setTxBusy(false);
    }
  };

  if (!contracts) {
    return <p className="p-8 text-red-400">No contracts for chain {CHAIN_ID}. Run sync-deployments.</p>;
  }

  const swapDisabledReason = !isConnected
    ? "Connect wallet"
    : isZeroGateway
      ? "Not deployed"
      : amountInWei === 0n
        ? "Enter amount"
        : insufficient
          ? `Insufficient ${sellToken}`
          : null;

  return (
    <ClientOnly>
      <div className="mx-auto min-h-screen max-w-[1400px] p-3 md:p-5">
        <header className="mb-3 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--term-border)] pb-3">
          <div>
            <Link href="/" className="text-[10px] uppercase tracking-widest term-label hover:text-white">
              ← Prime Desk
            </Link>
            <h1 className="text-lg font-bold tracking-tight text-[var(--term-cyan)]">PRIME DESK TERMINAL</h1>
            <p className="text-xs term-label">WETH/USDC · Jarvis retune · SwapVM heal desk</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/jarvis"
              className="text-[10px] uppercase tracking-widest text-[var(--term-cyan)] underline-offset-4 hover:underline"
            >
              Talk to Aqua
            </Link>
            <ConnectButton />
          </div>
        </header>

        <div className="mb-3">
          <StatusBar />
        </div>

        <EnsureForkNetwork />

        {isZeroGateway ? (
          <div className="term-panel mb-3 border-amber-700/50 text-amber-200">
            Gateway not deployed. Run: <code className="text-white">bash scripts/dev-aqua-prime.sh</code>
          </div>
        ) : null}

        <div className="grid gap-3 lg:grid-cols-12">
          <div className="space-y-3 lg:col-span-3">
            <EnsIdentityPanel makerAddress={primeDeskManifest.maker as Address} />
            <JarvisPanel
              amountInWei={amountInWei}
              sellBase={sellBase}
              balBase={balBase}
              balQuote={balQuote}
              ethUsd1e18={ethUsd1e18}
              busy={isBusy}
              state={jarvisState}
              proposal={jarvisProposal}
              statusNote={jarvisNote}
              onPropose={onProposeJarvis}
              onCommitAndSwap={onCommitAndSwap}
              canCommit={
                isConnected &&
                !!jarvisProposal &&
                swapDisabledReason === null &&
                (address?.toLowerCase() === primeDeskManifest.maker.toLowerCase())
              }
            />
            <InventoryHealthPanel
              baseUnits={Number(formatUnits(balBase, 18))}
              quoteUnits={Number(formatUnits(balQuote, 6))}
              poolMidUsdcPerWeth={poolMidUsdcPerWeth}
              chainlinkUsdPerEth={chainlinkUsdPerEth}
              baseSymbol="WETH"
              quoteSymbol="USDC"
            />
            <TradeTapePanel
              poolMidUsdcPerWeth={poolMidUsdcPerWeth}
              chainlinkUsdPerEth={chainlinkUsdPerEth}
              uniRefOut={uniRefOut}
              sellBase={sellBase}
              amountInWei={amountInWei.toString()}
            />
          </div>

          <div className="space-y-3 lg:col-span-5">
            <div className="term-panel">
              <div className="term-header">
                <span>TICKET · execute</span>
                {poolMidUsdcPerWeth ? (
                  <span className="term-value-accent font-mono">
                    Pool {fmtPoolPrice(poolMidUsdcPerWeth)} / WETH
                  </span>
                ) : null}
              </div>

              <div className="mb-2 flex gap-2">
                <button
                  type="button"
                  className={`btn-term flex-1 ${sellBase ? "border-[var(--term-cyan)] text-[var(--term-cyan)]" : ""}`}
                  onClick={() => setSellBase(true)}
                >
                  Sell WETH → USDC
                </button>
                <button
                  type="button"
                  className={`btn-term flex-1 ${!sellBase ? "border-[var(--term-cyan)] text-[var(--term-cyan)]" : ""}`}
                  onClick={() => setSellBase(false)}
                >
                  Buy WETH ← USDC
                </button>
              </div>

              <label className="text-xs term-label">
                Amount in ({sellToken})
                <input
                  className="input-term mt-1"
                  inputMode="decimal"
                  value={amountIn}
                  onChange={e => setAmountIn(e.target.value)}
                />
              </label>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {PRESETS[sellBase ? "base" : "quote"].map(p => (
                  <button
                    key={p}
                    type="button"
                    className={`chip ${amountIn === p ? "border-[var(--term-cyan)] text-[var(--term-cyan)]" : ""}`}
                    onClick={() => setAmountIn(p)}
                  >
                    {p}
                  </button>
                ))}
              </div>

              <dl className="mt-3 space-y-1 border-t border-[var(--term-border)] pt-2 text-xs">
                <div className="flex justify-between">
                  <dt className="term-label">Live out (on-chain)</dt>
                  <dd className="term-value font-mono">
                    {sellBase ? fmtUsdc(quoteOut) : fmtEth(quoteOut)} {buyToken}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="term-label">Sim out (tuned)</dt>
                  <dd className="term-value-accent font-mono">
                    {simOutHuman !== null
                      ? simOutHuman.toLocaleString(undefined, { maximumFractionDigits: sellBase ? 2 : 6 })
                      : loadingOracle
                        ? "…"
                        : "—"}{" "}
                    {buyToken}
                  </dd>
                </div>
                {liveOutHuman !== null && simOutHuman !== null && liveOutHuman > 0 ? (
                  <div className="flex justify-between">
                    <dt className="term-label">Sim vs live (bps)</dt>
                    <dd className="font-mono">
                      {(((simOutHuman - liveOutHuman) / liveOutHuman) * 10000).toFixed(1)}
                    </dd>
                  </div>
                ) : null}
                <div className="flex justify-between">
                  <dt className="term-label">Pool mid</dt>
                  <dd className="font-mono term-value-accent">
                    {poolMidUsdcPerWeth ? `${fmtPoolPrice(poolMidUsdcPerWeth)} / WETH` : "—"}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="term-label">Ticket execution</dt>
                  <dd className="font-mono">
                    {execPrice ? execPrice.toLocaleString("en-US", { maximumFractionDigits: sellBase ? 2 : 6 }) : "—"}{" "}
                    <span className="term-label">{sellBase ? "USDC/WETH" : "WETH/USDC"}</span>
                  </dd>
                </div>
                {execPrice !== null && poolMidUsdcPerWeth !== null && poolMidUsdcPerWeth > 0 ? (
                  <div className="flex justify-between">
                    <dt className="term-label">Exec vs pool (bps)</dt>
                    <dd className="font-mono">
                      {(((execPrice - poolMidUsdcPerWeth) / poolMidUsdcPerWeth) * 10000).toFixed(1)}
                    </dd>
                  </div>
                ) : null}
                {chainlinkUsdPerEth !== null ? (
                  <div className="flex justify-between">
                    <dt className="term-label">Mark (Chainlink)</dt>
                    <dd className="font-mono">{fmtPoolPrice(chainlinkUsdPerEth)} / WETH</dd>
                  </div>
                ) : null}
                {poolVsMarkBps !== null ? (
                  <div className="flex justify-between">
                    <dt className="term-label">Pool vs mark (bps)</dt>
                    <dd className="font-mono">
                      {poolVsMarkBps > 0 ? "+" : ""}
                      {poolVsMarkBps.toFixed(1)}
                    </dd>
                  </div>
                ) : null}
                {isConnected ? (
                  <div className="flex justify-between">
                    <dt className="term-label">Wallet</dt>
                    <dd className="font-mono term-label">
                      {fmtEth(wethBal)} WETH · {fmtUsdc(usdcBal)} USDC
                    </dd>
                  </div>
                ) : null}
              </dl>

              {primeDeskManifest.mintable && isConnected ? (
                <button type="button" className="btn-term mt-2 w-full text-[10px]" disabled={isBusy} onClick={onFaucet}>
                  Get test tokens (faucet pWETH + pUSDC)
                </button>
              ) : null}

              <div className="mt-3 flex flex-col gap-2">
                {bestAction ? (
                  <button
                    type="button"
                    className={`btn-term w-full text-[10px] ${
                      ticketMatchesBest
                        ? "border-[var(--term-cyan)] text-[var(--term-cyan)]"
                        : "border-[var(--term-green)] text-[var(--term-green)]"
                    }`}
                    disabled={isBusy}
                    onClick={() => {
                      setSellBase(bestAction.sellBase);
                      setAmountIn(bestAction.amountHuman);
                    }}
                  >
                    {ticketMatchesBest ? "Best action · " : "Do best action · "}
                    {bestAction.label}
                    {bestAction.healEdgeBps > 0 && bestAction.surplusOut > 0n
                      ? ` · +${bestAction.healEdgeBps.toFixed(0)} bps heal`
                      : ""}
                    {isConnected && bestAction && !bestActionFundable ? " · faucet needed" : ""}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn-term flex-1 border-[var(--term-green)] text-[var(--term-green)]"
                  disabled={isBusy || swapDisabledReason !== null}
                  onClick={onSwap}
                >
                  {isBusy
                    ? "…"
                    : swapDisabledReason ??
                      (needsApproval ? `Approve & swap ${sellToken}` : `Swap ${sellToken}`)}
                </button>
              </div>
            </div>

            <BranchRoutingPanel
              amountInWei={amountInWei}
              sellBase={sellBase}
              balBase={balBase}
              balQuote={balQuote}
              rows={branchRows}
              livePrimeOut={onChainBreakdown?.primeOut ?? (typeof quoteOut === "bigint" ? quoteOut : null)}
              isLoading={loadingOracle || loadingOnChainBranches}
            />
          </div>

          <div className="space-y-3 lg:col-span-4">
            {resolvedTuning ? (
              <TuningPanel
                raw={rawTuning}
                resolved={resolvedTuning}
                onChange={setRawTuning}
                onReset={() => setRawTuning(DEFAULT_RAW_TUNING)}
              />
            ) : null}

            {resolvedTuning && ethUsd1e18 > 0n ? (
              <PriceImpactPanel
                book={book}
                ethUsd1e18={ethUsd1e18}
                sellBase={sellBase}
                amountInWei={amountInWei}
                resolved={resolvedTuning}
              />
            ) : null}

            <div className="term-panel text-[10px]">
              <div className="term-header">MARKET · stats</div>
              <dl className="grid grid-cols-2 gap-1">
                <dt className="term-label">Realized vol</dt>
                <dd className="text-right font-mono">{(marketStats.realizedVol * 100).toFixed(2)}%</dd>
                <dt className="term-label">Flow imbalance</dt>
                <dd className="text-right font-mono">{(marketStats.flowImbalance * 100).toFixed(1)}%</dd>
                <dt className="term-label">Oracle staleness</dt>
                <dd className="text-right font-mono">{stalenessSec}s</dd>
                <dt className="term-label">Fill samples</dt>
                <dd className="text-right font-mono">{marketStats.sampleCount}</dd>
              </dl>
            </div>
          </div>
        </div>
      </div>
    </ClientOnly>
  );
}
