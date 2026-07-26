import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { sepolia } from "viem/chains";
import scaffoldConfig, { primeDeskFork } from "~~/scaffold.config";

export const wagmiConfig = createConfig({
  chains: scaffoldConfig.targetNetworks,
  connectors: [injected()],
  transports: {
    [primeDeskFork.id]: http(scaffoldConfig.forkRpcUrl),
    [sepolia.id]: http(scaffoldConfig.sepoliaRpcUrl),
  },
  ssr: true,
});
