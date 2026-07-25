# Prime Desk — Terminal Frontend

Next.js Bloomberg-style terminal for the **Prime Desk** market-making desk (the productized upgrade of Aqua Prime),
tested on a **mainnet fork** (Anvil @ `http://127.0.0.1:8545`) and deployable to **Sepolia**.

Uses the **canonical mainnet Aqua registry** (`0x4a055AA172C98ec32de118B9B5b6AC8B4099A580`) — only the custom `AquaSwapVMRouter` (SkewPricer), `PrimeSelector`, and `AquaPrimeSwapGateway` are deployed on the fork.

Inspired by [Scaffold-ETH 2](https://github.com/scaffold-eth/scaffold-eth-2): RainbowKit + wagmi + viem.

## Quick start (one command)

From repo root:

```bash
bash scripts/dev-aqua-prime.sh
```

This will:

1. **Restart** Anvil forked from mainnet (default `FRESH_FORK=1` — avoids stale-fork RPC errors)
2. Fund the default Anvil deployer + token whales with ETH
3. Run `DeployAquaPrimeStack.s.sol` (canonical mainnet **Aqua**, custom **AquaSwapVMRouter** with SkewPricer, PrimeSelector, **AquaPrimeSwapGateway**)
4. Sync addresses into `contracts/deployedContracts.ts`
5. Start the frontend at [http://localhost:3000/desk](http://localhost:3000/desk) (the legacy `/aqua-prime` path redirects here)

## Manual steps

```bash
# Terminal 1 — fork
anvil --fork-url https://ethereum.publicnode.com --chain-id 1 --host 127.0.0.1 --port 8545 --auto-impersonate

# Terminal 2 — deploy
cd reference/swap-vm && cast rpc anvil_setBalance 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 0x3635C9ADC5DEA00000 --rpc-url http://127.0.0.1:8545
cd reference/swap-vm && forge script script/DeployAquaPrimeStack.s.sol --rpc-url http://127.0.0.1:8545 --unlocked --sender 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 --broadcast -vv

# Terminal 3 — frontend
cd aqua-prime-scaffold && yarn install && yarn sync-deployments && yarn dev
```

## Wallet setup

- **Chain ID:** `1` (mainnet fork semantics)
- **RPC:** `http://127.0.0.1:8545`
- Default Anvil account `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` is funded with USDC during deploy.
- Any wallet can swap via **AquaPrimeSwapGateway** after approving USDC.

## Files

| Path | Purpose |
|------|---------|
| `app/desk/page.tsx` | Terminal: ticket, routing, inventory, blotter |
| `contracts/deployedContracts.ts` | Generated from fork manifest |
| `scripts/sync-deployments.mjs` | Reads `reference/swap-vm/deployments/aqua-prime-fork.json` |
| `scaffold.config.ts` | Fork chain + RPC |

## Jarvis

- **Consult Jarvis** → `POST /api/jarvis/propose`
  - Uniswap **CLASSIC + BEST_PRICE** → `TapeIntel` (impact, route, gas, edge, filler gap)
  - Local / 0G knobs for the on-screen ticket
- **Commit desk & swap** (maker) → `stageDeskSet` → Aqua `dock`/`ship` → `finalizeDeskSet` → `swapExactIn`
- Spec: [`../docs/UNISWAP_JARVIS.md`](../docs/UNISWAP_JARVIS.md)
- Soul / discovery: `jarvis.primedesk.eth` + IPFS agent card ([`../docs/ENS_SETUP.md`](../docs/ENS_SETUP.md), `public/agent/`)
- Pin agent site: `yarn publish:agent` (needs `PINATA_JWT`) or `POST /api/jarvis/publish-agent`

## Prize notes

| Sponsor | Evidence |
|---------|----------|
| 1inch | SwapVM + skew + live desk retune + transfers |
| Uniswap | TapeIntel from Trade API; see `FEEDBACK.md` + `docs/UNISWAP_JARVIS.md` |
| 0G | `ZEROG_API_KEY` → mode `0g` + attestation on desk set |
| ENS | Agent soul + ENSIP-26 / IPFS contenthash discovery |

## Environment

Copy `.env.example` → `.env.local`:

```
UNISWAP_API_KEY=
ZEROG_API_KEY=
NEXT_PUBLIC_FORK_RPC_URL=http://127.0.0.1:8545
NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID=your_project_id
NEXT_PUBLIC_ENS_CHAIN=sepolia
NEXT_PUBLIC_JARVIS_ENS=jarvis.primedesk.eth
```

### Stale fork / `historical state is not available`

If deploy fails with that error, the script now restarts Anvil by default. For stubborn cases use an archive RPC:

```bash
FRESH_FORK=1 MAINNET_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY bash scripts/dev-aqua-prime.sh
```

To reuse an existing Anvil instance: `FRESH_FORK=0 bash scripts/dev-aqua-prime.sh`
