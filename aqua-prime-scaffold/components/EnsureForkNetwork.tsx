"use client";

import { useAccount, useSwitchChain } from "wagmi";
import scaffoldConfig from "~~/scaffold.config";

const TARGET = scaffoldConfig.targetNetworks[0];

export function EnsureForkNetwork() {
  const { isConnected, chain } = useAccount();
  const { switchChain, isPending, error } = useSwitchChain();

  const wrongChain = isConnected && chain?.id !== TARGET.id;

  if (!wrongChain) return null;

  const rpc =
    TARGET.id === 11155111 ? scaffoldConfig.sepoliaRpcUrl : scaffoldConfig.forkRpcUrl;

  return (
    <div className="term-panel mb-4 border-amber-700/60 text-amber-200">
      <p className="term-value-warn font-semibold">WRONG NETWORK</p>
      <p className="mt-1 text-xs">
        Switch to <strong>{TARGET.name}</strong> (chainId {TARGET.id}) · RPC{" "}
        <code className="text-white">{rpc}</code>
      </p>
      <button type="button" className="btn-term mt-2" disabled={isPending} onClick={() => switchChain({ chainId: TARGET.id })}>
        {isPending ? "Switching…" : "Switch network"}
      </button>
      {error ? <p className="mt-2 text-xs text-red-400">{error.message}</p> : null}
    </div>
  );
}
