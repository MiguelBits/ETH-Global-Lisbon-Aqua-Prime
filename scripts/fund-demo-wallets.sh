#!/usr/bin/env bash
# Fund demo/test wallets AFTER fork + deploy (ETH for gas + WETH/USDC for Prime Desk swaps).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RPC="${FORK_RPC_URL:-http://127.0.0.1:8545}"
CONFIG="${DEMO_WALLETS_CONFIG:-$ROOT/scripts/demo-wallets.json}"
WETH="0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"
USDC="0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
USDT="0xdAC17F958D2ee523a2206206994597C13D831ec7"
WETH_WHALE="0x28C6c06298d514Db089934071355E5743bf21d60"
USDC_WHALE="0x40ec5B33f54e0E8A33A975908C5BA1c14e5BbbDf"
USDT_WHALE="0xF977814e90dA44bFA03b6295A0616a897441aceC"
ETH_TOPUP="0x3635C9ADC5DEA00000"

log() { echo "[fund-demo-wallets] $*"; }

rpc_up() {
  curl -sf "$RPC" -X POST -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' >/dev/null 2>&1
}

impersonate() {
  cast rpc anvil_impersonateAccount "$1" --rpc-url "$RPC" >/dev/null
  cast rpc anvil_setBalance "$1" "$ETH_TOPUP" --rpc-url "$RPC" >/dev/null
}

token_transfer() {
  local token=$1 whale=$2 to=$3 amount=$4 label=$5
  if [[ "$amount" -le 0 ]]; then
    return 0
  fi
  impersonate "$whale"
  if ! cast send "$token" "transfer(address,uint256)" "$to" "$amount" \
    --rpc-url "$RPC" --unlocked --from "$whale" >/dev/null 2>&1; then
    log "   warn: $label transfer skipped (whale send failed)"
  fi
}

if ! rpc_up; then
  log "No fork RPC at $RPC — skip (start anvil first)"
  exit 0
fi

if [[ ! -f "$CONFIG" ]]; then
  log "No config at $CONFIG — skip"
  exit 0
fi

eval "$(node -e "
const c = require(process.argv[1]);
console.log('ETH_WEI=' + (c.ethWei || '0x3635C9ADC5DEA00000'));
console.log('WETH_AMOUNT=' + (c.weth ?? 5));
console.log('USDC_AMOUNT=' + (c.usdc ?? 50000));
console.log('USDT_AMOUNT=' + (c.usdt ?? 0));
console.log('WALLETS=\"' + (c.wallets || []).join(' ') + '\"');
" "$CONFIG")"

if [[ -z "$WALLETS" ]]; then
  log "No wallets in config — skip"
  exit 0
fi

log "Funding demo wallets on $RPC (WETH/USDC via whales — Prime Desk pair)"

for WALLET in $WALLETS; do
  log "→ $WALLET"
  cast rpc anvil_setBalance "$WALLET" "$ETH_WEI" --rpc-url "$RPC" >/dev/null

  weth_raw=$(node -e "console.log(BigInt(Math.round($WETH_AMOUNT * 1e18)).toString())")
  usdc_raw=$(node -e "console.log(BigInt(Math.round($USDC_AMOUNT * 1e6)).toString())")
  usdt_raw=$(node -e "console.log(BigInt(Math.round($USDT_AMOUNT * 1e6)).toString())")

  token_transfer "$WETH" "$WETH_WHALE" "$WALLET" "$weth_raw" "WETH"
  token_transfer "$USDC" "$USDC_WHALE" "$WALLET" "$usdc_raw" "USDC"
  token_transfer "$USDT" "$USDT_WHALE" "$WALLET" "$usdt_raw" "USDT"

  eth=$(cast balance "$WALLET" --rpc-url "$RPC" --ether)
  weth=$(cast call "$WETH" "balanceOf(address)(uint256)" "$WALLET" --rpc-url "$RPC")
  usdc=$(cast call "$USDC" "balanceOf(address)(uint256)" "$WALLET" --rpc-url "$RPC")
  log "   ${eth} ETH · ${weth} WETH (wei) · ${usdc} USDC (6 dec)"
done

log "Demo wallets ready"
