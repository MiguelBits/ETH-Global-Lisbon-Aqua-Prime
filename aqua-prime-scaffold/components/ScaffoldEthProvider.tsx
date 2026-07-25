"use client";

import { getDefaultConfig, RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import "@rainbow-me/rainbowkit/styles.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { http, WagmiProvider } from "wagmi";
import scaffoldConfig from "~~/scaffold.config";

const targetChain = scaffoldConfig.targetNetworks[0];
const rpcUrl = targetChain.id === 11155111 ? scaffoldConfig.sepoliaRpcUrl : scaffoldConfig.forkRpcUrl;

const config = getDefaultConfig({
  appName: "Prime Desk",
  projectId: scaffoldConfig.walletConnectProjectId,
  chains: [targetChain],
  transports: {
    [targetChain.id]: http(rpcUrl),
  },
  ssr: false,
});

export function ScaffoldEthProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={darkTheme()} modalSize="compact" initialChain={targetChain} showRecentTransactions>
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
