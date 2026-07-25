"use client";

import { fmtPct1e18, type ResolvedTuning } from "~~/lib/dynamicParams";
import { paramExplain, type PricingParamId } from "~~/lib/jarvis/pricingExplain";
import {
  DEPLOYED_LAMBDA,
  DEPLOYED_LP_PREMIUM,
  DEPLOYED_ORACLE_DECAY,
  DEPLOYED_SKEW_K,
  DEPLOYED_SKEW_MAX,
  SKEW_ONE,
  type RawTuningParams,
} from "~~/lib/primeSim";

type KnobKey = keyof RawTuningParams;

type KnobDef = {
  key: KnobKey;
  label: string;
  explainId: PricingParamId;
  min: bigint;
  max: bigint;
  step: bigint;
  deployed: bigint;
  format: (v: bigint) => string;
};

const KNOBS: KnobDef[] = [
  {
    key: "healK",
    label: "Heal k (sensitivity)",
    explainId: "healK",
    min: 0n,
    max: 8n * 10n ** 17n,
    step: 5n * 10n ** 16n,
    deployed: DEPLOYED_SKEW_K,
    format: v => (v === 0n ? "auto" : fmtPct1e18(v)),
  },
  {
    key: "maxAdjustment",
    label: "Max skew cap",
    explainId: "maxAdj",
    min: 0n,
    max: 2n * 10n ** 17n,
    step: 1n * 10n ** 16n,
    deployed: DEPLOYED_SKEW_MAX,
    format: v => (v === 0n ? "auto" : fmtPct1e18(v)),
  },
  {
    key: "healPremium",
    label: "Heal LP premium",
    explainId: "premium",
    min: 0n,
    max: 2n * 10n ** 16n,
    step: 1n * 10n ** 15n,
    deployed: DEPLOYED_LP_PREMIUM,
    format: v => (v === 0n ? "auto" : fmtPct1e18(v, 3)),
  },
  {
    key: "oracleBand",
    label: "Oracle band (decay)",
    explainId: "oracleBand",
    min: 0n,
    max: SKEW_ONE,
    step: 1n * 10n ** 16n,
    deployed: DEPLOYED_ORACLE_DECAY,
    format: v => {
      if (v === 0n) return "auto";
      const bump = ((Number(SKEW_ONE - v) / 1e18) * 100).toFixed(1);
      return `±${bump}%`;
    },
  },
  {
    key: "lambda",
    label: "Selector λ (inventory penalty)",
    explainId: "lambda",
    min: 0n,
    max: 5n * 10n ** 9n,
    step: 1n * 10n ** 8n,
    deployed: DEPLOYED_LAMBDA,
    format: v => (v === 0n ? "auto" : v.toString()),
  },
];

type Props = {
  raw: RawTuningParams;
  resolved: ResolvedTuning;
  onChange: (next: RawTuningParams) => void;
  onReset: () => void;
};

function resolvedValue(key: KnobKey, resolved: ResolvedTuning): bigint {
  switch (key) {
    case "healK":
      return resolved.heal.k;
    case "maxAdjustment":
      return resolved.heal.maxAdjustment;
    case "healPremium":
      return resolved.heal.maxLpPremium;
    case "oracleBand":
      return resolved.oracle.maxPriceDecay;
    case "lambda":
      return resolved.lambda;
    case "baselineK":
      return resolved.baseline.k;
    case "baselinePremium":
      return resolved.baseline.maxLpPremium;
    default:
      return 0n;
  }
}

export function TuningPanel({ raw, resolved, onChange, onReset }: Props) {
  return (
    <div className="term-panel">
      <div className="term-header">
        <span>STRAT · parameter tuning</span>
        <button type="button" className="text-[10px] term-label hover:text-white" onClick={onReset}>
          reset deployed
        </button>
      </div>

      <p className="mb-3 text-[10px] term-label">
        Override / debug. Jarvis proposes live knobs; use Commit desk &amp; swap to dock/ship on-chain. Slider 0 =
        dynamic sim formula. Each knob shows the quote formula it feeds.
      </p>

      <div className="space-y-4">
        {KNOBS.map(knob => {
          const rawVal = raw[knob.key];
          const isDynamic = resolved.dynamicFlags[knob.key];
          const effective = resolvedValue(knob.key, resolved);
          const sliderVal = rawVal === 0n ? 0 : Number((rawVal * 1000n) / knob.max);
          const explain = paramExplain(knob.explainId);

          return (
            <div key={knob.key}>
              <div className="mb-1 flex items-center justify-between text-[10px]">
                <span className="term-label" title={explain?.tip}>
                  {knob.label}
                </span>
                <span className="font-mono">
                  {isDynamic ? (
                    <span className="term-value-accent">auto → {knob.format(effective)}</span>
                  ) : (
                    <span className="term-value">{knob.format(rawVal)}</span>
                  )}
                </span>
              </div>
              {explain ? (
                <p className="mb-1 text-[9px] leading-snug term-label">
                  <span className="font-mono term-value">{explain.formula}</span>
                  <br />
                  {explain.how}
                </p>
              ) : null}
              <input
                type="range"
                min={0}
                max={1000}
                step={1}
                value={rawVal === 0n ? 0 : Math.max(1, sliderVal)}
                className="tuning-slider w-full"
                aria-label={knob.label}
                onChange={e => {
                  const n = Number(e.target.value);
                  if (n === 0) {
                    onChange({ ...raw, [knob.key]: 0n });
                    return;
                  }
                  const mapped = (BigInt(n) * knob.max) / 1000n;
                  onChange({ ...raw, [knob.key]: mapped < knob.min ? knob.min : mapped });
                }}
              />
              <div className="mt-0.5 flex justify-between text-[9px] term-label">
                <span>0 dynamic</span>
                <span>deployed {knob.format(knob.deployed)}</span>
                <span>max {knob.format(knob.max)}</span>
              </div>
            </div>
          );
        })}
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-1 border-t border-[var(--term-border)] pt-2 text-[10px]">
        <dt className="term-label">Baseline branch</dt>
        <dd className="text-right font-mono">
          k={fmtPct1e18(resolved.baseline.k)} prem={fmtPct1e18(resolved.baseline.maxLpPremium, 3)}
        </dd>
        <dt className="term-label">Heal branch</dt>
        <dd className="text-right font-mono term-value-accent">
          k={fmtPct1e18(resolved.heal.k)} prem={fmtPct1e18(resolved.heal.maxLpPremium, 3)}
        </dd>
        <dt className="term-label">XYC branch</dt>
        <dd className="text-right font-mono">pure pool curve</dd>
        <dt className="term-label">Oracle branch</dt>
        <dd className="text-right font-mono">
          band {fmtPct1e18(resolved.oracle.maxPriceDecay, 1)} decay
        </dd>
      </dl>
    </div>
  );
}
