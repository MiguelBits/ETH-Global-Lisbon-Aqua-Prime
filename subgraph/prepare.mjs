#!/usr/bin/env node
/**
 * Injects the deployed gateway address + start block into subgraph.yaml from the
 * Sepolia deploy manifest (reference/swap-vm/deployments/aqua-prime-sepolia.json).
 *
 * Idempotent: replaces {{GATEWAY_ADDRESS}}/{{START_BLOCK}} placeholders on first run,
 * and re-targets an already-filled subgraph.yaml on subsequent runs.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const manifestPath = path.resolve(__dirname, "../reference/swap-vm/deployments/aqua-prime-sepolia.json");
const yamlPath = path.resolve(__dirname, "subgraph.yaml");

if (!fs.existsSync(manifestPath)) {
  console.error(`Manifest not found: ${manifestPath}`);
  console.error("Run DeployAquaPrimeSepolia first.");
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const gateway = manifest.gateway;
const startBlock = manifest.blockNumber ?? 0;
if (!gateway) {
  console.error("Manifest missing gateway address.");
  process.exit(1);
}

let yaml = fs.readFileSync(yamlPath, "utf8");
yaml = yaml
  .replace(/address:\s*"(\{\{GATEWAY_ADDRESS\}\}|0x[0-9a-fA-F]{40})"/, `address: "${gateway}"`)
  .replace(/startBlock:\s*(\{\{START_BLOCK\}\}|\d+)/, `startBlock: ${startBlock}`);

fs.writeFileSync(yamlPath, yaml);
console.log(`subgraph.yaml → gateway ${gateway}, startBlock ${startBlock}`);
