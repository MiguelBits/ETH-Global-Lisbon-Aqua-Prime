import { NextRequest, NextResponse } from "next/server"
import { getLastAttestation } from "~~/lib/jarvis/attestationStore"
import { publishAttestationToEns } from "~~/lib/ensPublish"

export async function GET() {
  const last = getLastAttestation()
  return NextResponse.json({ last })
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      attestation?: `0x${string}`
      healK?: string
      lambda?: string
    }
    const result = await publishAttestationToEns(body)
    if (!result.ok) {
      return NextResponse.json(result, { status: 400 })
    }
    return NextResponse.json(result)
  } catch (e) {
    return NextResponse.json(
      { ok: false, reason: e instanceof Error ? e.message : "attest failed" },
      { status: 500 },
    )
  }
}
