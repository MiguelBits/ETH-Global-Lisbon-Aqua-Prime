# Aqua Prime

Inventory-healing market-making desk on **1inch Aqua + SwapVM**.

Built for the ETHGlobal hackathon.

## Layout

```text
reference/swap-vm/       # forked SwapVM (Aqua-compatible opcode table)
aqua-prime-scaffold/     # desk terminal + Jarvis (incoming)
scripts/                 # one-command fork demo (incoming)
docs/                    # ENS + operator notes (incoming)
```

## SwapVM

`reference/swap-vm` is a fork of [1inch/swap-vm](https://github.com/1inch/swap-vm), pinned to the Aqua table-dispatcher opcode layout (`SolvencyGuard`, `OraclePriceAdjuster`). Custom skew + desk apps land next.

## Status

Aqua-compatible VM core synced. SkewPricer and Prime desk contracts shipping next.
