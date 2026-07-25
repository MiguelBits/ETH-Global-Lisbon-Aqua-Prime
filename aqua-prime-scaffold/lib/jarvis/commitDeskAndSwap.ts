/**
 * Maker commit path: stage desk set → dock → ship → finalize → swapExactIn.
 * Each step prompts MetaMask (or the connected wallet).
 *
 * Resumes a stuck pending desk set (stage succeeded, later step rejected/reverted)
 * instead of failing every subsequent Execute with AquaPrimeGatewayPendingDeskSet.
 */

import {
  BaseError,
  ContractFunctionRevertedError,
  type Address,
  type Hex,
  type PublicClient,
} from "viem"
import {
  abandonPendingDeskSetWriteRequest,
  approveWriteRequest,
  aquaDockWriteRequest,
  aquaShipWriteRequest,
  finalizeDeskSetWriteRequest,
  stageDeskSetWriteRequest,
  swapExactInWriteRequest,
} from "~~/lib/approveAndSwap"
import { clampDeskSet, type JarvisProposal } from "~~/lib/jarvis/schema"
import { aquaAbi, aquaPrimeGatewayAbi } from "~~/contracts/abis"
import { primeDeskManifest } from "~~/contracts/manifestMeta"
import deployedContracts from "~~/contracts/deployedContracts"
import scaffoldConfig from "~~/scaffold.config"

const CHAIN_ID = scaffoldConfig.targetNetworks[0].id
const contracts = deployedContracts[CHAIN_ID as keyof typeof deployedContracts] ?? deployedContracts[31337]

/** Aqua Balance.tokensCount sentinel for a docked strategy. */
const DOCKED = 0xff

export type WriteContractAsync = (req: Record<string, unknown>) => Promise<Hex>

export type CommitDeskAndSwapArgs = {
  address: Address
  publicClient: PublicClient
  writeContractAsync: WriteContractAsync
  waitForTx: (hash: Hex, label: string) => Promise<void>
  proposal: JarvisProposal
  amountInWei: bigint
  sellBase: boolean
  needsApproval: boolean
  onStatus?: (note: string) => void
}

export function commitMakerGate(address: Address): string | null {
  if (!primeDeskManifest.deployed) return "Gateway not deployed — start the Anvil fork + deploy stack."
  if (address.toLowerCase() !== primeDeskManifest.maker.toLowerCase()) {
    return `Connect maker ${primeDeskManifest.maker.slice(0, 6)}…${primeDeskManifest.maker.slice(-4)} (Anvil account #0).`
  }
  return null
}

export function formatCommitError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e)
  if (/403|Archive requests require|allnodes|publicnode/i.test(raw)) {
    return "Fork RPC cannot serve archive state (publicnode 403). Restart with an archive MAINNET_RPC_URL — see scripts/dev-aqua-prime.sh."
  }
  if (e instanceof BaseError) {
    const reverted = e.walk(err => err instanceof ContractFunctionRevertedError)
    if (reverted instanceof ContractFunctionRevertedError) {
      const name = reverted.data?.errorName
      if (name === "AquaPrimeGatewayPendingDeskSet" || raw.includes("0xbcc83eca")) {
        return "Desk retune already staged (PendingDeskSet). Retry Execute to resume, or FRESH_FORK=1 redeploy if ship keeps failing."
      }
      if (name === "AquaPrimeGatewayPendingNotShipped") {
        return "Pending strategy not shipped on Aqua yet — ship must succeed before finalize."
      }
      if (name === "AquaPrimeGatewayMustFinishPendingShip") {
        return "Pending retune already docked — must finish ship+finalize (or FRESH_FORK redeploy)."
      }
      if (name === "DockingShouldCloseAllTokens") {
        return "Dock failed — prior strategy already docked or inactive. Retry Execute to resume."
      }
      if (name === "StrategiesMustBeImmutable") {
        return "Ship failed — strategy hash already active. Dock the old strategy first."
      }
      if (name === "AquaPrimeGatewayDeskSetCaps") {
        return "Desk knobs outside on-chain caps — re-run Best settings."
      }
      if (name === "AquaPrimeGatewayOnlyMaker") {
        return "Only the maker wallet can commit desk sets."
      }
      if (name) return name
    }
    if (raw.includes("0xbcc83eca")) {
      return "Desk retune already staged (PendingDeskSet). Retry Execute to resume, or FRESH_FORK=1 redeploy if ship keeps failing."
    }
    return e.shortMessage || e.message
  }
  if (e instanceof Error) return e.message
  return "Commit/swap failed"
}

