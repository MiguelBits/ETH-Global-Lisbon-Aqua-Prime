# Subgraph deploy

After the Sepolia deploy, `prepare-manifest` auto-fills the gateway address and start block in `subgraph.yaml` from `reference/swap-vm/deployments/aqua-prime-sepolia.json` — no manual editing:

```bash
cd subgraph && yarn install && yarn prepare-manifest && yarn codegen && yarn build && graph deploy --studio prime-desk
```

Set `NEXT_PUBLIC_SUBGRAPH_URL` to the Studio query URL in `aqua-prime-scaffold/.env.local`.
