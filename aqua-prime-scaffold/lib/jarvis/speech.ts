/** Browser Web Speech helpers for /jarvis voice console. */

export function speechSupported(): boolean {
  if (typeof window === "undefined") return false;
  return "speechSynthesis" in window && ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);
}

export function ttsSupported(): boolean {
  if (typeof window === "undefined") return false;
  return "speechSynthesis" in window;
}

/** Push-to-talk recognition (starts only when the UI calls start()). */
export function createRecognition(): SpeechRecognition | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    (window as unknown as { SpeechRecognition?: typeof SpeechRecognition }).SpeechRecognition ??
    (window as unknown as { webkitSpeechRecognition?: typeof SpeechRecognition }).webkitSpeechRecognition;
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.continuous = false;
  rec.interimResults = true;
  rec.lang = "en-GB";
  return rec;
}

/** Prefer calm British male voices closest to a JARVIS register (no licensed JARVIS voice in browsers). */
function scoreJarvisVoice(v: SpeechSynthesisVoice): number {
  const n = `${v.name} ${v.lang}`.toLowerCase();
  let score = 0;
  if (/google uk english male/.test(n)) score += 100;
  if (/microsoft george/.test(n)) score += 95;
  if (/\bdaniel\b/.test(n) && /en-?gb|uk/.test(n)) score += 90;
  if (/\barthur\b/.test(n)) score += 85;
  if (/microsoft ryan/.test(n)) score += 80;
  if (/uk english male|english \(uk\).*male|en-gb.*male/.test(n)) score += 75;
  if (/en-gb|en_gb|english \(united kingdom\)/.test(n)) score += 40;
  if (/\bmale\b/.test(n)) score += 15;
  if (/female|zira|susan|hazel|martha|serena/.test(n)) score -= 50;
  if (v.localService) score += 5;
  return score;
}

function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  return new Promise(resolve => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      resolve([]);
      return;
    }
    const ready = () => resolve(window.speechSynthesis.getVoices());
    const existing = window.speechSynthesis.getVoices();
    if (existing.length) {
      resolve(existing);
      return;
    }
    window.speechSynthesis.addEventListener("voiceschanged", ready, { once: true });
    setTimeout(ready, 250);
  });
}

/** Never pause before "sir" — "Certainly sir", never "Certainly, sir". */
export function stripCommaBeforeSir(text: string): string {
  return text.replace(/,\s*(sir)\b/gi, " $1")
}

const MAX_SPEECH_CHARS = 140
const MAX_SPEECH_SENTENCES = 2

/**
 * Compress a reply for TTS: drop hex dumps, huge numbers, viem noise, and long tails.
 * Keep full detail in UI toasts / panels — only speech goes through this.
 */
export function forSpeech(text: string): string {
  const raw = text.trim()
  if (!raw) return "Done sir."

  if (/PendingDeskSet|0xbcc83eca|already staged/i.test(raw)) {
    return "Pending desk set sir. Restart the fork, then Execute again."
  }
  if (/archive|403|publicnode|allnodes/i.test(raw)) {
    return "Fork RPC needs archive access sir. Set MAINNET_RPC_URL and restart."
  }
  if (/DeskSetCaps|outside on-chain caps/i.test(raw)) {
    return "Knobs out of range sir. Re-run Best settings."
  }
  if (/OnlyMaker|maker wallet/i.test(raw) && /commit|desk/i.test(raw)) {
    return "Connect the maker wallet sir."
  }
  if (/Execution did not complete|Commit\/swap failed|Commit\/swap/i.test(raw) && raw.length > 80) {
    return "Execution failed sir. Check MetaMask."
  }

  let s = stripCommaBeforeSir(raw)
  s = s.replace(/Docs:\s*https?:\S+/gi, "")
  s = s.replace(/Version:\s*\S+/gi, "")
  s = s.replace(/Contract Call:[\s\S]*/i, "")
  s = s.replace(/Details:\s*/gi, "")
  s = s.replace(/Make sure you are using[\s\S]*?(?=\.|$)/gi, "")
  s = s.replace(/Unable to decode[\s\S]*?(?=\.|$)/gi, "contract error")
  s = s.replace(/execution reverted[^.]*/gi, "transaction reverted")
  s = s.replace(/custom error\s+0x[a-fA-F0-9]+/gi, "contract error")
  s = s.replace(/0x[a-fA-F0-9]{8,}/g, "")
  s = s.replace(/\b\d{7,}\b/g, "")
  s = s.replace(/\b\d+\.\d{4,}\b/g, m => {
    const n = Number(m)
    return Number.isFinite(n) ? n.toFixed(2) : ""
  })
  s = s.replace(/\s*[·|]\s*/g, ". ")
  s = s.replace(/\s{2,}/g, " ").trim()

  const sentences = s.split(/(?<=[.!?])\s+/).filter(p => p.replace(/[.\s]/g, "").length > 2)
  s = sentences.slice(0, MAX_SPEECH_SENTENCES).join(" ")
  if (s.length > MAX_SPEECH_CHARS) {
    s = `${s.slice(0, MAX_SPEECH_CHARS).replace(/\s+\S*$/, "")}.`
  }
  return s || "Done sir."
}

export type SpeakBoundary = {
  charIndex: number;
  charLength: number;
  name: string;
};

export type SpeakOpts = {
  rate?: number
  pitch?: number
  /** ENS `agent.voice` tags e.g. calm,collected,deferential,sir,concise */
  voiceTags?: string
  onStart?: () => void
  onBoundary?: (b: SpeakBoundary) => void
}

