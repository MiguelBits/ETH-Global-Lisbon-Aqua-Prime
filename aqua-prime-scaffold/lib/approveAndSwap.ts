import { maxUint256, type Address, type Hex } from "viem";
import { aquaAbi, aquaPrimeGatewayAbi, erc20Abi } from "~~/contracts/abis";
import type { JarvisDeskSet } from "~~/lib/jarvis/schema";

/**
 * ERC20 approve for the gateway. Uses max allowance so later swaps skip a second approval tx.
 *
 * Note: Multicall3 `aggregate3` cannot batch approve+swap — subcalls see Multicall3 as `msg.sender`,
 * so the gateway's `transferFrom(msg.sender, …)` would pull from the wrong account.
 */
export function approveWriteRequest(tokenIn: Address, gateway: Address) {
  return {
    address: tokenIn,
    abi: erc20Abi,
    functionName: "approve" as const,
    args: [gateway, maxUint256] as const,
  };
}

export function stageDeskSetWriteRequest(gateway: Address, desk: JarvisDeskSet) {
  return {
    address: gateway,
    abi: aquaPrimeGatewayAbi,
    functionName: "stageDeskSet" as const,
    args: [
      {
        healK: desk.healK,
        maxAdjustment: desk.maxAdjustment,
        healPremium: desk.healPremium,
        lambda: desk.lambda,
        deadline: desk.deadline,
        attestation: desk.attestation,
      },
    ] as const,
  };
}

export function aquaDockWriteRequest(
  aqua: Address,
  router: Address,
  strategyHash: Hex,
  tokens: readonly [Address, Address],
) {
  return {
    address: aqua,
    abi: aquaAbi,
    functionName: "dock" as const,
    args: [router, strategyHash, [...tokens]] as const,
  };
}

export function aquaShipWriteRequest(
  aqua: Address,
  router: Address,
  strategy: Hex,
  tokens: readonly [Address, Address],
  amounts: readonly [bigint, bigint],
) {
  return {
    address: aqua,
    abi: aquaAbi,
    functionName: "ship" as const,
    args: [router, strategy, [...tokens], [...amounts]] as const,
  };
}

export function finalizeDeskSetWriteRequest(gateway: Address) {
  return {
    address: gateway,
    abi: aquaPrimeGatewayAbi,
    functionName: "finalizeDeskSet" as const,
    args: [] as const,
  };
}

export function abandonPendingDeskSetWriteRequest(gateway: Address) {
  return {
    address: gateway,
    abi: aquaPrimeGatewayAbi,
    functionName: "abandonPendingDeskSet" as const,
    args: [] as const,
  };
}

export function swapExactInWriteRequest(gateway: Address, amountIn: bigint, sellBase: boolean) {
  return {
    address: gateway,
    abi: aquaPrimeGatewayAbi,
    functionName: "swapExactIn" as const,
    args: [amountIn, sellBase] as const,
  };
}