type GatewayState = {
  aqua: Address
  router: Address
  oldHash: Hex
  hasPending: boolean
  pendingHash: Hex
  pendingBalBase: bigint
  pendingBalQuote: bigint
  pendingStrategy: Hex
}

const readGateway = async (publicClient: PublicClient, gateway: Address): Promise<GatewayState> => {
  const [aqua, router, oldHash, hasPending, pendingHash, pendingBalBase, pendingBalQuote, pendingStrategy] =
    await Promise.all([
      publicClient.readContract({ address: gateway, abi: aquaPrimeGatewayAbi, functionName: "AQUA" }),
      publicClient.readContract({ address: gateway, abi: aquaPrimeGatewayAbi, functionName: "ROUTER" }),
      publicClient.readContract({ address: gateway, abi: aquaPrimeGatewayAbi, functionName: "strategyHash" }),
      publicClient.readContract({
        address: gateway,
        abi: aquaPrimeGatewayAbi,
        functionName: "hasPendingDeskSet",
      }),
      publicClient.readContract({
        address: gateway,
        abi: aquaPrimeGatewayAbi,
        functionName: "pendingStrategyHash",
      }),
      publicClient.readContract({
        address: gateway,
        abi: aquaPrimeGatewayAbi,
        functionName: "pendingBalBase",
      }),
      publicClient.readContract({
        address: gateway,
        abi: aquaPrimeGatewayAbi,
        functionName: "pendingBalQuote",
      }),
      publicClient.readContract({
        address: gateway,
        abi: aquaPrimeGatewayAbi,
        functionName: "pendingStrategy",
      }),
    ])
  return {
    aqua: aqua as Address,
    router: router as Address,
    oldHash: oldHash as Hex,
    hasPending: !!hasPending,
    pendingHash: pendingHash as Hex,
    pendingBalBase: pendingBalBase as bigint,
    pendingBalQuote: pendingBalQuote as bigint,
    pendingStrategy: pendingStrategy as Hex,
  }
}

const isStrategyActive = async (
  publicClient: PublicClient,
  aqua: Address,
  maker: Address,
  router: Address,
  strategyHash: Hex,
  token: Address,
): Promise<boolean> => {
  try {
    const raw = await publicClient.readContract({
      address: aqua,
      abi: aquaAbi,
      functionName: "rawBalances",
      args: [maker, router, strategyHash, token],
    })
    const tokensCount = Number((raw as readonly [bigint, number])[1])
    return tokensCount > 0 && tokensCount !== DOCKED
  } catch {
    return false
  }
}

const writeSimulated = async (
  args: CommitDeskAndSwapArgs,
  req: Record<string, unknown>,
  label: string,
): Promise<void> => {
  const { request } = await args.publicClient.simulateContract({
    ...(req as Parameters<PublicClient["simulateContract"]>[0]),
    account: args.address,
  })
  const hash = await args.writeContractAsync(request as Record<string, unknown>)
  await args.waitForTx(hash, label)
}

const dockIfActive = async (
  args: CommitDeskAndSwapArgs,
  aqua: Address,
  router: Address,
  oldHash: Hex,
  tokens: readonly [Address, Address],
  note: (s: string) => void,
): Promise<void> => {
  const active = await isStrategyActive(args.publicClient, aqua, args.address, router, oldHash, tokens[0])
  if (!active) {
    note("Prior strategy already docked — skipping dock.")
    return
  }
  note("Docking prior strategy…")
  await writeSimulated(args, aquaDockWriteRequest(aqua, router, oldHash, tokens) as Record<string, unknown>, "Dock")
}

const shipIfNeeded = async (
  args: CommitDeskAndSwapArgs,
  aqua: Address,
  router: Address,
  pendingHash: Hex,
  strategy: Hex,
  tokens: readonly [Address, Address],
  amounts: readonly [bigint, bigint],
  note: (s: string) => void,
): Promise<void> => {
  const shipped = await isStrategyActive(args.publicClient, aqua, args.address, router, pendingHash, tokens[0])
  if (shipped) {
    note("Pending strategy already shipped — skipping ship.")
    return
  }
  note("Shipping retuned strategy…")
  try {
    await writeSimulated(
      args,
      aquaShipWriteRequest(aqua, router, strategy, tokens, amounts) as Record<string, unknown>,
      "Ship",
    )
  } catch (e) {
    if (formatCommitError(e).includes("StrategiesMustBeImmutable")) {
      note("Strategy already on Aqua — continuing.")
      return
    }
    throw e
  }
}

