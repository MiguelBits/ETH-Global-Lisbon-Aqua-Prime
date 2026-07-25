/** Default Iron Man JARVIS soul — used when ENS records are missing. */

export const DEFAULT_AGENT_ENS = "jarvis.primedesk.eth";
export const DEFAULT_DESK_ENS = "maker.primedesk.eth";

export const DEFAULT_JARVIS_SOUL =
  'You are JARVIS, the desk agent for Prime Desk. Calm, collected, precise. Dry understated British wit only when it helps. Always address the principal as "sir" with no comma before it (say "Certainly sir", never "Certainly, sir"). Confirm intent briefly, state the action, never alarm. Prefer "I\'ve adjusted…" over hype. You manage inventory-heal parameters against the Uniswap reference; you do not invent settlement amounts.';

export const DEFAULT_ADDRESS_AS = "sir";
export const DEFAULT_VOICE = "calm,collected,deferential,sir,concise";
export const DEFAULT_ROLE = "prime-desk-settings-oracle";
export const DEFAULT_CAPABILITIES = "healK,maxAdjustment,healPremium,lambda";

export type JarvisDiscoverySource = "ens" | "ipfs" | "fallback";

export type JarvisSoul = {
  name: string;
  addressAs: string;
  soul: string;
  voice: string;
  role: string;
  endpoint: string;
  desk: string;
  model: string;
  capabilities: string;
  attestation: string | null;
  /** Raw ENS contenthash (e.g. ipfs://…) when set */
  contentHash: string | null;
  /** Decoded IPFS CID from contenthash or agent-endpoint[a2a] */
  ipfsCid: string | null;
  /** ENSIP-26 agent-context text */
  agentContext: string | null;
  /** ENSIP-26 agent-endpoint[a2a] (often ipfs://…) */
  endpointA2a: string | null;
  discoverySource: JarvisDiscoverySource;
};

export function defaultJarvisSoul(endpoint = "/api/jarvis/propose"): JarvisSoul {
  return {
    name: DEFAULT_AGENT_ENS,
    addressAs: DEFAULT_ADDRESS_AS,
    soul: DEFAULT_JARVIS_SOUL,
    voice: DEFAULT_VOICE,
    role: DEFAULT_ROLE,
    endpoint,
    desk: DEFAULT_DESK_ENS,
    model: "0g:router/default",
    capabilities: DEFAULT_CAPABILITIES,
    attestation: null,
    contentHash: null,
    ipfsCid: null,
    agentContext: null,
    endpointA2a: null,
    discoverySource: "fallback",
  };
}
