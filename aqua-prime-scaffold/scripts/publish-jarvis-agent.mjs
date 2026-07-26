#!/usr/bin/env node
/**
 * Pin public/agent/ to Pinata and print ENS record suggestions.
 * Requires PINATA_JWT in env (or aqua-prime-scaffold/.env.local).
 *
 * Usage: yarn publish:agent
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs"
import { join, relative, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, "..")
const agentDir = join(root, "public", "agent")

const loadEnvLocal = () => {
  const p = join(root, ".env.local")
  if (!existsSync(p)) return
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const t = line.trim()
    if (!t || t.startsWith("#")) continue
    const i = t.indexOf("=")
    if (i < 0) continue
    const k = t.slice(0, i).trim()
    let v = t.slice(i + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1)
    }
    if (!process.env[k]) process.env[k] = v
  }
}

loadEnvLocal()

const jwt = process.env.PINATA_JWT
if (!jwt) {
  console.error("PINATA_JWT not set. Add it to .env.local or the environment.")
  process.exit(1)
}

const walk = (dir) => {
  const out = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else out.push(full)
  }
  return out
}

const files = walk(agentDir)
if (files.length === 0) {
  console.error(`No files under ${agentDir}`)
  process.exit(1)
}

const form = new FormData()
for (const full of files) {
  const rel = relative(agentDir, full).replace(/\\/g, "/")
  const buf = readFileSync(full)
  const blob = new Blob([buf])
  form.append("file", blob, `agent/${rel}`)
}

form.append(
  "pinataMetadata",
  JSON.stringify({ name: "jarvis.primedesk.eth-agent" }),
)
form.append(
  "pinataOptions",
  JSON.stringify({ cidVersion: 1, wrapWithDirectory: true }),
)

const res = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
  method: "POST",
  headers: { Authorization: `Bearer ${jwt}` },
  body: form,
})

const body = await res.json().catch(() => ({}))
if (!res.ok) {
  console.error("Pinata upload failed:", res.status, body)
  process.exit(1)
}

const cid = body.IpfsHash
if (!cid) {
  console.error("Pinata response missing IpfsHash:", body)
  process.exit(1)
}

const agentEns = process.env.NEXT_PUBLIC_JARVIS_ENS || "jarvis.primedesk.eth"
const proposeUrl =
  process.env.JARVIS_PUBLIC_PROPOSE_URL || "https://YOUR_HOST/api/jarvis/propose"
const gateway = (process.env.NEXT_PUBLIC_IPFS_GATEWAY || "https://ipfs.io/ipfs").replace(/\/$/, "")

console.log("")
console.log("Pinned Jarvis agent site")
console.log(`  CID:        ${cid}`)
console.log(`  Gateway:    ${gateway}/${cid}/`)
console.log(`  Card:       ${gateway}/${cid}/agent/agent-card.json`)
console.log(`  (or if Pinata flattened root): ${gateway}/${cid}/agent-card.json`)
console.log("")
console.log(`Suggested ENS writes on ${agentEns}:`)
console.log(`  contenthash              → ipfs://${cid}`)
console.log(`  agent-context            → Jarvis desk agent for Prime Desk (Aqua + SwapVM heal knobs)`)
console.log(`  agent-endpoint[web]      → ${proposeUrl}`)
console.log(`  agent-endpoint[a2a]      → ipfs://${cid}/agent/agent-card.json`)
console.log("")
console.log("Then demo: resolve name → open gateway URL → Consult Jarvis.")
