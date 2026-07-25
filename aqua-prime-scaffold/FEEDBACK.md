# Uniswap Developer Platform — Hackathon Feedback

Project: **Prime Desk / Jarvis** (ETHGlobal Lisbon)

## How we use the Uniswap API

- Endpoint: `POST https://trade-api.gateway.uniswap.org/v1/quote`
- Pair: mainnet WETH ↔ USDC, `EXACT_INPUT`
- Headers: `x-api-key`, `x-universal-router-version: 2.0`
- **Two quotes per consult:** `CLASSIC` + `BEST_PRICE`
- Parsed intel: `amountOut`, `priceImpact`, `gasFeeUSD`, `routeString`, fee tiers, hops, UniswapX start/end, `blockNumber`
- Packed into **`TapeIntel`** → local heuristics + 0G prompt (`uniswapTape`)
- Settlement: Aqua/SwapVM (not Uniswap `/swap`)

Integration:
- [`lib/jarvis/tapeIntel.ts`](lib/jarvis/tapeIntel.ts) — fetch + parse + summary
- [`lib/jarvis/fallback.ts`](lib/jarvis/fallback.ts) — knobs from thinLiquidity / edge / filler gap
- [`app/api/jarvis/propose/route.ts`](app/api/jarvis/propose/route.ts)
- Spec: [`docs/UNISWAP_JARVIS.md`](../docs/UNISWAP_JARVIS.md)

## What worked

- Parallel CLASSIC + BEST_PRICE is enough intelligence for an agent without a multi-size scan
- Native `priceImpact` beats DIY size ladders
- `routeString` makes the tape judge-visible

## Friction / feedback

- Response shape differs CLASSIC vs UniswapX (`output.amount` vs `orderInfo.outputs`)
- `priceImpact` / `routeString` placement varies (nested `quote` vs top-level) — defensive parse needed
- Mainnet tape vs fork settlement needs clear labeling
- Would value a stable typed OpenAPI for Trade API quote fields

## Feedback form

Complete: https://developers.uniswap.org/hackathon-feedback  
Include this `FEEDBACK.md` and [`docs/UNISWAP_JARVIS.md`](../docs/UNISWAP_JARVIS.md).