function scoreVoiceForTags(v: SpeechSynthesisVoice, tags: string): number {
  let score = scoreJarvisVoice(v)
  const n = `${v.name} ${v.lang}`.toLowerCase()
  const t = tags.toLowerCase()
  if (/british|uk|en-gb/.test(t) && /en-gb|uk/.test(n)) score += 25
  if (/calm|collected|deferential/.test(t) && /\bmale\b|george|daniel|ryan|arthur/.test(n)) score += 12
  if (/concise|precise/.test(t)) {
    /* prefer slightly faster voices — handled via rate */
  }
  return score
}

function pickVoice(voices: SpeechSynthesisVoice[], voiceTags?: string): SpeechSynthesisVoice | null {
  if (!voices.length) return null
  const ranked = [...voices].sort(
    (a, b) => scoreVoiceForTags(b, voiceTags ?? "") - scoreVoiceForTags(a, voiceTags ?? ""),
  )
  return ranked[0] ?? null
}

/**
 * Speak in a JARVIS-like register.
 * Hardened for Chrome: cancel→speak race, stuck pause, missing onend.
 */
export async function speak(text: string, opts?: SpeakOpts): Promise<void> {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return

  const voices = await loadVoices()
  const voice = pickVoice(voices, opts?.voiceTags)
  const spoken = forSpeech(text)
  const tags = (opts?.voiceTags ?? "").toLowerCase()
  const rate = opts?.rate ?? (/concise|precise/.test(tags) ? 1.02 : 0.98)
  const pitch = opts?.pitch ?? (/calm|deferential/.test(tags) ? 0.8 : 0.82)

  // Chrome often drops the next utterance if speak() follows cancel() in the same tick.
  try {
    window.speechSynthesis.cancel();
  } catch {
    /* ignore */
  }
  await new Promise<void>(r => setTimeout(r, 80));

  return new Promise(resolve => {
    let settled = false;
    let gotBoundary = false;
    let fallbackTimer: ReturnType<typeof setInterval> | null = null;
    let resumeTimer: ReturnType<typeof setInterval> | null = null;

    const clearTimers = () => {
      if (fallbackTimer != null) {
        clearInterval(fallbackTimer);
        fallbackTimer = null;
      }
      if (resumeTimer != null) {
        clearInterval(resumeTimer);
        resumeTimer = null;
      }
    };

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimers();
      resolve();
    };

  const u = new SpeechSynthesisUtterance(spoken)
  u.rate = rate
  u.pitch = pitch
  u.lang = voice?.lang || "en-GB"
  if (voice) u.voice = voice

    const startFallback = () => {
      if (fallbackTimer != null || !opts?.onBoundary) return;
      const words = spoken.match(/\S+/g) ?? [];
      if (!words.length) return;
      const msPerWord = Math.max(160, 320 / rate);
      let i = 0;
      let cursor = 0;
      fallbackTimer = setInterval(() => {
        if (i >= words.length) {
          if (fallbackTimer != null) clearInterval(fallbackTimer);
          fallbackTimer = null;
          return;
        }
        const w = words[i];
        const at = spoken.indexOf(w, cursor);
        const charIndex = at >= 0 ? at : cursor;
        opts.onBoundary?.({ charIndex, charLength: w.length, name: "word" });
        cursor = charIndex + w.length;
        i += 1;
      }, msPerWord);
    };

    u.onstart = () => {
      opts?.onStart?.();
      window.setTimeout(() => {
        if (!gotBoundary) startFallback();
      }, 200);
    };

    u.onboundary = (ev: SpeechSynthesisEvent) => {
      // Chrome may omit name or use "word"
      const name = ev.name || "word";
      if (name !== "word" && name !== "sentence") return;
      gotBoundary = true;
      if (fallbackTimer != null) {
        clearInterval(fallbackTimer);
        fallbackTimer = null;
      }
      opts?.onBoundary?.({
        charIndex: ev.charIndex,
        charLength: typeof ev.charLength === "number" ? ev.charLength : 0,
        name,
      });
    };

    u.onend = () => finish();
    u.onerror = () => finish();

    // Safety: never leave the UI stuck if the engine swallows the utterance.
    const safetyMs = Math.min(90_000, Math.max(8_000, spoken.length * 90 + 4_000));
    window.setTimeout(finish, safetyMs);

    try {
      window.speechSynthesis.speak(u);
    } catch {
      finish();
      return;
    }

    // Chrome can park synthesis in a paused state forever.
    resumeTimer = setInterval(() => {
      try {
        if (window.speechSynthesis.paused) window.speechSynthesis.resume();
      } catch {
        /* ignore */
      }
    }, 250);
  });
}

export function tokenizeSpeech(text: string): { words: string[]; starts: number[] } {
  const words: string[] = [];
  const starts: number[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    words.push(m[0]);
    starts.push(m.index);
  }
  return { words, starts };
}

export function wordIndexAt(charIndex: number, starts: number[]): number {
  if (!starts.length) return -1;
  let idx = 0;
  for (let i = 0; i < starts.length; i++) {
    if (starts[i] <= charIndex) idx = i;
    else break;
  }
  return idx;
}

export function normalizeHeard(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function containsWakePhrase(text: string, phrase: string): boolean {
  return normalizeHeard(text).includes(normalizeHeard(phrase));
}