const runSwap = async (args: CommitDeskAndSwapArgs, gateway: Address, note: (s: string) => void) => {
  note("Swapping…")
  await writeSimulated(
    args,
    swapExactInWriteRequest(gateway, args.amountInWei, args.sellBase) as Record<string, unknown>,
    "Swap",
  )
}

export async function commitDeskAndSwap(args: CommitDeskAndSwapArgs): Promise<void> {
  const gate = commitMakerGate(args.address)
  if (gate) throw new Error(gate)

  const gateway = contracts.AquaPrimeSwapGateway.address as Address
  const weth = contracts.WETH.address as Address
  const usdc = contracts.USDC.address as Address
  const tokenIn = args.sellBase ? weth : usdc
  const tokens = [weth, usdc] as const
  const note = args.onStatus ?? (() => {})

  try {
    if (args.needsApproval) {
      note("Approving token…")
      await writeSimulated(args, approveWriteRequest(tokenIn, gateway) as Record<string, unknown>, "Approve")
    }

    const gw0 = await readGateway(args.publicClient, gateway)

    // Stuck mid-retune from a prior MetaMask reject / revert — finish it, then swap.
    if (gw0.hasPending) {
      note("Resuming staged desk set (prior Execute left it pending)…")
      if (!gw0.pendingStrategy || gw0.pendingStrategy === "0x") {
        throw new Error("Gateway has a pending desk set but no strategy bytes — redeploy fork stack.")
      }

      const priorStillLive = await isStrategyActive(
        args.publicClient,
        gw0.aqua,
        args.address,
        gw0.router,
        gw0.oldHash,
        tokens[0],
      )

      try {
        await dockIfActive(args, gw0.aqua, gw0.router, gw0.oldHash, tokens, note)
        await shipIfNeeded(
          args,
          gw0.aqua,
          gw0.router,
          gw0.pendingHash,
          gw0.pendingStrategy,
          tokens,
          [gw0.pendingBalBase, gw0.pendingBalQuote],
          note,
        )
        note("Finalizing resumed desk set…")
        await writeSimulated(args, finalizeDeskSetWriteRequest(gateway) as Record<string, unknown>, "Finalize desk set")
        await runSwap(args, gateway, note)
        note("Trade settled. Desk parameters committed sir.")
        return
      } catch (resumeErr) {
        const msg = formatCommitError(resumeErr)
        // If dock never happened and resume is blocked by a dead archive RPC, drop pending so a
        // fresh stage can run after the user restarts Anvil with an archive RPC.
        if (priorStillLive && /archive|403|publicnode/i.test(msg)) {
          note("Archive RPC blocked ship — abandoning pending desk set so you can retry after FRESH_FORK…")
          try {
            await writeSimulated(
              args,
              abandonPendingDeskSetWriteRequest(gateway) as Record<string, unknown>,
              "Abandon pending",
            )
          } catch {
            /* abandon only exists after redeploy; fall through */
          }
        }
        throw resumeErr
      }
    }

    const desk = clampDeskSet({
      ...args.proposal.params,
      deadline: BigInt(Math.floor(Date.now() / 1000) + 180),
    })

    note("1/4 Staging desk set…")
    const stageReq = stageDeskSetWriteRequest(gateway, desk)
    const { request: stageRequest, result: stageResult } = await args.publicClient.simulateContract({
      ...stageReq,
      account: args.address,
    })
    const stageHash = await args.writeContractAsync(stageRequest as Record<string, unknown>)
    await args.waitForTx(stageHash, "Stage desk set")

    const [oldHash, stageBalBase, stageBalQuote, strategy] = stageResult as [Hex, bigint, bigint, Hex]
    const gw = await readGateway(args.publicClient, gateway)

    note("2/4 Docking prior strategy…")
    await dockIfActive(args, gw.aqua, gw.router, oldHash, tokens, note)

    note("3/4 Shipping retuned strategy…")
    await shipIfNeeded(
      args,
      gw.aqua,
      gw.router,
      gw.pendingHash,
      strategy,
      tokens,
      [stageBalBase, stageBalQuote],
      note,
    )

    note("4/4 Finalizing + swap…")
    await writeSimulated(args, finalizeDeskSetWriteRequest(gateway) as Record<string, unknown>, "Finalize desk set")
    await runSwap(args, gateway, note)

    note("Trade settled. Desk parameters committed sir.")
  } catch (e) {
    throw new Error(formatCommitError(e))
  }
}
