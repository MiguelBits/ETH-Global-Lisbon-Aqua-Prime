"use client"

import { useMemo } from "react"
import { buildBranchDisplayRows, type BranchDisplayRow } from "~~/lib/branchingView"
import { resolveParams } from "~~/lib/dynamicParams"
import {
  DEFAULT_RAW_TUNING,
  deployedDeskBranches,
  referenceDeskBranches,
  simulateBranches,
  type BookState,
  type RawTuningParams,
} from "~~/lib/primeSim"
import { simulateDeployedDesk } from "~~/lib/parityCheck"
import type { JarvisProposal } from "~~/lib/jarvis/schema"
import { useOnChainBranchBreakdown } from "~~/lib/useOnChainBranchBreakdown"
import deployedContracts from "~~/contracts/deployedContracts"
import { primeDeskManifest } from "~~/contracts/manifestMeta"
import scaffoldConfig from "~~/scaffold.config"

const CHAIN_ID = scaffoldConfig.targetNetworks[0].id
const contracts = deployedContracts[CHAIN_ID as keyof typeof deployedContracts] ?? deployedContracts[31337]

const tuningFromProposal = (proposal: JarvisProposal | null): RawTuningParams => {
  if (!proposal) return DEFAULT_RAW_TUNING
  return {
    ...DEFAULT_RAW_TUNING,
    healK: proposal.params.healK,
    maxAdjustment: proposal.params.maxAdjustment,
    healPremium: proposal.params.healPremium,
    lambda: proposal.params.lambda,
  }
}

export function useAquaRoutes(args: {
  balBase: bigint
  balQuote: bigint
  ethUsd1e18: bigint
  amountInWei: bigint
  sellBase: boolean
  proposal: JarvisProposal | null
  enabled: boolean
}): {
  rows: BranchDisplayRow[]
  livePrimeOut: bigint | null
  isLoading: boolean
} {
  const book = useMemo<BookState>(
    () => ({ balBase: args.balBase, balQuote: args.balQuote }),
    [args.balBase, args.balQuote],
  )

  const gateway = contracts.AquaPrimeSwapGateway.address
  const canRead = primeDeskManifest.deployed && args.enabled && args.amountInWei > 0n

  const { data: onChainBreakdown, isLoading } = useOnChainBranchBreakdown(
    canRead ? gateway : undefined,
    contracts.AquaPrimeSwapGateway.abi,
    args.amountInWei,
    args.sellBase,
    canRead,
  )

  const rawTuning = useMemo(() => tuningFromProposal(args.proposal), [args.proposal])

  const simDeployed = useMemo(() => {
    if (!args.enabled || args.ethUsd1e18 === 0n || args.amountInWei === 0n) return null
    return simulateDeployedDesk(book, args.ethUsd1e18, args.amountInWei, args.sellBase)
  }, [args.enabled, args.ethUsd1e18, args.amountInWei, args.sellBase, book])

  const simTuned = useMemo(() => {
    if (!args.enabled || !args.proposal || args.ethUsd1e18 === 0n || args.amountInWei === 0n) return null
    const resolved = resolveParams(rawTuning, {
      book,
      ethUsd1e18: args.ethUsd1e18,
      market: { realizedVol: 0.02, flowImbalance: 0, sampleCount: 0, latestMid: null, uniswapMid: null },
      oracleStalenessSec: 0,
      nowSec: Math.floor(Date.now() / 1000),
    })
    const branches = deployedDeskBranches(resolved)
    return simulateBranches(book, args.ethUsd1e18, args.amountInWei, args.sellBase, branches, resolved.lambda)
  }, [args.enabled, args.proposal, args.ethUsd1e18, args.amountInWei, args.sellBase, book, rawTuning])

  const simReference = useMemo(() => {
    if (!args.enabled || args.ethUsd1e18 === 0n || args.amountInWei === 0n) return null
    const resolved = resolveParams(rawTuning, {
      book,
      ethUsd1e18: args.ethUsd1e18,
      market: { realizedVol: 0.02, flowImbalance: 0, sampleCount: 0, latestMid: null, uniswapMid: null },
      oracleStalenessSec: 0,
      nowSec: Math.floor(Date.now() / 1000),
    })
    const branches = referenceDeskBranches(resolved)
    return simulateBranches(book, args.ethUsd1e18, args.amountInWei, args.sellBase, branches, resolved.lambda)
  }, [args.enabled, args.ethUsd1e18, args.amountInWei, args.sellBase, book, rawTuning])

  const liveSim = simTuned ?? simDeployed

  const rows = useMemo(
    () => buildBranchDisplayRows(onChainBreakdown, liveSim, simReference),
    [onChainBreakdown, liveSim, simReference],
  )

  const livePrimeOut =
    onChainBreakdown?.primeOut ?? liveSim?.primeOut ?? null

  return { rows, livePrimeOut, isLoading: canRead && isLoading }
}
