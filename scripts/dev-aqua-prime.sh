#!/usr/bin/env bash
# One-shot: mainnet fork → deploy Aqua Prime stack → sync frontend → dev server
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SWAP_VM="$ROOT/reference/swap-vm"
SCAFFOLD="$ROOT/aqua-prime-scaffold"
RPC="${FORK_RPC_URL:-http://127.0.0.1:8545}"

# Load MAINNET_RPC_URL from scaffold env files if not already exported.
# Next.js reads .env.local; this bash script does not unless we source it.
load_env_file() {
  local f="$1"
  [[ -f "$f" ]] || return 0
  # shellcheck disable=SC1090
  set -a
  # Only pull KEY=VALUE lines; ignore comments / blanks
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ "$line" =~ ^[[:space:]]*$ ]] && continue
    if [[ "$line" =~ ^(MAINNET_RPC_URL|NEXT_PUBLIC_MAINNET_RPC_URL|FORK_RPC_URL|ANVIL_PORT|FRESH_FORK|FORK_CHAIN_ID|FRONTEND_PORT)= ]]; then
      export "$line"
    fi
  done < "$f"
  set +a
}
load_env_file "$ROOT/.env"
load_env_file "$ROOT/.env.local"
load_env_file "$SCAFFOLD/.env"
load_env_file "$SCAFFOLD/.env.local"
# Frontend often uses NEXT_PUBLIC_MAINNET_RPC_URL — accept as fallback for Anvil upstream.
if [[ -z "${MAINNET_RPC_URL:-}" && -n "${NEXT_PUBLIC_MAINNET_RPC_URL:-}" ]]; then
  export MAINNET_RPC_URL="$NEXT_PUBLIC_MAINNET_RPC_URL"
fi

# publicnode free tier returns HTTP 403 on archive eth_getStorageAt — Anvil ship/dock then breaks.
# Use Alchemy / Infura / LlamaNodes / etc. with archive access.
UPSTREAM="${MAINNET_RPC_URL:-}"
ANVIL_PORT="${ANVIL_PORT:-8545}"
# Default: always restart Anvil to avoid "historical state is not available" on stale forks.
FRESH_FORK="${FRESH_FORK:-1}"
FORK_CHAIN_ID="${FORK_CHAIN_ID:-31337}"
DEPLOYER="0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
USDC_WHALE="0x40ec5B33f54e0E8A33A975908C5BA1c14e5BbbDf"
USDT_WHALE="0xF977814e90dA44bFA03b6295A0616a897441aceC"
ETH_BALANCE="0x3635C9ADC5DEA00000"
PID_FILE="$ROOT/.anvil-aqua-prime.pid"
LOG_FILE="$ROOT/.anvil-aqua-prime.log"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"
FRONTEND_PID_FILE="$ROOT/.aqua-prime-frontend.pid"

log() { echo "[dev-aqua-prime] $*"; }

if [[ -z "$UPSTREAM" ]]; then
  log "MAINNET_RPC_URL is required (archive-capable)."
  log "  Add to aqua-prime-scaffold/.env.local:"
  log "    MAINNET_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/<KEY>"
  log "  Then: FRESH_FORK=1 bash scripts/dev-aqua-prime.sh"
  log "publicnode.com returns 403 on archive storage and breaks Aqua ship/dock."
  exit 1
fi
if [[ "$UPSTREAM" == *"publicnode"* ]]; then
  log "WARNING: MAINNET_RPC_URL looks like publicnode — archive eth_getStorageAt often 403s."
  log "Prefer Alchemy/Infura/LlamaNodes. Continuing anyway…"
fi
log "Using MAINNET_RPC_URL from env / .env.local"

stop_frontend() {
  if [[ -f "$FRONTEND_PID_FILE" ]]; then
    kill "$(cat "$FRONTEND_PID_FILE")" 2>/dev/null || true
    rm -f "$FRONTEND_PID_FILE"
  fi
  if command -v fuser >/dev/null 2>&1; then
    fuser -k "${FRONTEND_PORT}/tcp" 2>/dev/null || true
  else
    # Git Bash / Windows: free port 3000 if something is listening
    while read -r pid; do
      [[ -n "$pid" && "$pid" != "0" ]] || continue
      taskkill //PID "$pid" //F 2>/dev/null || kill "$pid" 2>/dev/null || true
    done < <(netstat -ano 2>/dev/null | grep ":${FRONTEND_PORT} " | awk '{print $NF}' | sort -u)
  fi
  sleep 1
}

