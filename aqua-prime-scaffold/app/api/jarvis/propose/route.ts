import { NextRequest, NextResponse } from "next/server"
import { proposeLocal } from "~~/lib/jarvis/fallback"
import { buildProposeMarketCtx } from "~~/lib/jarvis/marketCtx"
import { proposeWithZeroG } from "~~/lib/jarvis/og"
import { serializeProposal, type JarvisProposal } from "~~/lib/jarvis/schema"
import { defaultJarvisSoul } from "~~/lib/jarvis/soul"
import { fetchTapeIntel, roughXycOut } from "~~/lib/jarvis/tapeIntel"
import { rememberAttestation } from "~~/lib/jarvis/attestationStore"
import { resolveAgentEns } from "~~/lib/ens"
import { simulateDeployedDesk } from "~~/lib/parityCheck"
import type { BookState } from "~~/lib/primeSim"

/**
 * Jarvis propose: Uniswap tape intel (CLASSIC + BEST_PRICE) → knobs for on-screen ticket.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      amountIn?: string
      sellBase?: boolean
      balBase?: string
      balQuote?: string
      ethUsd1e18?: string
      principalEns?: string | null
    }

    const amountIn = BigInt(body.amountIn ?? "0")
    const sellBase = body.sellBase !== false
    const balBase = BigInt(body.balBase ?? "0")
    const balQuote = BigInt(body.balQuote ?? "0")
    const ethUsd1e18 = BigInt(body.ethUsd1e18 ?? "3000000000000000000000")
    const principalEns = body.principalEns ?? null

    const soul = await resolveAgentEns().catch(() => defaultJarvisSoul())
    const book: BookState = { balBase, balQuote }

    const sim =
      amountIn > 0n ? simulateDeployedDesk(book, ethUsd1e18, amountIn, sellBase) : null
    const deskOut =
      sim?.primeOut && sim.primeOut > 0n
        ? sim.primeOut
        : roughXycOut(
            sellBase ? balBase : balQuote,
            sellBase ? balQuote : balBase,
            amountIn,
          )

    const tapeIntel = await fetchTapeIntel({
      amountIn: amountIn.toString(),
      sellBase,
      deskOut,
    })

    const uniswapOut =
      tapeIntel.classic?.amountOut != null ? BigInt(tapeIntel.classic.amountOut) : null

    const market = buildProposeMarketCtx({
      amountIn,
      sellBase,
      book,
      ethUsd1e18,
      uniswapOut,
      addressAs: soul.addressAs,
      principalEns,
      tapeIntel,
    })

    const local = proposeLocal({
      book,
      ethUsd1e18,
      sellBase,
      amountIn,
      uniswapOut,
      addressAs: soul.addressAs,
      tape: tapeIntel,
    })

    const og = await proposeWithZeroG({
      soul,
      market,
      edgeVsUniBps: local.edgeVsUniBps,
      critiqueBelowBps: -8,
    })

    let proposal: JarvisProposal
    if (og.ok) {
      proposal = {
        params: og.params,
        line: og.line,
        mode: "0g",
        uniswapOut: uniswapOut?.toString() ?? null,
        uniswapAvailable: uniswapOut != null,
        agentEns: soul.name,
        edgeVsUniBps: local.edgeVsUniBps,
        modelUsed: og.model,
        critiqued: og.critiqued,
        tapeIntel,
      }
      rememberAttestation({
        agentEns: soul.name,
        attestation: og.attestation,
        model: og.model,
        at: Date.now(),
      })
    } else {
      proposal = {
        params: local.params,
        line: local.line,
        mode: "local",
        uniswapOut: uniswapOut?.toString() ?? null,
        uniswapAvailable: uniswapOut != null,
        agentEns: soul.name,
        edgeVsUniBps: local.edgeVsUniBps,
        modelUsed: null,
        critiqued: false,
        tapeIntel,
      }
    }

    return NextResponse.json({
      ...serializeProposal(proposal),
      ogReason: og.ok ? null : og.reason,
      deskEns: soul.desk,
      agentRole: soul.role,
      agentModel: soul.model,
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "propose failed" },
      { status: 500 },
    )
  }
}
