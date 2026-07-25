# Aqua Prime

**An inventory-healing market maker on 1inch Aqua + SwapVM.**

DeFi AMMs give an LP one passive curve per pool. A TradFi desk manages one inventory book
and shades every quote against imbalance, anchors to a reference price, and routes each order
through the right execution model. **Aqua Prime is that desk layer, expressed as SwapVM
bytecode over shared, self-custodied Aqua liquidity.**

> **Thesis — maker-side best execution.** The router does not pick the branch that pays the
> *taker* most; it picks the branch that best serves the *maker's book*: healing inventory
> imbalance while staying competitive and oracle-honest.

---

## What ships in this PR

| Component | File | Role |
|-----------|------|------|
| `SkewPricer` opcode | `src/instructions/SkewPricer.sol` | **The custom instruction.** Shades price by virtual-balance imbalance so the next trade heals the book. |
| Opcode wiring | `src/opcodes/AquaOpcodes.sol` | Appends `_oraclePriceAdjuster1D` and `_skewPricer` at the END of the table (backward-compatible indices). |
| `PrimeSelector` | `test/mocks/PrimeSelector.sol` | Extruction target: runs branches on the same book and scores them maker-side (`takerValue − λ·|postSkew|`). |
| Mock oracle | `test/mocks/MockChainlinkAggregator.sol` | Settable AggregatorV3 for oracle-branch unit tests. |
| Unit tests | `test/SkewPricer.t.sol` | 9 tests: skew math, bounds, monotonicity, revert paths, quote==swap. |
| E2E tests | `test/AquaPrime.t.sol` | 8 tests: standalone skew ship/swap + selector branch-flip matrix. |
| Fork proof | `test/AquaPrimeFork.t.sol` | 4 tests: live Chainlink + real USDC/USDT settlement + inventory-healing sequence. |
| Deploy | `script/DeployAquaPrime.s.sol` | Deploys `AquaSwapVMRouter` + `PrimeSelector`. |
| Showcase | `script/AquaPrimeDemo.s.sol` | Mainnet-fork simulation printing the healing divergence round by round. |

---

## The SkewPricer instruction

Inventory imbalance → shade the price so the next trade heals the book. All fixed-point (1e18):

```
skew       = (balanceOut − balanceIn) / (balanceOut + balanceIn)      ∈ [−1, +1]
adjustment = clamp(k · skew, −maxAdjustment, +maxAdjustment)
factor     = 1 + adjustment
exactIn :  amountOut *= factor      (floor — maker-favorable)
exactOut:  amountIn  /= factor      (ceil  — maker-favorable)
```

- **Overstocked** in the outgoing token → sell it cheaper → taker gets MORE (attract flow).
- **Scarce** in the outgoing token → protect the thin side → taker gets LESS.
- Runs **after** the swap instruction (needs `amountIn/amountOut > 0`), mirroring `OraclePriceAdjuster`.
- **Deterministic:** reads only in-memory registers + packed args — no time, no external calls — so
  `quote()` and `swap()` are byte-for-byte identical by construction.

Args (`abi.encodePacked`): `k:uint64` (sensitivity), `maxAdjustment:uint64` (hard cap, `< 1e18`).

---

## PrimeSelector — maker-side routing

Forks the reference `BestRouteSelector` and changes exactly one thing, the objective:

```
reference:   pick max(takerValue)                       // taker-side best execution
AquaPrime:   pick max(takerValue − λ · |postSkew|)      // maker-side: output minus inventory penalty
```

Branches (v1): `XYC` · `XYC → OraclePriceAdjuster` · `XYC → SkewPricer`. The selector serves both
`IExtruction` (swap) and `IStaticExtruction` (quote) through one pure, state-free entrypoint, so
routing is quote/swap-consistent.

---

## Proof: mainnet-fork healing sequence

`script/AquaPrimeDemo.s.sol` forks Ethereum, ships a plain-XYC **control** book and a `SkewPricer`
**Prime** book with identical 100k/100k USDC/USDT inventory, then applies the same one-directional
pressure (buy 10k USDT per round) to both. Real run against live state:

```
live Chainlink USDT/USD (1e8): 99906256

round | control skew (1e18) | prime skew (1e18) | USDT left: control vs prime
  1   |   0.09502           |   0.09502         |  90909 vs 90909   (balanced start: identical)
  2   |   0.18033           |   0.17824         |  83333 vs 83693
  3   |   0.25651           |   0.25103         |  76923 vs 77829
  4   |   0.32432           |   0.31563         |  71429 vs 72826
  5   |   0.38462           |   0.37327         |  66667 vs 68456
  6   |   0.43820           |   0.42472         |  62500 vs 64606
```

The Prime book carries **less imbalance** and preserves **more of the scarce out-token** every
round — maker-side best execution, demonstrated on-chain.

---

## Run it (bash, copy-paste)

Unit + end-to-end (no RPC needed):

```bash
cd reference/swap-vm && forge test --match-contract "SkewPricerTest|AquaPrimeTest" -vv
```

Mainnet fork suite (live Chainlink + real ERC20 settlement):

```bash
cd reference/swap-vm && MAINNET_RPC_URL=https://ethereum.publicnode.com forge test --match-contract AquaPrimeForkTest -vv
```

Showcase demo (prints the healing table above):

```bash
cd reference/swap-vm && MAINNET_RPC_URL=https://ethereum.publicnode.com forge script script/AquaPrimeDemo.s.sol -vv
```

Deploy (needs a `config/constants.json` entry for the target chainid):

```bash
cd reference/swap-vm && forge script script/DeployAquaPrime.s.sol --rpc-url $RPC --broadcast
```

---

## Gas

Default-profile snapshot (`aqua-prime.gas-snapshot`, full test cost incl. ship/settle):

| Path | Test | Gas |
|------|------|-----|
| Standalone skew ship→swap | `test_ship_and_swap_standalone_skew_program` | 371,286 |
| Selector, 1 branch wins (XYC) | `test_selector_picks_xyc_when_balanced` | 673,069 |
| Selector, 3 branches scored (skew wins) | `test_selector_picks_skew_when_lopsided` | 802,534 |
| Selector, 3 branches scored (oracle wins) | `test_selector_picks_oracle_when_drifted` | 805,450 |

The selector runs one nested `runLoop` per branch, so cost scales with branch count (v1 caps at 3).
The standalone `SkewPricer` adds only the fixed-point skew math on top of a plain XYC swap.

Regenerate:

```bash
cd reference/swap-vm && forge snapshot --match-contract "SkewPricerTest|AquaPrimeTest" --snap aqua-prime.gas-snapshot
```

---

## Honest limitations

- Skew shading reduces inventory drift; it does not eliminate directional P&L or guarantee profit.
- Selector scoring adds gas (N nested `runLoop`s); v1 caps branches at 3.
- Raw-balance skew assumes comparable token scales; it is designed for stable/like-decimal desks
  (the demo uses USDC/USDT, both 6dp, ~1:1). Mixed-decimal pairs (e.g. WETH/USDC) bias the absolute
  skew — the *relative* healing behaviour still holds, but the intended market is like-scale books.
- λ (inventory penalty) is a maker-chosen parameter, not learned.
- The fork oracle branch uses `maxStaleness = 0` (freshness gate skipped) because stablecoin feeds
  have ~24h heartbeats; the feed is still read live.

See `../../AQUA_PRIME.md` and `../../AQUA_PRIME_TESTING_RULES.md` for the full design and testing spec.
