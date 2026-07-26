import { NextRequest, NextResponse } from "next/server"
import { healHintFromSkew } from "~~/lib/jarvis/marketCtx"
import { adviseWithZeroG } from "~~/lib/jarvis/og"
import { defaultJarvisSoul } from "~~/lib/jarvis/soul"
import { fetchTapeIntel, roughXycOut } from "~~/lib/jarvis/tapeIntel"
import { stripCommaBeforeSir } from "~~/lib/jarvis/speech"
import { resolveAgentEns } from "~~/lib/ens"
import { usdSkewPct, type BookState } from "~~/lib/primeSim"

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
    const book: BookState = {
      balBase: BigInt(body.balBase ?? "0"),
      balQuote: BigInt(body.balQuote ?? "0"),
    }
    const ethUsd1e18 = BigInt(body.ethUsd1e18 ?? "3000000000000000000000")
    const skewPct = usdSkewPct(book, ethUsd1e18)
    const soul = await resolveAgentEns().catch(() => defaultJarvisSoul())

    const deskOut = roughXycOut(
      sellBase ? book.balBase : book.balQuote,
      sellBase ? book.balQuote : book.balBase,
      amountIn,
    )
    const tapeIntel = await fetchTapeIntel({
      amountIn: amountIn.toString(),
      sellBase,
      deskOut,
    })

    const uniOut = tapeIntel.classic?.amountOut ?? null
    const healHint = healHintFromSkew(skewPct, sellBase)

    const og = await adviseWithZeroG({
      soul,
      amountIn: amountIn.toString(),
      sellBase,
      skewPct,
      balBase: book.balBase.toString(),
      balQuote: book.balQuote.toString(),
      uniswapOut: uniOut,
      healHint,
      principalEns: body.principalEns ?? null,
    })

    const preferSellBase = skewPct > 3 ? true : skewPct < -3 ? false : null

    if (og.ok) {
      return NextResponse.json({
        mode: "0g",
        line: og.line,
        modelUsed: og.model,
        agentEns: soul.name,
        preferSellBase:
          typeof og.raw?.preferSellBase === "boolean" ? og.raw.preferSellBase : preferSellBase,
        uniswapAvailable: uniOut != null,
        uniswapOut: uniOut,
        uniswapReason: tapeIntel.available ? null : tapeIntel.reason ?? null,
        tapeIntel,
      })
    }

    const edge = tapeIntel.edgeDeskVsClassicBps
    const edgeLabel =
      edge == null ? "tape n/a" : `${edge >= 0 ? "+" : ""}${edge.toFixed(0)} bps vs CLASSIC`
    const line = stripCommaBeforeSir(
      `Certainly ${soul.addressAs}. ${sellBase ? "Sell WETH" : "Buy WETH"} · skew ${
        skewPct >= 0 ? "+" : ""
      }${skewPct.toFixed(1)}% · ${edgeLabel}. ${healHint} ${tapeIntel.summary}`,
    )

    return NextResponse.json({
      mode: "local",
      line,
      modelUsed: null,
      agentEns: soul.name,
      preferSellBase,
      ogReason: og.reason,
      uniswapAvailable: uniOut != null,
      uniswapOut: uniOut,
      uniswapReason: tapeIntel.available ? null : tapeIntel.reason ?? null,
      tapeIntel,
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "advise failed" },
      { status: 500 },
    )
  }
}
