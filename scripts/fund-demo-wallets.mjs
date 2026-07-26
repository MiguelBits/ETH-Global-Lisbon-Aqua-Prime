/**
 * Fund demo wallets on Anvil via JSON-RPC (no cast/curl — works on Windows).
 * Usage: node scripts/fund-demo-wallets.mjs
 */
import { readFileSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, "..")
const RPC = process.env.FORK_RPC_URL ?? "http://127.0.0.1:8545"
const CONFIG = process.env.DEMO_WALLETS_CONFIG ?? resolve(__dirname, "demo-wallets.json")

const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
const WETH_WHALE = "0x28C6c06298d514Db089934071355E5743bf21d60"
const USDC_WHALE = "0x40ec5B33f54e0E8A33A975908C5BA1c14e5BbbDf"
const ETH_TOPUP = "0x3635C9ADC5DEA00000"

const log = (...a) => console.log("[fund-demo-wallets]", ...a)

const rpc = async (method, params = []) => {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  })
  const json = await res.json()
  if (json.error) throw new Error(`${method}: ${json.error.message}`)
  return json.result
}

const padAddr = (a) => a.toLowerCase().replace(/^0x/, "").padStart(64, "0")
const padUint = (n) => BigInt(n).toString(16).padStart(64, "0")

const transferData = (to, amount) =>
  `0xa9059cbb${padAddr(to)}${padUint(amount)}`

const main = async () => {
  try {
    await rpc("eth_chainId")
  } catch {
    log(`No fork RPC at ${RPC} — skip`)
    process.exit(0)
  }

  let cfg
  try {
    cfg = JSON.parse(readFileSync(CONFIG, "utf8"))
  } catch {
    log(`No config at ${CONFIG} — skip`)
    process.exit(0)
  }

  const wallets = cfg.wallets ?? []
  if (!wallets.length) {
    log("No wallets in config — skip")
    process.exit(0)
  }

  const ethWei = cfg.ethWei ?? ETH_TOPUP
  const wethAmt = BigInt(Math.round((cfg.weth ?? 5) * 1e18))
  const usdcAmt = BigInt(Math.round((cfg.usdc ?? 50000) * 1e6))

  log(`Funding demo wallets on ${RPC}`)

  for (const wallet of wallets) {
    log(`→ ${wallet}`)
    await rpc("anvil_setBalance", [wallet, ethWei])
    await rpc("anvil_setBalance", [WETH_WHALE, ETH_TOPUP])
    await rpc("anvil_setBalance", [USDC_WHALE, ETH_TOPUP])
    await rpc("anvil_impersonateAccount", [WETH_WHALE])
    await rpc("anvil_impersonateAccount", [USDC_WHALE])

    try {
      await rpc("eth_sendTransaction", [
        { from: WETH_WHALE, to: WETH, data: transferData(wallet, wethAmt) },
      ])
    } catch (e) {
      log(`   warn: WETH transfer skipped (${e.message})`)
    }

    try {
      await rpc("eth_sendTransaction", [
        { from: USDC_WHALE, to: USDC, data: transferData(wallet, usdcAmt) },
      ])
    } catch (e) {
      log(`   warn: USDC transfer skipped (${e.message})`)
    }
  }

  log("Demo wallets ready")
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
