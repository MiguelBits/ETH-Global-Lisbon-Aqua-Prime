"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react"
import toast from "react-hot-toast"
import { useAccount, usePublicClient, useReadContract, useWriteContract } from "wagmi"
import { AquaActionChip } from "~~/components/AquaActionChip"
import { AquaAdviseStream, type AdvisePhase, type AdviseVerdict } from "~~/components/AquaAdviseStream"
import { AquaCalcStream, type CalcPhase } from "~~/components/AquaCalcStream"
import { AquaTapeIntel } from "~~/components/AquaTapeIntel"
import { AquaDemoStepper } from "~~/components/AquaDemoStepper"
import { AquaGlossText } from "~~/components/AquaGlossText"
import { AquaHealSimPanel } from "~~/components/AquaHealSimPanel"
import { AquaIdentityStrip } from "~~/components/AquaIdentityStrip"
import { AquaPoolPanel, type AquaBalances } from "~~/components/AquaPoolPanel"
import { AquaRiskCard } from "~~/components/AquaRiskCard"
import { AquaRoutePanel } from "~~/components/AquaRoutePanel"
import { AquaSorPanel } from "~~/components/AquaSorPanel"
import { AquaStatusBanner } from "~~/components/AquaStatusBanner"
import { AquaTalkingHead } from "~~/components/AquaTalkingHead"
import { AquaTradeTicket, amountWei } from "~~/components/AquaTradeTicket"
import deployedContracts from "~~/contracts/deployedContracts"
import { primeDeskManifest } from "~~/contracts/manifestMeta"
import {
  AFTER_PROPOSE_CHIP_ID,
  visibleAquaActions,
  type AquaAction,
} from "~~/lib/jarvis/aquaActions"
import {
  DEMO_BOOK,
  DEMO_ETH_USD_1E18,
  fetchAquaProposal,
  runAquaBrain,
  type AquaBookSnapshot,
} from "~~/lib/jarvis/aquaBrain"
import { AQUA_GREETING, AQUA_WAKE_PHRASE } from "~~/lib/jarvis/aquaSoul"
import { commitDeskAndSwap, commitMakerGate, formatCommitError } from "~~/lib/jarvis/commitDeskAndSwap"
import { nextChipForStep, resolveDemoStep } from "~~/lib/jarvis/demoFlow"
import { HIDDEN_PANELS, hudLayoutClass, panelsForKind, type AquaHudPanels } from "~~/lib/jarvis/aquaPanels"
import { useAquaRoutes } from "~~/lib/jarvis/useAquaRoutes"
import type { HealSimResult } from "~~/lib/jarvis/healSim"
import type { MakerSorPick } from "~~/lib/jarvis/makerSor"
import type { JarvisProposal } from "~~/lib/jarvis/schema"
import { defaultAgentName, resolveAgentEns, resolvePrincipalEns } from "~~/lib/ens"
import { useQuery } from "@tanstack/react-query"
import {
  containsWakePhrase,
  createRecognition,
  forSpeech,
  speak,
  speechSupported,
  tokenizeSpeech,
  wordIndexAt,
} from "~~/lib/jarvis/speech"
import scaffoldConfig from "~~/scaffold.config"

type Phase = "asleep" | "waking" | "awake" | "listening" | "thinking" | "speaking"

type Turn = {
  id: string
  role: "aqua" | "you" | "system"
  text: string
}

const CHAIN_ID = scaffoldConfig.targetNetworks[0].id
const contracts = deployedContracts[CHAIN_ID as keyof typeof deployedContracts] ?? deployedContracts[31337]

const makeId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

