import Link from "next/link";

const PILLARS = [
  { tag: "1inch", desc: "SkewPricer + PrimeSelector + live desk retune" },
  { tag: "Jarvis / 0G", desc: "ENS-souled agent retunes heal from Uniswap tape" },
  { tag: "Uniswap API", desc: "Fair tape for Jarvis propose" },
  { tag: "ENS", desc: "jarvis.primedesk.eth soul + maker desk" },
];

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 py-16 text-center">
      <p className="text-xs uppercase tracking-[0.3em] text-[var(--term-muted)]">
        From degen unicorns to prime brokerage
      </p>
      <h1 className="mt-4 max-w-2xl text-3xl font-bold tracking-tight text-[var(--term-cyan)] md:text-5xl">
        PRIME DESK
      </h1>
      <p className="mt-6 max-w-xl text-sm leading-relaxed text-[var(--term-muted)]">
        1inch and Uniswap used to feel like magic unicorns. Crypto is growing up, and the UX that wins now is the
        Bloomberg terminal: dense, professional, trustworthy.{" "}
        <strong className="text-[var(--term-green)]">Prime Desk</strong> is a self-custodied spot market-making desk on
        1inch Aqua + SwapVM. <strong className="text-[var(--term-cyan)]">Jarvis</strong> — soul on ENS, brain on 0G —
        retunes heal knobs against the Uniswap tape before each commit.
      </p>
      <div className="mt-10 flex flex-wrap justify-center gap-4">
        <Link href="/jarvis" className="btn-term border-[var(--term-green)] px-6 py-2 text-sm text-[var(--term-green)]">
          Talk to Aqua →
        </Link>
        <Link href="/desk" className="btn-term border-[var(--term-cyan)] px-6 py-2 text-sm text-[var(--term-cyan)]">
          Open Terminal →
        </Link>
      </div>
      <ul className="mt-12 grid w-full max-w-lg gap-2 text-left text-xs">
        {PILLARS.map(p => (
          <li key={p.tag} className="term-panel flex items-center justify-between">
            <span className="term-value-accent uppercase tracking-wider">{p.tag}</span>
            <span className="term-label">{p.desc}</span>
          </li>
        ))}
      </ul>
    </main>
  );
}
