import { NextRequest, NextResponse } from "next/server"
import { runHealPathSimulation } from "~~/lib/jarvis/healSim"
import { narrateHealPathWithZeroG } from "~~/lib/jarvis/og"
import { defaultJarvisSoul } from "~~/lib/jarvis/soul"
import { resolveAgentEns } from "~~/lib/ens"
import type { BookState } from "~~/lib/primeSim"

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      balBase?: string
      balQuote?: string
      ethUsd1e18?: string
      principalEns?: string | null
    }

    const book: BookState = {
      balBase: BigInt(body.balBase ?? "0"),
      balQuote: BigInt(body.balQuote ?? "0"),
    }
    const ethUsd1e18 = BigInt(body.ethUsd1e18 ?? "3000000000000000000000")
    const sim = runHealPathSimulation({ book, ethUsd1e18 })
    const soul = await resolveAgentEns().catch(() => defaultJarvisSoul())

    const healPath = {
      usedScenarioBook: sim.usedScenarioBook,
      startSkew: sim.startSkew,
      endSkew: sim.endSkew,
      healthy: sim.healthy,
      steps: sim.steps.map(s => ({
        index: s.index,
        sellBase: s.sellBase,
        amountHuman: s.amountHuman,
        winnerLabel: s.winnerLabel,
        skewAfter: s.skewAfter,
        poolVsMarkBpsAfter: s.poolVsMarkBpsAfter,
      })),
    }

    const og = await narrateHealPathWithZeroG({
      soul,
      healPath,
      principalEns: body.principalEns ?? null,
    })

    const narrative = og.ok ? og.line : sim.narrative

    return NextResponse.json({
      mode: og.ok ? "0g" : "local",
      modelUsed: og.ok ? og.model : null,
      ogReason: og.ok ? null : og.reason,
      agentEns: soul.name,
      narrative,
      sim: {
        usedScenarioBook: sim.usedScenarioBook,
        startSkew: sim.startSkew,
        endSkew: sim.endSkew,
        startVsMarkBps: sim.startVsMarkBps,
        endVsMarkBps: sim.endVsMarkBps,
        healthy: sim.healthy,
        startBook: {
          balBase: sim.startBook.balBase.toString(),
          balQuote: sim.startBook.balQuote.toString(),
        },
        endBook: {
          balBase: sim.endBook.balBase.toString(),
          balQuote: sim.endBook.balQuote.toString(),
        },
        steps: sim.steps.map(s => ({
          index: s.index,
          sellBase: s.sellBase,
          amountHuman: s.amountHuman,
          amountInWei: s.amountInWei.toString(),
          amountOut: s.amountOut.toString(),
          winnerLabel: s.winnerLabel,
          skewBefore: s.skewBefore,
          skewAfter: s.skewAfter,
          poolVsMarkBpsBefore: s.poolVsMarkBpsBefore,
          poolVsMarkBpsAfter: s.poolVsMarkBpsAfter,
          midBefore: s.midBefore,
          midAfter: s.midAfter,
          params: {
            healK: s.params.healK.toString(),
            maxAdjustment: s.params.maxAdjustment.toString(),
            healPremium: s.params.healPremium.toString(),
            lambda: s.params.lambda.toString(),
            deadline: s.params.deadline.toString(),
            attestation: s.params.attestation,
          },
          balBaseAfter: s.balBaseAfter.toString(),
          balQuoteAfter: s.balQuoteAfter.toString(),
          label: s.label,
        })),
      },
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "heal-sim failed" },
      { status: 500 },
    )
  }
}