export const AquaVoiceConsole = () => {
  const { address, isConnected } = useAccount()
  const publicClient = usePublicClient()
  const { writeContractAsync, isPending } = useWriteContract()

  const [phase, setPhase] = useState<Phase>("asleep")
  const [awake, setAwake] = useState(false)
  const [turns, setTurns] = useState<Turn[]>([])
  const [draft, setDraft] = useState("")
  const [supported, setSupported] = useState(true)
  const [interim, setInterim] = useState("")
  const [balances, setBalances] = useState<AquaBalances>({
    balBase: DEMO_BOOK.balBase,
    balQuote: DEMO_BOOK.balQuote,
    ethUsd1e18: DEMO_ETH_USD_1E18,
    source: "demo",
  })
  const [amountIn, setAmountIn] = useState("1")
  const [sellBase, setSellBase] = useState(true)
  const [proposal, setProposal] = useState<JarvisProposal | null>(null)
  const [healSim, setHealSim] = useState<HealSimResult | null>(null)
  const [healClipIdx, setHealClipIdx] = useState(0)
  const [healArming, setHealArming] = useState(false)
  const [healAnimDone, setHealAnimDone] = useState(false)
  const [sorPick, setSorPick] = useState<MakerSorPick | null>(null)
  const [calcPhase, setCalcPhase] = useState<CalcPhase>("idle")
  const [advisePhase, setAdvisePhase] = useState<AdvisePhase>("idle")
  const [adviseVerdict, setAdviseVerdict] = useState<AdviseVerdict | null>(null)
  const [pulseChip, setPulseChip] = useState<string | null>(null)
  const [execBusy, setExecBusy] = useState(false)
  const [execNote, setExecNote] = useState<string | null>(null)
  const [panels, setPanels] = useState<AquaHudPanels>(HIDDEN_PANELS)
  const [holoTick, setHoloTick] = useState(0)
  const [speechWords, setSpeechWords] = useState<string[]>([])
  const [speechActive, setSpeechActive] = useState(-1)
  const [sawBook, setSawBook] = useState(false)
  const [settledOnce, setSettledOnce] = useState(false)
  const [riskOpen, setRiskOpen] = useState(false)
  const [outcome, setOutcome] = useState<"success" | "fail" | null>(null)
  const [latestLine, setLatestLine] = useState<string | null>(null)
  const [wingsOpen, setWingsOpen] = useState(false)
  const speechStartsRef = useRef<number[]>([])

  const recRef = useRef<SpeechRecognition | null>(null)
  const awakeRef = useRef(false)
  const busyRef = useRef(false)
  const listeningRef = useRef(false)
  const bookRef = useRef<AquaBookSnapshot | null>(null)
  const proposalRef = useRef(proposal)
  const bottomRef = useRef<HTMLDivElement>(null)
  const handleUserUtteranceRef = useRef<(raw: string) => Promise<void>>(async () => {})

  const amountInWei = useMemo(() => amountWei(amountIn, sellBase), [amountIn, sellBase])

  const agentName = defaultAgentName()
  const { data: agentSoul } = useQuery({
    queryKey: ["aquaVoiceSoul", agentName],
    queryFn: () => resolveAgentEns(agentName),
    staleTime: 120_000,
    enabled: awake,
  })
  const { data: principalEns } = useQuery({
    queryKey: ["aquaVoicePrincipal", address],
    queryFn: () => resolvePrincipalEns(address),
    staleTime: 60_000,
    enabled: awake && !!address,
  })
  const voiceTags = agentSoul?.voice
  const principalEnsRef = useRef<string | null>(null)
  useEffect(() => {
    principalEnsRef.current = principalEns ?? null
  }, [principalEns])

  const book = useMemo<AquaBookSnapshot>(
    () => ({
      ...balances,
      amountIn: amountInWei,
      sellBase,
    }),
    [balances, amountInWei, sellBase],
  )

  useEffect(() => {
    bookRef.current = book
  }, [book])

  useEffect(() => {
    proposalRef.current = proposal
  }, [proposal])

  const gateway = contracts.AquaPrimeSwapGateway.address
  const weth = contracts.WETH.address
  const usdc = contracts.USDC.address
  const tokenIn = sellBase ? weth : usdc

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: tokenIn,
    abi: contracts.USDC.abi,
    functionName: "allowance",
    args: address ? [address, gateway] : undefined,
    query: { enabled: !!address && primeDeskManifest.deployed },
  })

  const { data: tokenBal } = useReadContract({
    address: tokenIn,
    abi: contracts.WETH.abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  })

  const needsApproval =
    typeof allowance === "bigint" && amountInWei > 0n && allowance < amountInWei

  const insufficient =
    isConnected &&
    amountInWei > 0n &&
    typeof tokenBal === "bigint" &&
    tokenBal < amountInWei

  const makerGate = address ? commitMakerGate(address) : "Connect wallet to Execute."
  const executeDisabledReason = !proposal
    ? null
    : !isConnected
      ? "Connect the maker wallet."
      : makerGate
        ? makerGate
        : amountInWei === 0n
          ? "Enter an amount."
          : insufficient
            ? `Insufficient ${sellBase ? "WETH" : "USDC"}.`
            : !publicClient
              ? "RPC not ready."
              : null

  const canExecute = !!proposal && !executeDisabledReason && !execBusy && !isPending

  const {
    rows: routeRows,
    livePrimeOut,
    isLoading: routesLoading,
  } = useAquaRoutes({
    balBase: balances.balBase,
    balQuote: balances.balQuote,
    ethUsd1e18: balances.ethUsd1e18,
    amountInWei,
    sellBase,
    proposal,
    enabled: panels.routes || !!proposal,
  })

  const handleBalances = useCallback((next: AquaBalances) => {
    setBalances(next)
  }, [])

  const push = useCallback((role: Turn["role"], text: string) => {
    setTurns(t => [...t, { id: makeId(), role, text }])
  }, [])

  const aquaSpeak = useCallback(
    async (text: string) => {
      // HUD + TTS stay short; panels/toasts keep the long technical detail.
      const line = forSpeech(text)
      const { words, starts } = tokenizeSpeech(line)
      speechStartsRef.current = starts
      setSpeechWords(words)
      setSpeechActive(-1)
      setLatestLine(line)
      setPhase("speaking")
      push("aqua", line)
      try {
        await speak(line, {
          voiceTags: voiceTags ? `${voiceTags},concise` : "concise",
          onStart: () => setSpeechActive(0),
          onBoundary: b => {
            if (b.name && b.name !== "word") return
            setSpeechActive(wordIndexAt(b.charIndex, speechStartsRef.current))
          },
        })
      } finally {
        setSpeechActive(words.length > 0 ? words.length - 1 : -1)
        await new Promise(r => setTimeout(r, 80))
        setSpeechWords([])
        setSpeechActive(-1)
        setPhase(awakeRef.current ? "awake" : "asleep")
      }
    },
    [push, voiceTags],
  )

  const pulseNext = useCallback((chipId: string | null, ms = 4800) => {
    setPulseChip(chipId)
    if (chipId) window.setTimeout(() => setPulseChip(cur => (cur === chipId ? null : cur)), ms)
  }, [])

  const beatOutcome = useCallback((kind: "success" | "fail") => {
    setOutcome(kind)
    window.setTimeout(() => setOutcome(null), 1600)
  }, [])

  const clearArmed = useCallback(() => {
    setProposal(null)
    setCalcPhase("idle")
    setExecNote(null)
  }, [])

  const handleAmountIn = useCallback(
    (v: string) => {
      setAmountIn(v)
      clearArmed()
    },
    [clearArmed],
  )

  const handleSellBase = useCallback(
    (v: boolean) => {
      setSellBase(v)
      setAmountIn(v ? "1" : "1000")
      clearArmed()
    },
    [clearArmed],
  )

  const handleUserUtterance = useCallback(
    async (raw: string) => {
      const text = raw.trim()
      if (!text || busyRef.current) return

      if (!awakeRef.current) {
        if (containsWakePhrase(text, AQUA_WAKE_PHRASE)) {
          busyRef.current = true
          awakeRef.current = true
          setAwake(true)
          setPhase("waking")
          setCalcPhase("idle")
          setAdvisePhase("idle")
          setAdviseVerdict(null)
          setHealSim(null)
          setSorPick(null)
          setPanels(HIDDEN_PANELS)
          setSawBook(false)
          setSettledOnce(false)
          setRiskOpen(false)
          setOutcome(null)
          // Wake beat: chassis online → greeting → pulse next chip
          await new Promise(r => setTimeout(r, 1100))
          await aquaSpeak(AQUA_GREETING)
          busyRef.current = false
          setPhase("awake")
          pulseNext(nextChipForStep("book") ?? "read-book")
        }
        return
      }

      if (containsWakePhrase(text, AQUA_WAKE_PHRASE)) {
        await aquaSpeak("Already online sir.")
        return
      }

      busyRef.current = true
      push("you", text)
      setPhase("thinking")

      const snap = bookRef.current
      if (!snap) {
        busyRef.current = false
        return
      }

      const proposeStartedAt = { t: 0 }
      const adviseStartedAt = { t: 0 }
      const result = await runAquaBrain(text, {
        book: snap,
        lastProposal: proposalRef.current,
        principalEns: principalEnsRef.current,
        onProposeStart: () => {
          proposeStartedAt.t = Date.now()
          setAdvisePhase("idle")
          // Open calc immediately so scramble runs during the API wait.
          setCalcPhase("running")
          setPanels(prev => ({
            ...prev,
            pool: true,
            ticket: true,
            calc: true,
            advise: false,
            healSim: false,
            sor: false,
          }))
        },
        onProposeResult: p => {
          if (p) {
            setProposal(p)
            setExecNote("Best settings armed — press Execute.")
            pulseNext(AFTER_PROPOSE_CHIP_ID, 5200)
            // Keep scrambling at least ~900ms so the number animation is visible.
            const wait = Math.max(0, 900 - (Date.now() - proposeStartedAt.t))
            window.setTimeout(() => setCalcPhase("settled"), wait)
          } else {
            setCalcPhase("idle")
          }
        },
        onHealSim: sim => {
          setAdvisePhase("idle")
          setCalcPhase("idle")
          setHealClipIdx(0)
          setHealAnimDone(false)
          setSorPick(null)
          setHealSim(sim)
        },
        onAdviseStart: () => {
          adviseStartedAt.t = Date.now()
          setCalcPhase("idle")
          setAdviseVerdict(null)
          setAdvisePhase("scanning")
          setPanels(prev => ({
            ...prev,
            pool: true,
            ticket: true,
            advise: true,
            calc: false,
            healSim: false,
            sor: false,
          }))
        },
        onAdviseResult: v => {
          if (v) {
            setAdviseVerdict(v)
            const wait = Math.max(0, 900 - (Date.now() - adviseStartedAt.t))
            window.setTimeout(() => setAdvisePhase("settled"), wait)
          } else {
            setAdvisePhase("idle")
          }
        },
        onSorPick: pick => {
          setAdvisePhase("idle")
          setHealSim(null)
          setSorPick(pick)
          setSellBase(pick.sellBase)
          setAmountIn(pick.amountHuman)
        },
        onBestAction: action => {
          setAdvisePhase("idle")
          setHealSim(null)
          setSorPick(null)
          setSellBase(action.sellBase)
          setAmountIn(action.amountHuman)
        },
      })

      if (result.proposal) setProposal(result.proposal)
      if (result.healSim) setHealSim(result.healSim)
      if (result.advise) setAdviseVerdict(result.advise)
      if (result.sorPick) setSorPick(result.sorPick)
      if (result.bestAction) {
        setSellBase(result.bestAction.sellBase)
        setAmountIn(result.bestAction.amountHuman)
      }

      if (result.kind === "book") {
        setSawBook(true)
        pulseNext(nextChipForStep("tune") ?? "tune-desk")
      }

      const hasProposal = !!(result.proposal ?? proposalRef.current)
      if (result.kind !== "identity" && result.kind !== "generic") {
        const next = panelsForKind(result.kind, hasProposal)
        setPanels(next)
        setHoloTick(t => t + 1)
        // Propose settle is scheduled in onProposeResult (keeps scramble running).
        if (result.kind !== "propose" && next.calc && hasProposal) {
          setCalcPhase(prev => (prev === "running" ? prev : "settled"))
        }
        if (result.kind === "advise" && result.advise) {
          const wait = Math.max(0, 900 - (Date.now() - adviseStartedAt.t))
          window.setTimeout(() => setAdvisePhase("settled"), wait)
          if (!hasProposal) pulseNext("tune-desk")
        }
        if (result.kind === "propose" && hasProposal) {
          setSawBook(true)
        }
        if (result.kind === "simulate") {
          setSawBook(true)
        }
        if (result.kind === "route" || result.kind === "optimize" || result.kind === "action") {
          setSawBook(true)
          setWingsOpen(true)
        }
      }

      // After Best route / Best size / Best action: arm Best settings so Execute is one click away.
      const armTicket =
        (result.sorPick && (result.kind === "route" || result.kind === "optimize")
          ? {
              sellBase: result.sorPick.sellBase,
              amountIn: result.sorPick.amountIn,
              label: result.kind === "optimize" ? "Best size" : "Best route",
              liveWinner: result.sorPick.liveWinner,
            }
          : null) ??
        (result.bestAction && result.kind === "action"
          ? {
              sellBase: result.bestAction.sellBase,
              amountIn: result.bestAction.amountInWei,
              label: "Best action",
              liveWinner: "HEAL",
            }
          : null)

      if (armTicket) {
        const snap = bookRef.current
        if (snap) {
          setCalcPhase("running")
          setPanels(prev => ({
            ...prev,
            pool: true,
            ticket: true,
            calc: true,
            routes: true,
            sor: result.kind !== "action",
            execute: true,
            healSim: false,
            advise: false,
          }))
          try {
            const proposal = await fetchAquaProposal(
              {
                ...snap,
                sellBase: armTicket.sellBase,
                amountIn: armTicket.amountIn,
              },
              principalEnsRef.current,
            )
            setProposal(proposal)
            proposalRef.current = proposal
            setCalcPhase("settled")
            setExecNote(`${armTicket.label} armed (${armTicket.liveWinner}) — press Execute.`)
            pulseNext(AFTER_PROPOSE_CHIP_ID, 5200)
          } catch {
            setCalcPhase("idle")
            setExecNote(`${armTicket.label} set — press Best settings to arm Execute.`)
            pulseNext("tune-desk", 4200)
          }
        }
      }

      if (result.kind === "sleep") {
        awakeRef.current = false
        setAwake(false)
        setCalcPhase("idle")
        setAdvisePhase("idle")
        setAdviseVerdict(null)
        setHealSim(null)
        setSorPick(null)
        setPanels(HIDDEN_PANELS)
        setPulseChip(null)
        setRiskOpen(false)
        setWingsOpen(false)
        await aquaSpeak(result.reply)
        setPhase("asleep")
      } else {
        await aquaSpeak(result.reply)
        setPhase("awake")
      }
      busyRef.current = false
    },
    [aquaSpeak, push, pulseNext],
  )

  useEffect(() => {
    handleUserUtteranceRef.current = handleUserUtterance
  }, [handleUserUtterance])

  useEffect(() => {
    setSupported(speechSupported())
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [turns, interim])

  useEffect(() => {
    if (!supported) return
    const rec = createRecognition()
    if (!rec) {
      setSupported(false)
      return
    }
    recRef.current = rec

    rec.onresult = (ev: SpeechRecognitionEvent) => {
      let interimBuf = ""
      let finalBuf = ""
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const piece = ev.results[i][0]?.transcript ?? ""
        if (ev.results[i].isFinal) finalBuf += piece
        else interimBuf += piece
      }
      setInterim(interimBuf)
      if (finalBuf.trim()) {
        setInterim("")
        listeningRef.current = false
        void handleUserUtteranceRef.current(finalBuf)
      }
    }

    rec.onerror = () => {
      listeningRef.current = false
      setInterim("")
      setPhase(awakeRef.current ? "awake" : "asleep")
    }

    rec.onend = () => {
      listeningRef.current = false
      setInterim("")
      if (!busyRef.current) {
        setPhase(awakeRef.current ? "awake" : "asleep")
      }
    }

    const bootLine = "Wake → Read the book → Best settings → Execute."
    setTurns(prev => (prev.some(t => t.role === "system" && t.text === bootLine) ? prev : [...prev, { id: makeId(), role: "system", text: bootLine }]))

    return () => {
      rec.onend = null
      rec.onresult = null
      rec.onerror = null
      listeningRef.current = false
      try {
        rec.stop()
      } catch {
        /* ignore */
      }
    }
  }, [supported])

  const stopListening = useCallback(() => {
    const rec = recRef.current
    if (!rec || !listeningRef.current) return
    listeningRef.current = false
    try {
      rec.stop()
    } catch {
      /* ignore */
    }
    setInterim("")
    if (!busyRef.current) {
      setPhase(awakeRef.current ? "awake" : "asleep")
    }
  }, [])

  const startListening = useCallback(() => {
    if (!supported || busyRef.current || listeningRef.current) return
    // Stop any lingering TTS so Chrome mic + synth don't clash.
    try {
      window.speechSynthesis?.cancel()
    } catch {
      /* ignore */
    }
    let rec = recRef.current
    if (!rec) {
      rec = createRecognition()
      if (!rec) {
        setSupported(false)
        return
      }
      recRef.current = rec
    }
    setInterim("")
    listeningRef.current = true
    setPhase("listening")
    try {
      rec.start()
    } catch {
      // Instance may be in a bad state — rebuild once.
      try {
        const fresh = createRecognition()
        if (!fresh) throw new Error("no recognition")
        recRef.current = fresh
        fresh.onresult = rec.onresult
        fresh.onerror = rec.onerror
        fresh.onend = rec.onend
        fresh.start()
      } catch {
        listeningRef.current = false
        setPhase(awakeRef.current ? "awake" : "asleep")
      }
    }
  }, [supported])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const text = draft.trim()
    if (!text) return
    setDraft("")
    await handleUserUtterance(text)
  }

  const handleChip = (action: AquaAction) => {
    if (action.href) return
    // Execute chip opens risk confirm (or explains the wallet gate).
    if (action.id === "execute") {
      void requestExecute()
      return
    }
    void handleUserUtterance(action.utterance)
  }

  const armHealClip = useCallback(
    async (sim: HealSimResult, clipIndex: number) => {
      const step = sim.steps[clipIndex]
      const snap = bookRef.current
      if (!step || !snap) return

      const balBase =
        clipIndex === 0 ? sim.startBook.balBase : sim.steps[clipIndex - 1]!.balBaseAfter
      const balQuote =
        clipIndex === 0 ? sim.startBook.balQuote : sim.steps[clipIndex - 1]!.balQuoteAfter

      setHealArming(true)
      setHealClipIdx(clipIndex)
      setSellBase(step.sellBase)
      setAmountIn(step.amountHuman)
      setCalcPhase("running")
      // Hand off to ticket + Best settings calc; keep heal path in state for the next clip.
      setPanels(prev => ({
        ...prev,
        pool: true,
        healSim: false,
        sor: false,
        ticket: true,
        calc: true,
        execute: true,
        routes: true,
        advise: false,
      }))

      try {
        const proposal = await fetchAquaProposal(
          {
            ...snap,
            balBase,
            balQuote,
            sellBase: step.sellBase,
            amountIn: step.amountInWei,
          },
          principalEnsRef.current,
        )
        setProposal(proposal)
        proposalRef.current = proposal
        setCalcPhase("settled")
        setExecNote(
          `Heal clip ${clipIndex + 1}/${sim.steps.length} armed — Execute runs MetaMask dock → ship → swap.`,
        )
        pulseNext(AFTER_PROPOSE_CHIP_ID, 5200)
        await aquaSpeak(
          `Clip ${clipIndex + 1} of ${sim.steps.length} armed sir. Press Execute.`,
        )
      } catch {
        setCalcPhase("idle")
        setPanels(prev => ({ ...prev, healSim: true, calc: false }))
        setExecNote("Could not arm Best settings for this heal clip.")
        await aquaSpeak("Could not arm that clip sir.")
      } finally {
        setHealArming(false)
        setPhase("awake")
      }
    },
    [aquaSpeak, pulseNext],
  )

  const handleHealSimComplete = useCallback(
    (sim: HealSimResult) => {
      setHealAnimDone(true)
      if (sim.steps.length === 0) return
      // Auto-arm first MetaMask clip after the reactor finishes.
      void armHealClip(sim, 0)
    },
    [armHealClip],
  )

  const waitForTx = useCallback(
    async (hash: `0x${string}`, label: string) => {
      if (!publicClient) throw new Error("RPC client not ready")
      toast.loading(`${label}…`, { id: "tx" })
      const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 })
      if (receipt.status === "reverted") throw new Error("Transaction reverted")
      toast.success(`${label} confirmed`, { id: "tx" })
      await refetchAllowance()
    },
    [publicClient, refetchAllowance],
  )

  const requestExecute = async () => {
    if (!proposal || execBusy || isPending) return
    if (executeDisabledReason || !address || !publicClient) {
      const msg = executeDisabledReason ?? "Wallet or RPC not ready."
      setExecNote(msg)
      toast.error(msg, { id: "tx" })
      beatOutcome("fail")
      await aquaSpeak(msg)
      return
    }
    setRiskOpen(true)
  }

  const onExecute = async () => {
    if (!proposal || execBusy || isPending) return
    if (executeDisabledReason || !address || !publicClient) {
      const msg = executeDisabledReason ?? "Wallet or RPC not ready."
      setExecNote(msg)
      toast.error(msg, { id: "tx" })
      beatOutcome("fail")
      await aquaSpeak(msg)
      return
    }
    setRiskOpen(false)
    setExecBusy(true)
    busyRef.current = true
    try {
      await commitDeskAndSwap({
        address,
        publicClient,
        writeContractAsync: writeContractAsync as (req: Record<string, unknown>) => Promise<`0x${string}`>,
        waitForTx,
        proposal,
        amountInWei,
        sellBase,
        needsApproval,
        onStatus: setExecNote,
      })

      const nextClip = healClipIdx + 1
      if (healSim && nextClip < healSim.steps.length) {
        beatOutcome("success")
        await aquaSpeak(
          `Clip ${healClipIdx + 1} settled. Next clip armed.`,
        )
        setProposal(null)
        await armHealClip(healSim, nextClip)
      } else {
        setSettledOnce(true)
        beatOutcome("success")
        await aquaSpeak(
          healSim ? "Heal path complete sir." : "Trade settled sir.",
        )
        setProposal(null)
        setCalcPhase("idle")
        setHealSim(null)
        setHealClipIdx(0)
        setHealAnimDone(false)
      }
    } catch (e) {
      const msg = formatCommitError(e)
      setExecNote(msg)
      toast.error(msg, { id: "tx" })
      beatOutcome("fail")
      await aquaSpeak("Execution failed sir.")
    } finally {
      setExecBusy(false)
      busyRef.current = false
      setPhase("awake")
    }
  }

  const chips = visibleAquaActions({ awake, hasProposal: !!proposal })

  const demoStep = resolveDemoStep({
    awake,
    sawBook,
    hasProposal: !!proposal,
    settledOnce,
  })

  const thinkingLock =
    phase === "thinking" || phase === "waking" || execBusy || healArming

  const phaseLabel =
    phase === "asleep"
      ? "standby"
      : phase === "waking"
        ? "waking"
        : phase === "listening"
          ? "listening"
          : phase === "thinking"
            ? "thinking"
            : phase === "speaking"
              ? "speaking"
              : execBusy
                ? "executing"
                : "online"

  return (
    <div
      className={`aqua-chassis ${awake ? "aqua-chassis--online" : "aqua-chassis--standby"} ${
        thinkingLock ? "aqua-chassis--thinking" : ""
      } ${phase === "waking" ? "aqua-chassis--waking" : ""} ${
        outcome === "success" ? "aqua-chassis--success" : outcome === "fail" ? "aqua-chassis--fail" : ""
      }`}
    >
      <div className="aqua-atmosphere" aria-hidden>
        <div className="aqua-atmosphere-fog" />
        <div className="aqua-atmosphere-beam" />
        <div className="aqua-atmosphere-scan" />
      </div>

      <div className="aqua-frame aqua-frame--tl" aria-hidden />
      <div className="aqua-frame aqua-frame--tr" aria-hidden />
      <div className="aqua-frame aqua-frame--bl" aria-hidden />
      <div className="aqua-frame aqua-frame--br" aria-hidden />

      <header className="aqua-masthead">
        <div className="aqua-masthead-brand">
          <p className="aqua-kicker">Prime Desk · voice chassis</p>
          <h1 className="aqua-title">
            <span className="aqua-title-aqua">AQUA</span>
            <span className="aqua-title-prime">PRIME</span>
          </h1>
          <p className="aqua-tagline">Holographic desk intelligence</p>
        </div>
        <div className="aqua-masthead-meta">
          <span className={`aqua-sys ${awake ? "aqua-sys--on" : ""}`}>{phaseLabel}</span>
          <Link href="/desk" className="aqua-link">
            Terminal
          </Link>
        </div>
      </header>

      <AquaDemoStepper step={demoStep} awake={awake} />

      <AquaStatusBanner
        awake={awake}
        bookSource={balances.source}
        makerGate={isConnected ? makerGate : "Connect wallet to Execute."}
      />

      <AquaIdentityStrip awake={awake} proposal={proposal} />

      {(panels.pool || panels.healSim || panels.advise || panels.calc || panels.sor) && (
        <button
          type="button"
          className="aqua-wings-toggle"
          onClick={() => setWingsOpen(v => !v)}
          aria-expanded={wingsOpen}
          aria-controls="aqua-hud-wings"
        >
          {wingsOpen ? "Hide panels" : "Show panels"}
        </button>
      )}

      <div
        id="aqua-hud-wings"
        className={`${hudLayoutClass(panels)} ${wingsOpen ? "aqua-hud--wings-open" : ""}`}
      >
        <div className="aqua-wing aqua-wing--left">
          {panels.pool ? (
            <AquaPoolPanel
              key={`pool-${holoTick}`}
              awake={awake}
              visible
              amountIn={amountInWei}
              sellBase={sellBase}
              onBalances={handleBalances}
            />
          ) : (
            <AquaPoolPanel
              awake={awake}
              visible={false}
              amountIn={amountInWei}
              sellBase={sellBase}
              onBalances={handleBalances}
            />
          )}
        </div>

        <div className="aqua-center">
          <AquaTalkingHead
            phase={phase}
            phaseLabel={phaseLabel}
            words={speechWords}
            activeWord={speechActive}
            latestLine={phase === "speaking" ? null : latestLine}
            outcome={outcome}
            hint={
              !awake && phase === "asleep" ? (
                <p className="aqua-hint">
                  Engage <em>Talk</em> — say <em>aqua wake up</em>
                </p>
              ) : awake && phase !== "speaking" && demoStep === "book" ? (
                <p className="aqua-hint">
                  Next: <em>read the book</em>
                </p>
              ) : awake && phase !== "speaking" && demoStep === "tune" ? (
                <p className="aqua-hint">
                  Next: <em>Best settings</em> · or <em>Best route</em>
                </p>
              ) : awake && phase !== "speaking" && demoStep === "execute" ? (
                <p className="aqua-hint">
                  Next: <em>Execute</em> — review risk, then MetaMask
                </p>
              ) : null
            }
          />

          <div
            className={`aqua-command-rail ${thinkingLock ? "aqua-command-rail--locked" : ""}`}
            role="group"
            aria-label="Suggestion actions"
          >
            {chips.map(action => (
              <AquaActionChip
                key={action.id}
                action={action}
                pulse={pulseChip === action.id}
                armed={action.id === "execute" && !!proposal && canExecute}
                disabled={
                  thinkingLock ||
                  (action.id === "execute" && (!!executeDisabledReason || !proposal))
                }
                disabledReason={
                  action.id === "execute"
                    ? executeDisabledReason ?? (!proposal ? "Arm Best settings first." : null)
                    : thinkingLock
                      ? "Aqua is busy — wait a moment."
                      : null
                }
                onActivate={handleChip}
              />
            ))}
          </div>

          <div className="aqua-holo-stack">
            {panels.ticket ? (
              <AquaTradeTicket
                key={`ticket-${holoTick}`}
                awake={awake}
                amountIn={amountIn}
                sellBase={sellBase}
                hasProposal={!!proposal}
                showExecute
                execBusy={execBusy || isPending}
                execNote={execNote}
                canExecute={canExecute}
                executeDisabledReason={executeDisabledReason}
                onAmountIn={handleAmountIn}
                onSellBase={handleSellBase}
                onAdvise={() => void handleUserUtterance("advise on the trade")}
                onTune={() => void handleUserUtterance("best settings versus Uniswap")}
                onExecute={() => void requestExecute()}
              />
            ) : null}

            {panels.routes ? (
              <AquaRoutePanel
                key={`routes-${holoTick}`}
                visible
                awake={awake}
                amountInWei={amountInWei}
                sellBase={sellBase}
                balBase={balances.balBase}
                balQuote={balances.balQuote}
                ethUsd1e18={balances.ethUsd1e18}
                rows={routeRows}
                livePrimeOut={livePrimeOut}
                isLoading={routesLoading}
              />
            ) : null}
          </div>

          <section className="aqua-comms" aria-live="polite">
            <header className="aqua-comms-head">
              <span>Comms</span>
              <span className="aqua-tag">{awake ? "open channel" : "dark"}</span>
            </header>
            <div className="aqua-thread">
              {turns.map(t => (
                <div key={t.id} className={`aqua-turn aqua-turn--${t.role} aqua-turn--in`}>
                  <span className="aqua-turn-who">
                    {t.role === "aqua" ? "Aqua" : t.role === "you" ? "You" : "System"}
                  </span>
                  <p>
                    {t.role === "aqua" || t.role === "system" ? <AquaGlossText text={t.text} /> : t.text}
                  </p>
                </div>
              ))}
              {interim ? (
                <div className="aqua-turn aqua-turn--you aqua-turn--interim">
                  <span className="aqua-turn-who">You</span>
                  <p>{interim}</p>
                </div>
              ) : null}
              <div ref={bottomRef} />
            </div>
          </section>

          <form className="aqua-composer aqua-composer--sticky" onSubmit={handleSubmit}>
            <button
              type="button"
              className={`aqua-talk ${phase === "listening" ? "aqua-talk--hot" : ""}`}
              onClick={() => (phase === "listening" ? stopListening() : startListening())}
              disabled={
                !supported ||
                phase === "thinking" ||
                phase === "speaking" ||
                phase === "waking" ||
                execBusy
              }
              aria-pressed={phase === "listening"}
              aria-label={phase === "listening" ? "Stop listening" : "Talk to Aqua"}
            >
              {phase === "listening" ? "Stop" : "Talk"}
            </button>
            <input
              className="aqua-input"
              value={draft}
              onChange={e => setDraft(e.target.value)}
              placeholder={awake ? "Transmit to Aqua…" : "Type: aqua wake up"}
              autoComplete="off"
              aria-label="Message Aqua"
              disabled={thinkingLock && phase !== "listening"}
            />
            <button type="submit" className="aqua-send" disabled={!draft.trim() || execBusy || thinkingLock}>
              Send
            </button>
          </form>
        </div>

        <div className="aqua-wing aqua-wing--right">
          {panels.sor ? (
            <AquaSorPanel
              key={`sor-${holoTick}`}
              awake={awake}
              visible
              pick={sorPick}
            />
          ) : panels.healSim ? (
            <AquaHealSimPanel
              key={`healsim-${holoTick}`}
              awake={awake}
              visible
              result={healSim}
              animate={!healAnimDone}
              arming={healArming}
              armedClip={healSim && healClipIdx >= 0 ? healClipIdx + 1 : null}
              onComplete={handleHealSimComplete}
              onArmMetaMask={sim => void armHealClip(sim, healClipIdx)}
            />
          ) : panels.advise || advisePhase === "scanning" ? (
            <AquaAdviseStream
              key={`advise-${holoTick}`}
              awake={awake}
              visible
              phase={advisePhase}
              verdict={adviseVerdict}
              sellBase={sellBase}
            />
          ) : panels.calc || calcPhase === "running" ? (
            <>
              <AquaCalcStream
                awake={awake}
                visible
                phase={calcPhase}
                proposal={proposal}
                amountInWei={amountInWei}
                sellBase={sellBase}
              />
              {proposal?.tapeIntel ? <AquaTapeIntel tape={proposal.tapeIntel} /> : null}
            </>
          ) : null}
        </div>
      </div>

      {proposal ? (
        <AquaRiskCard
          open={riskOpen}
          proposal={proposal}
          amountIn={amountIn}
          sellBase={sellBase}
          needsApproval={needsApproval}
          execBusy={execBusy || isPending}
          onCancel={() => setRiskOpen(false)}
          onConfirm={() => void onExecute()}
        />
      ) : null}

      {!supported ? (
        <p className="aqua-warn">Voice unavailable — type “aqua wake up” to engage the chassis.</p>
      ) : null}
    </div>
  )
}
