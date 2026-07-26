# Prime Desk — Jarvis demo script (~3–4 min)

## Cold open (15s)

> "Prime Desk is a self-custodied WETH/USDC market-making desk on 1inch Aqua + SwapVM. **Jarvis** reads Uniswap tape intel, then retunes heal knobs. Soul on ENS, brain on 0G."

## 1. ENS + IPFS discovery (45s)

- **IDENTITY · DESK:** `maker.primedesk.eth`
- **IDENTITY · AGENT:** `jarvis.primedesk.eth` — soul, endpoint, IPFS card

## 2. Book (15s)

- Skewed inventory (USDC-heavy)

## 3. Jarvis + Uniswap tape (60s)

- Ticket **Sell 1 WETH** → Consult Jarvis / Best settings
- Show **UNI TAPE**: edge vs CLASSIC, price impact, gas, route, BESTΔ
- Knobs armed; spoken line cites impact + edge
- Spec: [`docs/UNISWAP_JARVIS.md`](docs/UNISWAP_JARVIS.md)

## 4. Commit & swap (60s)

- Maker commit desk & swap → balances move; HEAL when book is lopsided

## 5. Close (15s)

> "Uniswap tells Jarvis the tape; SwapVM settles the heal. Maker-side best execution on Aqua."

## Prize checklist

- [ ] Onchain token transfers visible
- [ ] SwapVM custom skew + PrimeSelector
- [ ] Uniswap TapeIntel visible (impact + route + edge) — `FEEDBACK.md` + form
- [ ] 0G mode when key set
- [ ] ENS / IPFS discovery
- [ ] Incremental git history
