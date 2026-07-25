/** In-memory last 0G attestation (server process). Client also mirrors to localStorage. */

export type AttestationRecord = {
  agentEns: string
  attestation: `0x${string}`
  model: string
  at: number
  publishedToEns?: boolean
}

let last: AttestationRecord | null = null

export function rememberAttestation(rec: AttestationRecord): void {
  last = rec
}

export function getLastAttestation(): AttestationRecord | null {
  return last
}
