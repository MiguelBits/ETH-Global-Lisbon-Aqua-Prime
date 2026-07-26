import { NextRequest, NextResponse } from "next/server"
import { pinJarvisAgentToPinata } from "~~/lib/pinataAgent"

/**
 * Optional: pin Jarvis agent card / public/agent site to Pinata.
 * Does not write ENS records — operator sets contenthash / agent-endpoint after.
 */
export async function POST(req: NextRequest) {
  try {
    let proposeUrl: string | undefined
    try {
      const body = (await req.json()) as { proposeUrl?: string }
      proposeUrl = body.proposeUrl
    } catch {
      // empty body OK
    }

    const result = await pinJarvisAgentToPinata({ proposeUrl })
    if (!result.ok) {
      return NextResponse.json(result, { status: 400 })
    }
    return NextResponse.json(result)
  } catch (e) {
    return NextResponse.json(
      { ok: false, reason: e instanceof Error ? e.message : "publish-agent failed" },
      { status: 500 },
    )
  }
}
