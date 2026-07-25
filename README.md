# Aqua Prime

Inventory-healing market-making desk on **1inch Aqua + SwapVM**.

Built for the ETHGlobal hackathon.

## Layout

```text
reference/swap-vm/       # forked from 1inch/swap-vm (baseline)
aqua-prime-scaffold/     # desk terminal + Jarvis (incoming)
scripts/                 # one-command fork demo (incoming)
docs/                    # ENS + operator notes (incoming)
```

## SwapVM

`reference/swap-vm` is a vendored fork of [1inch/swap-vm](https://github.com/1inch/swap-vm). Custom opcodes and the Prime desk stack land on top of this baseline.

## Status

Baseline SwapVM fork checked in. Aqua Prime instructions and UI ship next.
