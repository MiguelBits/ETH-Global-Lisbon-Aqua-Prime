import { defineChain } from "viem";
import { sepolia } from "viem/chains";

/** Local Anvil mainnet fork (Prime Desk dev) */
export const primeDeskFork = defineChain({
  id: 31337,
  name: "Prime Desk Fork",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.NEXT_PUBLIC_FORK_RPC_URL ?? "http://127.0.0.1:8545"] },
  },
});

const targetNetwork =
  process.env.NEXT_PUBLIC_CHAIN === "sepolia"
    ? sepolia
    : primeDeskFork;

const scaffoldConfig = {
  targetNetworks: [targetNetwork] as [typeof targetNetwork],
  pollingInterval: 3000,
  walletConnectProjectId: process.env.NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID ?? "3a8170812b534d0ff9d794f19a901d64",
  forkRpcUrl: process.env.NEXT_PUBLIC_FORK_RPC_URL ?? "http://127.0.0.1:8545",
  sepoliaRpcUrl: process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL ?? "https://rpc.sepolia.org",
};

export default scaffoldConfig;
