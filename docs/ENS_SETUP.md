# ENS setup — Prime Desk + Jarvis soul

## Desk: `maker.primedesk.eth`

| Key | Value |
|-----|-------|
| `prime.pair` | `WETH/USDC` |
| `prime.strategyHash` | from gateway `STRATEGY_HASH()` / `strategyHash()` |
| `prime.k` | optional live healK |
| `prime.lambda` | optional selector λ |

## Agent: `jarvis.primedesk.eth` (ENS as soul)

Jarvis loads persona + discovery from text records. The app ships a full JARVIS (“sir”) fallback if records are missing.

| Key | Example |
|-----|---------|
| `agent.soul` | `You are JARVIS… Always address the principal as "sir".…` |
| `agent.address_as` | `sir` |
| `agent.voice` | `calm,collected,deferential,sir,concise` |
| `agent.role` | `prime-desk-settings-oracle` |
| `agent.endpoint` | `https://your-host/api/jarvis/propose` or `/api/jarvis/propose` |
| `agent.desk` | `maker.primedesk.eth` |
| `agent.model` | `0g:router/0gm-1.0-35b-a3b` — app honors this over bare `ZEROG_MODEL` when set |
| `agent.capabilities` | `healK,maxAdjustment,healPremium,lambda` |
| `agent.attestation` | last 0G attestation hash (auto via `POST /api/jarvis/attest` when writer key is set) |

## ENSIP-26 + IPFS discovery (prize path)

Portable agent home lives under [`aqua-prime-scaffold/public/agent/`](../aqua-prime-scaffold/public/agent/) (`index.html`, `agent-card.json`, `.well-known/agent.json`). Pin it to IPFS, then point ENS at it.

| Key | Example |
|-----|---------|
| `contenthash` | `ipfs://<CID>` (agent site root) |
| `agent-context` | short blurb: Jarvis desk agent for Prime Desk… |
| `agent-endpoint[web]` | `https://YOUR_HOST/api/jarvis/propose` (preferred over `agent.endpoint`) |
| `agent-endpoint[a2a]` | `ipfs://<CID>/agent/agent-card.json` |

**Judge pitch:** resolve `jarvis.primedesk.eth` → IPFS agent card / contenthash → live propose endpoint → 0G brain. IPFS hosts the identity document; inference stays on 0G/HTTPS.

### Pin the agent site

```bash
cd aqua-prime-scaffold && yarn publish:agent
```

Requires `PINATA_JWT` in `.env.local`. Or:

```bash
curl -X POST http://localhost:3000/api/jarvis/publish-agent -H 'content-type: application/json' -d '{"proposeUrl":"https://YOUR_HOST/api/jarvis/propose"}'
```

Script/API print CID + suggested ENS writes. Set `contenthash` / text records in the ENS app or with cast (operator-owned; the app does not auto-write `contenthash` in v1).

Local preview without Pinata: open `/agent/` and `/agent/agent-card.json` on the Next host.

### Optional ENS publish after 0G propose

Set on the Next server:

```bash
ENS_WRITER_PRIVATE_KEY=0x...
ENS_RESOLVER_ADDRESS=0x...
```

Then:

```bash
curl -X POST http://localhost:3000/api/jarvis/attest -H 'content-type: application/json' -d '{"healK":"...","lambda":"..."}'
```

Writes `agent.attestation` on the Jarvis name and optional `prime.k` / `prime.lambda` on the desk name.

### Suggested soul text

```
You are JARVIS, the desk agent for Prime Desk. Calm, collected, precise. Dry understated British wit only when it helps. Always address the principal as "sir". Confirm intent briefly, state the action, never alarm. Prefer "I've adjusted…" over hype. You manage inventory-heal parameters against the Uniswap reference; you do not invent settlement amounts.
```

### Set records (cast example)

```bash
cast send $RESOLVER "setText(bytes32,string,string)" $JARVIS_NODE "agent.address_as" "sir" --rpc-url $SEPOLIA_RPC --private-key $PK
```

```bash
cast send $RESOLVER "setText(bytes32,string,string)" $JARVIS_NODE "agent.soul" "You are JARVIS..." --rpc-url $SEPOLIA_RPC --private-key $PK
```

```bash
cast send $RESOLVER "setText(bytes32,string,string)" $JARVIS_NODE "agent-endpoint[web]" "https://YOUR_HOST/api/jarvis/propose" --rpc-url $SEPOLIA_RPC --private-key $PK
```

```bash
cast send $RESOLVER "setText(bytes32,string,string)" $JARVIS_NODE "agent-endpoint[a2a]" "ipfs://CID/agent/agent-card.json" --rpc-url $SEPOLIA_RPC --private-key $PK
```

Use Sepolia or mainnet via `NEXT_PUBLIC_ENS_CHAIN` and the matching RPC URL. Update `ensName` / `jarvisEns` in the deploy manifest after `recordDeskShipped`.

The terminal **IDENTITY** panel shows DESK + AGENT, including IPFS CID / contenthash / discovery source when set. `/jarvis` shows the same custody strip. Jarvis propose injects `agent.soul` into the 0G system prompt and tips the model from `agent.model`; `agent-endpoint[web]` wins over `agent.endpoint` when both exist.
