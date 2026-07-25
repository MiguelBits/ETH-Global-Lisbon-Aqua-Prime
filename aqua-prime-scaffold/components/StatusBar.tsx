"use client";

import { useEffect, useState } from "react";
import { useAccount, useBlockNumber } from "wagmi";
import scaffoldConfig from "~~/scaffold.config";
import { primeDeskManifest } from "~~/contracts/manifestMeta";

const TARGET = scaffoldConfig.targetNetworks[0];
const IS_SEPOLIA = TARGET.id === 11155111;
const SUBGRAPH_ON = Boolean(process.env.NEXT_PUBLIC_SUBGRAPH_URL);

function Feed({ label, on }: { label: string; on: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5" title={on ? `${label} connected` : `${label} not configured`}>
      <span className={`status-dot ${on ? "status-dot-on" : "status-dot-off"}`} />
      <span className={on ? "text-[var(--term-green)]" : "term-label"}>{label}</span>
    </span>
  );
}

export function StatusBar() {
  const { isConnected, chain } = useAccount();
  const { data: blockNumber } = useBlockNumber({ watch: true });
  const [clock, setClock] = useState("--:--:--");

  useEffect(() => {
    const tick = () =>
      setClock(new Date().toLocaleTimeString("en-GB", { hour12: false, timeZone: "UTC" }));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const onTarget = isConnected && chain?.id === TARGET.id;
  const netState = !isConnected ? "off" : onTarget ? "on" : "live";

  return (
    <div className="status-strip">
      <span className="inline-flex items-center gap-1.5">
        <span className={`status-dot status-dot-${netState === "off" ? "off" : netState === "on" ? "on" : "live"}`} />
        <span className="text-[var(--term-cyan)]">{IS_SEPOLIA ? "SEPOLIA" : "FORK"}</span>
        <span className="term-label">· {TARGET.name} · {TARGET.id}</span>
      </span>

      <span className="inline-flex items-center gap-1.5">
        <span className="status-dot status-dot-live" />
        <span className="term-label">BLOCK</span>
        <span className="font-mono text-[var(--term-green)]">{blockNumber ? blockNumber.toString() : "—"}</span>
      </span>

      <Feed label="SwapVM" on={primeDeskManifest.deployed} />
      <Feed label="Subgraph" on={SUBGRAPH_ON} />

      <span className="hidden items-center gap-1.5 sm:inline-flex">
        <span className="term-label">DESK</span>
        <span className="text-[var(--term-cyan)]">{primeDeskManifest.ensName}</span>
      </span>

      <span className="ml-auto inline-flex items-center gap-1.5">
        <span className="term-label">UTC</span>
        <span className="font-mono text-[var(--term-green)]">{clock}</span>
      </span>
    </div>
  );
}