start_frontend() {
  log "Restarting frontend (port $FRONTEND_PORT)…"
  stop_frontend
  log "Removing .next cache…"
  rm -rf "$SCAFFOLD/.next"
  log "Starting Next.js → http://localhost:${FRONTEND_PORT}/desk"
  log "MetaMask: Localhost 8545 (chainId $FORK_CHAIN_ID) · RPC $RPC"
  cd "$SCAFFOLD"
  exec yarn dev
}

rpc_up() {
  curl -sf "$RPC" -X POST -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' >/dev/null 2>&1
}

is_anvil() {
  curl -sf "$RPC" -X POST -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"anvil_impersonateAccount","params":["0x0000000000000000000000000000000000000001"],"id":1}' \
    | grep -q '"result"' 2>/dev/null
}

stop_anvil() {
  if [[ -f "$PID_FILE" ]]; then
    kill "$(cat "$PID_FILE")" 2>/dev/null || true
    rm -f "$PID_FILE"
  fi
  if command -v fuser >/dev/null 2>&1; then
    fuser -k "${ANVIL_PORT}/tcp" 2>/dev/null || true
  elif command -v taskkill >/dev/null 2>&1; then
    taskkill //F //IM anvil.exe 2>/dev/null || true
  fi
  sleep 1
}

start_anvil() {
  log "Starting fresh anvil fork (chainId $FORK_CHAIN_ID) on port $ANVIL_PORT…"
  log "Upstream RPC: $UPSTREAM"
  local extra_args=()
  if [[ -n "${FORK_BLOCK_NUMBER:-}" ]]; then
    extra_args+=(--fork-block-number "$FORK_BLOCK_NUMBER")
    log "Pinned fork block: $FORK_BLOCK_NUMBER"
  fi

  anvil --fork-url "$UPSTREAM" --chain-id "$FORK_CHAIN_ID" --host 127.0.0.1 --port "$ANVIL_PORT" \
    --auto-impersonate "${extra_args[@]}" >"$LOG_FILE" 2>&1 &
  echo $! >"$PID_FILE"

  for _ in $(seq 1 45); do
    if rpc_up && is_anvil; then
      log "Anvil ready (pid $(cat "$PID_FILE"), log: .anvil-aqua-prime.log)"
      return 0
    fi
    sleep 1
  done
  log "Anvil failed to start — tail .anvil-aqua-prime.log"
  tail -20 "$LOG_FILE" 2>/dev/null || true
  exit 1
}

# --- Anvil ---
if [[ "$FRESH_FORK" == "1" ]]; then
  if rpc_up; then
    log "FRESH_FORK=1 — stopping existing RPC on port $ANVIL_PORT"
    stop_anvil
  fi
  start_anvil
elif rpc_up && is_anvil; then
  log "Reusing Anvil at $RPC (set FRESH_FORK=1 to restart)"
else
  if rpc_up; then
    log "Port $ANVIL_PORT in use but not Anvil — set FRESH_FORK=1 or free the port"
    exit 1
  fi
  start_anvil
fi

# --- Fund deployer + whales ETH (whales pay gas for token transfers) ---
log "Funding deployer and whale ETH on fork…"
cast rpc anvil_setBalance "$DEPLOYER" "$ETH_BALANCE" --rpc-url "$RPC" >/dev/null
cast rpc anvil_setBalance "$USDC_WHALE" "$ETH_BALANCE" --rpc-url "$RPC" >/dev/null
cast rpc anvil_setBalance "$USDT_WHALE" "$ETH_BALANCE" --rpc-url "$RPC" >/dev/null

# --- Deploy stack ---
log "Deploying Aqua Prime stack (forge script)…"
cd "$SWAP_VM"
if ! forge script script/DeployAquaPrimeStack.s.sol \
  --rpc-url "$RPC" \
  --unlocked \
  --sender "$DEPLOYER" \
  --broadcast \
  -vv; then
  log "Deploy failed. If you see 'historical state ... is not available', retry with:"
  log "  FRESH_FORK=1 MAINNET_RPC_URL=<archive RPC> bash scripts/dev-aqua-prime.sh"
  exit 1
fi

# --- Fund demo wallets (ETH + WETH/USDC from whales, after deploy) ---
log "Funding demo wallets for UI testing…"
bash "$ROOT/scripts/fund-demo-wallets.sh" || log "Demo wallet funding failed — continue anyway"

# --- Sync frontend ---
log "Syncing deployed addresses to scaffold…"
cd "$SCAFFOLD"
if [[ ! -d node_modules ]]; then
  log "Installing frontend dependencies (yarn)…"
  yarn install --frozen-lockfile 2>/dev/null || yarn install
fi
yarn sync-deployments

# --- Dev server: kill old process, wipe .next, start fresh ---
start_frontend
