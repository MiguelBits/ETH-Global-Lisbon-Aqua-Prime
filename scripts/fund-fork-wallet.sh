#!/usr/bin/env bash
# Fund any wallet on the local mainnet fork (ETH + optional USDC/USDT top-up).
# Usage:
#   bash scripts/fund-fork-wallet.sh 0x7Ad9C1B205Deed832cdaC82baF161BE659411daD
#   DEMO_USDC=50000 bash scripts/fund-fork-wallet.sh 0xYourWallet
set -euo pipefail

RPC="${FORK_RPC_URL:-http://127.0.0.1:8545}"
WALLET="${1:-${DEMO_WALLET:-}}"
ETH_BALANCE="${DEMO_ETH:-0x3635C9ADC5DEA00000}"   # 1000 ETH
USDC_WHALE="0x40ec5B33f54e0E8A33A975908C5BA1c14e5BbbDf"
USDT_WHALE="0xF977814e90dA44bFA03b6295A0616a897441aceC"
USDC="0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
USDT="0xdAC17F958D2ee523a2206206994597C13D831ec7"
WHALE_ETH="0x3635C9ADC5DEA00000"

if [[ -z "$WALLET" ]]; then
  echo "Usage: bash scripts/fund-fork-wallet.sh <address>"
  echo "  or:  DEMO_WALLET=0x... bash scripts/fund-fork-wallet.sh"
  exit 1
fi

log() { echo "[fund-fork-wallet] $*"; }

log "Funding $WALLET on $RPC"

cast rpc anvil_setBalance "$WALLET" "$ETH_BALANCE" --rpc-url "$RPC" >/dev/null
cast rpc anvil_setBalance "$USDC_WHALE" "$WHALE_ETH" --rpc-url "$RPC" >/dev/null
cast rpc anvil_setBalance "$USDT_WHALE" "$WHALE_ETH" --rpc-url "$RPC" >/dev/null

eth=$(cast balance "$WALLET" --rpc-url "$RPC" --ether)
usdc=$(cast call "$USDC" "balanceOf(address)(uint256)" "$WALLET" --rpc-url "$RPC")
usdt=$(cast call "$USDT" "balanceOf(address)(uint256)" "$WALLET" --rpc-url "$RPC")
log "Current: ${eth} ETH, ${usdc} USDC (6 dec), ${usdt} USDT (6 dec)"

if [[ -n "${DEMO_USDC:-}" ]]; then
  amount=$(python3 -c "print(int(float('${DEMO_USDC}') * 1_000_000))" 2>/dev/null \
    || python -c "print(int(float('${DEMO_USDC}') * 1_000_000))" 2>/dev/null \
    || echo "$((${DEMO_USDC%.*} * 1000000))")
  log "Topping up ${DEMO_USDC} USDC from whale…"
  cast send "$USDC" "transfer(address,uint256)" "$WALLET" "$amount" \
    --rpc-url "$RPC" --unlocked --from "$USDC_WHALE" >/dev/null
fi

if [[ -n "${DEMO_USDT:-}" ]]; then
  amount=$(python3 -c "print(int(float('${DEMO_USDT}') * 1_000_000))" 2>/dev/null \
    || python -c "print(int(float('${DEMO_USDT}') * 1_000_000))" 2>/dev/null \
    || echo "$((${DEMO_USDT%.*} * 1000000))")
  log "Topping up ${DEMO_USDT} USDT from whale…"
  cast send "$USDT" "transfer(address,uint256)" "$WALLET" "$amount" \
    --rpc-url "$RPC" --unlocked --from "$USDT_WHALE" >/dev/null
fi

eth=$(cast balance "$WALLET" --rpc-url "$RPC" --ether)
usdc=$(cast call "$USDC" "balanceOf(address)(uint256)" "$WALLET" --rpc-url "$RPC")
usdt=$(cast call "$USDT" "balanceOf(address)(uint256)" "$WALLET" --rpc-url "$RPC")
log "Done: ${eth} ETH, ${usdc} USDC (6 dec), ${usdt} USDT (6 dec)"
