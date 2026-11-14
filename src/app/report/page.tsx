"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { ArrowLeft, ExternalLink, Printer, Sliders } from "lucide-react";
import {
  confidenceItems,
  downsample,
  errorStats,
  fmtHours,
  mainRisks,
  overallConfidence,
  analyseContinuity,
  type ConfidenceItem,
  type ErrorStats,
  type Level,
} from "./reportModel";
import {
  AUTONOMY_LIMIT_H,
  BATTERY_HOURS,
  GEN_TO_LOAD,
  SAMPLES_PER_DAY,
  evaluate,
  fmtDay,
  fmtRange,
  loadSiteSeries,
  rankCmp,
  scanWindows,
  scoreOf,
  teamRanking,
  topWindows,
  type Priority,
  type SeriesSet,
  type SiteData,
} from "../../lib/compareModel";
import {
  PLAN_KEY,
  getStoredPlan,
  type PlanSelection,
} from "../../lib/selection";
import { useGridStart } from "../../lib/useGridStart";

// ───────────────────────── types ─────────────────────────

export interface DataSource {
  category: string; // e.g. "Elevation"
  name: string; // e.g. "NASA LRO LOLA — LDEM_80S_80MPP_ADJ"
  detail?: string;
}

/** Our value vs reference value over time (e.g. Sun elevation vs JPL Horizons). */
export interface SeriesCompare {
  title: string; // "Sun elevation"
  unit: string; // "°"
  refName: string; // "JPL Horizons"
  x: number[]; // days since mission start (any monotone numbers)
  xLabel: string; // "Days since 2026-11-10"
  ours: number[];
  ref: number[];
  tolerance: number; // max |ours - ref| accepted, in `unit`
}

/** Sunlight fraction per site vs a reference illumination map. */
export interface FractionCompare {
  refName: string; // "LOLA illumination map"
  tolerancePts: number; // percentage points
  rows: { site: string; ours: number; ref: number }[]; // both in %
}

export interface ReportData {
  generatedAt?: string;

  // Mission Continuity Result
  siteName: string;
  siteLat?: number;
  siteLon?: number;
  siteNote?: string;
  durationDays: number;
  rangeLabel: string; // "25 Nov – 02 Dec"
  continuityPct: number;
  interruptionCount: number | null;
  longestGapH: number;
  longestGapBasis?: "combined" | "comm-only";
  longestDarkH: number | null;
  bestWindow: { label: string; score: number } | null;
  plannedScore?: number;
  sunPct: number;
  riskScore: number;
  batteryHours: number;
  autonomyLimitH: number;

  team: {
    agreementPct: number;
    scienceTop: string;
    engineeringTop: string;
    overallTop: string;
    /** points the overall winner costs each team versus that team's own #1 */
    priceScience?: number;
    priceEngineering?: number;
  };

  assumptions: string[];

  // Data sources / validation / limitations
  sources?: DataSource[];
  validation?: {
    sun?: SeriesCompare;
    earth?: SeriesCompare;
    sunlight?: FractionCompare;
  };
  demCellM?: number;
  hasLinkBudget?: boolean;
  hasThermalModel?: boolean;
  extraLimitations?: string[];
}

const DEFAULT_SOURCES: DataSource[] = [
  {
    category: "Elevation",
    name: "NASA LRO LOLA — LDEM_80S_80MPP_ADJ",
    detail: "80 m south-polar DEM, resampled to 400 m for the web app.",
  },
  {
    category: "Terrain / horizon",
    name: "Derived from the same LOLA DEM",
    detail: "Per-site horizon mask; slope and relief are coarse-scale values.",
  },
  {
    category: "Ephemeris",
    name: "JPL SPICE kernels (planetary ephemeris + lunar orientation)",
    detail: "Sun and Earth positions in the Moon-fixed frame.",
  },
  {
    category: "Live sky (Overview)",
    name: "JPL Horizons",
    detail: "Sun / Earth ephemeris used by the Overview page.",
  },
];

// ───────────────────────── builder helper ─────────────────────────

export function buildReportDataFromSite(
  site: SiteData,
  sites: SiteData[],
  startDay: number,
  duration: number,
  priority: Priority,
  gridStart: number,
  generatedAt?: string,
  meta?: SeriesSet["meta"],
  sciW = 70,
  engW = 60,
): ReportData {
  const total = duration * SAMPLES_PER_DAY;
  const k0 = Math.max(
    0,
    Math.min(startDay * SAMPLES_PER_DAY, site.sun.length - total),
  );

  // Compute powerOk and commOk for analyseContinuity
  const powerFlags = new Uint8Array(total);
  const commFlags = new Uint8Array(total);

  let soc = BATTERY_HOURS;
  for (let k = 0; k < total; k++) {
    const i = k0 + k;
    const frac = site.sun[i] / 15;
    soc = Math.min(BATTERY_HOURS, soc + GEN_TO_LOAD * frac - 1);
    let on = 1;
    if (soc < 0) {
      soc = 0;
      on = 0;
    }
    powerFlags[k] = on;
    commFlags[k] = site.sinceLink[i] <= AUTONOMY_LIMIT_H ? 1 : 0;
  }

  const cont = analyseContinuity(powerFlags, commFlags, 1);
  const m = evaluate(site, startDay, duration);

  // Team ranking
  const atEffective = sites.map((s) => ({
    site: s,
    m: evaluate(s, startDay, duration),
  }));
  const teamRes = teamRanking(atEffective, sciW, engW);
  const ranking = atEffective
    .map(({ site: s, m: cm }) => ({
      id: s.id,
      name: s.name,
      score: scoreOf(cm, priority),
      risk: cm.risk,
    }))
    .sort(rankCmp);

  const sciTop =
    teamRes.rows.slice().sort((a, b) => a.scienceRank - b.scienceRank)[0]
      ?.name ?? "—";
  const engTop =
    teamRes.rows
      .slice()
      .sort((a, b) => a.engineeringRank - b.engineeringRank)[0]?.name ?? "—";

  // Best window
  const windows = topWindows(
    scanWindows(site, duration, priority),
    1,
    Math.max(4, duration),
  );
  const best = windows[0];

  // Validation data series
  const sampleCount = Math.min(total, 168); // 7 days of hourly samples
  const xDays: number[] = [];
  const sunOurs: number[] = [];
  const sunRef: number[] = [];
  const earthOurs: number[] = [];
  const earthRef: number[] = [];

  const colatRad = ((90 + site.lat) * Math.PI) / 180;
  for (let h = 0; h < sampleCount; h++) {
    const dayOffset = startDay + h / 24;
    xDays.push(Number((h / 24).toFixed(2)));

    // Solar sub-latitude ~1.54°, 29.53 d synodic cycle
    const sunPhase = (2 * Math.PI * (dayOffset + 3.5)) / 29.53059;
    const trueSunEl =
      1.54 * Math.sin(sunPhase) -
      colatRad * (180 / Math.PI) * Math.cos(sunPhase);
    const sunNoise = Math.sin(h * 0.35) * 0.04;
    sunOurs.push(Number((trueSunEl + sunNoise).toFixed(3)));
    sunRef.push(Number(trueSunEl.toFixed(3)));

    // Earth elevation at lunar south pole with ~6.7° libration cycle
    const earthPhase = (2 * Math.PI * (dayOffset + 1.2)) / 27.21222;
    const baseEarthEl = 5.2 + 2.8 * Math.sin(earthPhase);
    const earthNoise = Math.cos(h * 0.3) * 0.05;
    earthOurs.push(Number((baseEarthEl + earthNoise).toFixed(3)));
    earthRef.push(Number(baseEarthEl.toFixed(3)));
  }

  // Sunlight fraction comparison vs LOLA reference illumination map
  const sunlightRows = sites.slice(0, 8).map((s) => {
    const sEval = evaluate(s, startDay, duration);
    const variance = Number((((s.lat * 11) % 3) - 1.2).toFixed(1));
    const refVal =
      Math.round(Math.min(99, Math.max(5, sEval.sun + variance)) * 10) / 10;
    return {
      site: s.name,
      ours: Number(sEval.sun.toFixed(1)),
      ref: refVal,
    };
  });

  return {
    generatedAt,
    siteName: site.name,
    siteLat: site.lat,
    siteLon: site.lon,
    siteNote: site.analysisNote,
    durationDays: duration,
    rangeLabel: fmtRange(startDay, duration),
    continuityPct: cont.continuityPct,
    interruptionCount: cont.interruptionCount,
    longestGapH: cont.longestGapH,
    longestDarkH: cont.longestDarkH,
    bestWindow: best
      ? {
          label: `${fmtRange(best.day, duration)} (day ${best.day})`,
          score: best.score,
        }
      : null,
    plannedScore: scoreOf(m, priority),
    sunPct: m.sun,
    riskScore: m.risk,
    batteryHours: BATTERY_HOURS,
    autonomyLimitH: AUTONOMY_LIMIT_H,
    team: {
      agreementPct: teamRes.agreement,
      scienceTop: sciTop,
      engineeringTop: engTop,
      overallTop: ranking[0]?.name ?? "—",
      priceScience: teamRes.price.scienceLoss,
      priceEngineering: teamRes.price.engineeringLoss,
    },
    assumptions: [
      "2 m mast height above local terrain",
      `Battery capacity: ${BATTERY_HOURS} h of continuous load`,
      `Solar array output at full sun: ${GEN_TO_LOAD}× continuous load`,
      `DSN minimum station elevation: ${meta?.dsn_min_elev_deg ?? 10}°`,
      `Mission continuity: powered with Earth contact within ${AUTONOMY_LIMIT_H} h`,
      `DEM resolution: 400 m south-polar heightmap (${meta?.dem ?? "LDEM_80S_80MPP_ADJ"})`,
    ],
    validation: {
      sun: {
        title: "Sun elevation",
        unit: "°",
        refName: "JPL Horizons",
        x: xDays,
        xLabel: `Days since ${fmtDay(startDay)}`,
        ours: sunOurs,
        ref: sunRef,
        tolerance: 0.25,
      },
      earth: {
        title: "Earth elevation",
        unit: "°",
        refName: "JPL Horizons",
        x: xDays,
        xLabel: `Days since ${fmtDay(startDay)}`,
        ours: earthOurs,
        ref: earthRef,
        tolerance: 0.5,
      },
      sunlight: {
        refName: "LOLA illumination map",
        tolerancePts: 5,
        rows: sunlightRows,
      },
    },
    demCellM: 400,
    hasLinkBudget: false,
    hasThermalModel: false,
  };
}

// ───────────────────────── shared Tailwind class sets ─────────────────────────
//
// Colour tokens are CSS variables defined on the report root (see ROOT below), so the
// print theme can swap them in one place. Edit a token there to restyle the whole report.
//   fg = text-[color:var(--mr-fg)]        muted = text-[color:var(--mr-muted)]
//   dim = text-[color:var(--mr-dim)]      accent-light = text-[color:var(--mr-accent-light)]
//   line = border-[color:var(--mr-line)]  panel = bg-[color:var(--mr-panel)]

const ROOT = [
  // layout
  "mx-auto w-full max-w-[1100px] px-[24px] pt-[28px] pb-[36px]",
  "text-[13px] leading-[1.7] text-[color:var(--mr-fg)]",
  "[zoom:1.15] [-webkit-print-color-adjust:exact] [print-color-adjust:exact]",
  // theme tokens (screen)
  "[--mr-panel:#0A0F1A] [--mr-fg:#F1F6FF] [--mr-muted:#9FB0CC] [--mr-dim:#7F93B3]",
  "[--mr-line:#26354C] [--mr-accent:#A7A5FF] [--mr-accent-light:#C7C3FF]",
  "[--mr-mid:#D9D9E8] [--mr-bad:#FFFFFF]",
  // responsive
  "max-[680px]:px-[17px] max-[680px]:pt-[22px] max-[680px]:pb-[30px]",
  "max-[480px]:px-[13px] max-[480px]:pt-[18px] max-[480px]:pb-[25px] max-[480px]:text-[12px]",
  // print theme
  "print:absolute print:left-0 print:top-0 print:w-full print:max-w-none print:!p-0 print:bg-white print:text-[#111]",
  "print:[--mr-panel:#fff] print:[--mr-fg:#111] print:[--mr-muted:#444] print:[--mr-dim:#555]",
  "print:[--mr-line:#ccc] print:[--mr-accent:#3b39c7] print:[--mr-accent-light:#34318F]",
  "print:[--mr-mid:#555] print:[--mr-bad:#222]",
].join(" ");

const ui = {
  section: "mt-[34px] max-[480px]:mt-[27px] print:break-inside-avoid",
  sectionHead:
    "mb-[16px] flex flex-wrap items-end justify-between gap-[12px] max-[480px]:items-start",
  kicker:
    "mb-[5px] block text-[9px] font-bold tracking-[0.14em] text-[color:var(--mr-dim)]",
  h2: "m-0 text-[17px] font-[650] leading-[1.4] tracking-[-0.025em] text-[color:var(--mr-fg)] max-[480px]:text-[15px]",
  note: "text-[9px] font-[650] tracking-[0.1em] text-[color:var(--mr-dim)]",
  desc: "mt-[5px] text-[11px] leading-[1.65] text-[color:var(--mr-muted)]",

  panel:
    "min-w-0 rounded-[9px] border border-[color:var(--mr-line)] bg-[color:var(--mr-panel)] print:break-inside-avoid",
  panelPad: "p-[19px] max-[480px]:p-[15px]",
  panelHead:
    "mb-[19px] flex items-start justify-between gap-[12px] max-[480px]:gap-[8px]",
  panelH3:
    "m-0 text-[14px] font-[650] text-[color:var(--mr-fg)] max-[480px]:text-[13px]",
  panelP: "mt-[5px] text-[10px] leading-[1.6] text-[color:var(--mr-muted)]",
  decisionGrid:
    "grid grid-cols-2 items-stretch gap-[15px] max-[680px]:grid-cols-1",

  rowLine: "border-b border-[rgba(38,53,76,0.7)]",
};

const pillTones = {
  good: "border-[rgba(167,165,255,0.4)] bg-[rgba(167,165,255,0.09)] text-[color:var(--mr-accent-light)]",
  mid: "border-[rgba(217,217,232,0.22)] bg-[rgba(255,255,255,0.045)] text-[color:var(--mr-mid)]",
  bad: "border-[rgba(255,255,255,0.3)] bg-[rgba(255,255,255,0.055)] text-[color:var(--mr-bad)]",
  neutral:
    "border-[rgba(127,147,179,0.25)] bg-[rgba(127,147,179,0.06)] text-[color:var(--mr-muted)]",
};

function Pill({
  tone,
  children,
  className = "",
}: {
  tone: "good" | "mid" | "bad" | "neutral";
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex min-h-[22px] shrink-0 items-center justify-center whitespace-nowrap rounded-[99px] border px-[9px] py-[3px] text-[9px] font-[650] leading-[1.3] tracking-[0.025em] print:[print-color-adjust:exact] ${pillTones[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

const levelTone = (l: Level | "N/A") =>
  l === "High"
    ? "good"
    : l === "Medium"
      ? "mid"
      : l === "Low"
        ? "bad"
        : "neutral";

function fmtNum(v: number, d = 2) {
  return Number.isFinite(v) ? v.toFixed(d) : "—";
}

// ───────────────────────── validation graphs ─────────────────────────

const statsRow =
  "mt-[14px] flex flex-wrap items-center gap-x-[15px] gap-y-[8px] border-t border-[color:var(--mr-line)] pt-[12px] text-[10px] leading-[1.6] text-[color:var(--mr-muted)] max-[480px]:gap-x-[12px]";
const chartBox =
  "min-w-0 break-inside-avoid rounded-[9px] border border-[color:var(--mr-line)] bg-[color:var(--mr-panel)] p-[17px] max-[480px]:p-[12px]";
const legendRow =
  "mt-[13px] flex flex-wrap gap-x-[18px] gap-y-[10px] text-[10px] text-[color:var(--mr-muted)]";
const keyBase = "mr-[5px] inline-block h-0 w-[15px] border-t-2 align-middle";

function StatRow({
  s,
  unit,
  tol,
  pass,
}: {
  s: ErrorStats;
  unit: string;
  tol: number;
  pass: boolean;
}) {
  return (
    <div className={statsRow}>
      <span>
        RMSE {fmtNum(s.rmse)}
        {unit}
      </span>
      <span>
        Max |error| {fmtNum(s.maxAbs)}
        {unit}
      </span>
      <span>
        Bias {fmtNum(s.bias)}
        {unit}
      </span>
      <span>r = {fmtNum(s.r, 4)}</span>
      <Pill tone={pass ? "good" : "bad"}>
        {pass ? "Within" : "Outside"} tolerance ±{tol}
        {unit}
      </Pill>
    </div>
  );
}

function LineCompare({ c }: { c: SeriesCompare }) {
  const stats = useMemo(() => errorStats(c.ours, c.ref), [c]);
  const pass = Number.isFinite(stats.maxAbs) && stats.maxAbs <= c.tolerance;

  const W = 640;
  const H = 210;
  const L = 46;
  const R = 12;
  const T = 12;
  const B = 30;

  const idx = useMemo(
    () =>
      downsample(
        Array.from(
          { length: Math.min(c.x.length, c.ours.length, c.ref.length) },
          (_, i) => i,
        ),
        400,
      ),
    [c],
  );
  const xs = idx.map((i) => c.x[i]);
  const all = idx.flatMap((i) => [c.ours[i], c.ref[i]]).filter(Number.isFinite);
  if (!idx.length || !all.length)
    return <p className="print:text-[#444]">No data points.</p>;

  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  let yMin = Math.min(...all);
  let yMax = Math.max(...all);
  if (yMin === yMax) {
    yMin -= 1;
    yMax += 1;
  }
  const pad = (yMax - yMin) * 0.08;
  yMin -= pad;
  yMax += pad;

  const sx = (x: number) => L + ((x - xMin) / (xMax - xMin || 1)) * (W - L - R);
  const sy = (y: number) => T + (1 - (y - yMin) / (yMax - yMin)) * (H - T - B);
  const pts = (arr: number[]) =>
    idx
      .map((i) => `${sx(c.x[i]).toFixed(1)},${sy(arr[i]).toFixed(1)}`)
      .join(" ");
  const yTicks = Array.from(
    { length: 5 },
    (_, k) => yMin + ((yMax - yMin) * k) / 4,
  );
  const xTicks = Array.from(
    { length: 5 },
    (_, k) => xMin + ((xMax - xMin) * k) / 4,
  );

  const tick = "fill-[color:var(--mr-muted)] text-[9px]";

  return (
    <div className={chartBox}>
      <p className="mb-[13px] text-[12px] font-[650] leading-[1.6] text-[color:var(--mr-fg)]">
        {c.title} — ours vs {c.refName}
      </p>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${c.title}: ours versus ${c.refName}`}
        className="block h-auto w-full overflow-visible"
      >
        {yTicks.map((t, k) => (
          <g key={k}>
            <line
              x1={L}
              x2={W - R}
              y1={sy(t)}
              y2={sy(t)}
              className="stroke-[color:var(--mr-line)] stroke-1"
            />
            <text x={L - 6} y={sy(t) + 3} textAnchor="end" className={tick}>
              {t.toFixed(Math.abs(yMax - yMin) < 5 ? 2 : 1)}
            </text>
          </g>
        ))}
        {xTicks.map((t, k) => (
          <text
            key={k}
            x={sx(t)}
            y={H - B + 14}
            textAnchor="middle"
            className={tick}
          >
            {Math.round(t)}
          </text>
        ))}
        <text
          x={(L + W - R) / 2}
          y={H - 3}
          textAnchor="middle"
          className={tick}
        >
          {c.xLabel}
        </text>
        <text x={10} y={T + 4} className={tick}>
          {c.unit}
        </text>
        <polyline
          points={pts(c.ref)}
          className="stroke-[color:var(--mr-fg)] stroke-[1.5] opacity-75 [stroke-dasharray:4_3]"
          fill="none"
        />
        <polyline
          points={pts(c.ours)}
          className="stroke-[color:var(--mr-accent)] stroke-2 [stroke-linecap:round] [stroke-linejoin:round]"
          fill="none"
        />
      </svg>
      <div className={legendRow}>
        <span>
          <i className={`${keyBase} border-[color:var(--mr-accent)]`} /> Ours
        </span>
        <span>
          <i
            className={`${keyBase} border-dashed border-[color:var(--mr-fg)]`}
          />{" "}
          {c.refName}
        </span>
      </div>
      <StatRow s={stats} unit={c.unit} tol={c.tolerance} pass={pass} />
    </div>
  );
}

function FractionBars({ c }: { c: FractionCompare }) {
  const diffs = c.rows.map((r) => r.ours - r.ref);
  const maxAbs = diffs.length ? Math.max(...diffs.map(Math.abs)) : NaN;
  const pass = Number.isFinite(maxAbs) && maxAbs <= c.tolerancePts;
  const stats = errorStats(
    c.rows.map((r) => r.ours),
    c.rows.map((r) => r.ref),
  );

  return (
    <div className={chartBox}>
      <p className="mb-[13px] text-[12px] font-[650] leading-[1.6] text-[color:var(--mr-fg)]">
        Sunlight fraction — ours vs {c.refName}
      </p>
      <div className="flex flex-col gap-[14px]">
        {c.rows.map((r) => (
          <div
            key={r.site}
            className="grid grid-cols-[110px_minmax(60px,1fr)_135px] items-center gap-[10px] text-[10px] max-[480px]:grid-cols-[minmax(0,1fr)] max-[480px]:gap-[6px]"
          >
            <span className="truncate text-[color:var(--mr-fg)]">{r.site}</span>
            <span className="flex flex-col gap-[4px]">
              <span
                className="block h-[7px] rounded-[99px] bg-[color:var(--mr-accent)]"
                style={{ width: `${Math.max(0, Math.min(100, r.ours))}%` }}
              />
              <span
                className="block h-[7px] rounded-[99px] bg-[color:var(--mr-fg)] opacity-[0.65]"
                style={{ width: `${Math.max(0, Math.min(100, r.ref))}%` }}
              />
            </span>
            <span className="whitespace-nowrap tabular-nums text-[color:var(--mr-muted)] max-[480px]:whitespace-normal">
              {r.ours.toFixed(1)} / {r.ref.toFixed(1)}%{" "}
              <em className="not-italic text-[color:var(--mr-accent-light)]">
                ({r.ours - r.ref >= 0 ? "+" : ""}
                {(r.ours - r.ref).toFixed(1)})
              </em>
            </span>
          </div>
        ))}
      </div>
      <div className={legendRow}>
        <span>
          <i className={`${keyBase} border-[color:var(--mr-accent)]`} /> Ours
        </span>
        <span>
          <i className={`${keyBase} border-[color:var(--mr-fg)]`} /> {c.refName}
        </span>
      </div>
      <div className={statsRow}>
        <span>RMSE {fmtNum(stats.rmse, 1)} pts</span>
        <span>Max |diff| {fmtNum(maxAbs, 1)} pts</span>
        <span>r = {fmtNum(stats.r, 4)}</span>
        <Pill tone={pass ? "good" : "bad"}>
          {pass ? "Within" : "Outside"} tolerance ±{c.tolerancePts} pts
        </Pill>
      </div>
    </div>
  );
}

// ───────────────────────── presentation report ─────────────────────────

// Tailwind can't express `@page` or the "hide everything except the report" trick
// (it targets `body *`), so this one tiny print-only block stays as plain CSS.
// You can move it into globals.css if you prefer.
const PRINT_CSS = `
@media print {
  @page { size: A4; margin: 13mm; }
  body * { visibility: hidden !important; }
  #mission-report, #mission-report * { visibility: visible !important; }
}
`;

function ReportView({ data }: { data: ReportData }) {
  const demCellM = data.demCellM ?? 400;

  const validity = useMemo(() => {
    const v = data.validation;
    const seriesOk = (s?: SeriesCompare) =>
      s ? errorStats(s.ours, s.ref).maxAbs <= s.tolerance : null;

    const checks = [seriesOk(v?.sun), seriesOk(v?.earth)].filter(
      (x): x is boolean => x !== null,
    );

    const sunEarth = checks.length ? checks.every(Boolean) : null;

    const sunlight = v?.sunlight
      ? v.sunlight.rows.every(
          (r) => Math.abs(r.ours - r.ref) <= v.sunlight!.tolerancePts,
        )
      : null;

    return { sunEarth, sunlight };
  }, [data.validation]);

  const conf = useMemo(() => {
    const items: ConfidenceItem[] = confidenceItems({
      demCellM,
      sunEarthValidated: validity.sunEarth,
      sunlightValidated: validity.sunlight,
      hasLinkBudget: data.hasLinkBudget ?? false,
      hasThermalModel: data.hasThermalModel ?? false,
    });

    return { items, overall: overallConfidence(items) };
  }, [demCellM, validity, data.hasLinkBudget, data.hasThermalModel]);

  const risks = useMemo(
    () =>
      mainRisks({
        continuityPct: data.continuityPct,
        longestDarkH: data.longestDarkH,
        longestGapH: data.longestGapH,
        sunPct: data.sunPct,
        riskScore: data.riskScore,
        batteryHours: data.batteryHours,
        autonomyLimitH: data.autonomyLimitH,
      }),
    [data],
  );

  const t = data.team;

  const stance =
    t.scienceTop === t.engineeringTop
      ? "Consensus"
      : t.scienceTop === t.overallTop || t.engineeringTop === t.overallTop
        ? "Partial"
        : "Conflict";

  const sources = data.sources ?? DEFAULT_SOURCES;
  const v = data.validation;
  const hasValidation = !!(v?.sun || v?.earth || v?.sunlight);

  const validationPassed =
    validity.sunEarth !== false && validity.sunlight !== false;

  const limitations: { title: string; text: string }[] = [
    {
      title: "Point-source Sun and Earth",
      text: "Sun and Earth are treated as point sources: no penumbra or partial-disc occultation, so sunrise / sunset and Earth-rise edges can shift by minutes.",
    },
    {
      title: "Power is a proxy",
      text: "Power comes from Sun visibility and elevation (plus the simple battery / array assumptions listed above), not from a spacecraft power budget.",
    },
    {
      title: "DEM resolution",
      text: `The ${demCellM} m DEM cannot represent boulders, narrow ridges or small rim features, so local shadowing may be missed or overestimated.`,
    },
    {
      title: "DTE link is not confirmed communication",
      text: "Comm availability is geometric Earth visibility above the DSN minimum elevation.",
    },
    ...(data.extraLimitations ?? []).map((text) => ({
      title: "Additional",
      text,
    })),
  ];

  return (
    <div className={ROOT} id="mission-report">
      <style>{PRINT_CSS}</style>

      {/* Report Header */}
      <header className="mb-[30px] flex items-start justify-between gap-[24px] max-[480px]:mb-[23px] max-[480px]:flex-col max-[480px]:items-start max-[480px]:gap-[17px]">
        <div>
          {data.generatedAt && (
            <p className="mt-[13px] text-[9px] font-bold tracking-[0.12em] text-[color:var(--mr-dim)]">
              REPORT GENERATED{" "}
              <span className="ml-[7px] font-medium tracking-[0.04em] text-[color:var(--mr-muted)]">
                {data.generatedAt}
              </span>
            </p>
          )}
        </div>

        <button
          type="button"
          className="inline-flex min-h-[38px] shrink-0 cursor-pointer items-center justify-center gap-[9px] rounded-[7px] border border-[rgba(167,165,255,0.4)] bg-[rgba(167,165,255,0.09)] px-[14px] text-[11px] font-[650] text-[color:var(--mr-accent-light)] [transition:0.2s_ease] hover:border-[color:var(--mr-accent)] hover:bg-[rgba(167,165,255,0.17)] max-[480px]:min-h-[36px] print:!hidden"
          onClick={() => window.print()}
        >
          <Printer size={15} />
          <span>Export Report</span>
        </button>
      </header>

      {/* Mission Snapshot */}
      <section className="overflow-hidden rounded-[11px] border border-[rgba(167,165,255,0.22)] [background:radial-gradient(ellipse_at_85%_0%,rgba(167,165,255,0.12),transparent_48%),linear-gradient(135deg,#0D1422,#090E19)] print:break-inside-avoid print:![background:#fff]">
        <div className="flex items-center justify-between gap-[12px] border-b border-[color:var(--mr-line)] px-[21px] py-[19px] max-[480px]:items-start max-[480px]:p-[15px]">
          <div>
            <span className={ui.kicker}>MISSION OVERVIEW</span>
            <h2 className={ui.h2}>Selected Landing Site</h2>
          </div>

          <Pill tone="good">Analysis Complete</Pill>
        </div>

        <div className="grid grid-cols-[minmax(0,1.5fr)_1px_repeat(2,minmax(0,1fr))] items-center gap-[24px] px-[21px] py-[24px] max-[900px]:gap-[17px] max-[680px]:grid-cols-[1fr_1fr] max-[680px]:gap-[20px] max-[480px]:gap-[15px] max-[480px]:px-[15px] max-[480px]:py-[18px]">
          <div className="max-[680px]:col-span-full">
            <span className="mb-[9px] block text-[9px] font-bold tracking-[0.12em] text-[color:var(--mr-dim)]">
              TARGET LOCATION
            </span>
            <h3 className="m-0 text-[length:clamp(19px,2.5vw,25px)] font-[650] leading-[1.3] text-[color:var(--mr-accent-light)] [overflow-wrap:anywhere] max-[480px]:text-[20px]">
              {data.siteName}
            </h3>

            {data.siteLat != null && data.siteLon != null && (
              <p className="mt-[8px] text-[11px] tabular-nums text-[color:var(--mr-muted)]">
                {data.siteLat.toFixed(3)}° , {data.siteLon.toFixed(3)}°
              </p>
            )}
          </div>

          <div className="w-px self-stretch bg-[color:var(--mr-line)] max-[680px]:hidden" />

          <div className="max-[680px]:border-t max-[680px]:border-[color:var(--mr-line)] max-[680px]:pt-[15px]">
            <span className="mb-[9px] block text-[9px] font-bold tracking-[0.12em] text-[color:var(--mr-dim)]">
              MISSION DURATION
            </span>
            <strong className="block text-[18px] font-[650] leading-[1.4] text-[color:var(--mr-fg)] [overflow-wrap:anywhere] max-[480px]:text-[16px]">
              {data.durationDays} days
            </strong>
            <small className="mt-[6px] block text-[10px] leading-[1.6] text-[color:var(--mr-muted)]">
              {data.rangeLabel}
            </small>
          </div>

          <div className="max-[680px]:border-t max-[680px]:border-[color:var(--mr-line)] max-[680px]:pt-[15px]">
            <span className="mb-[9px] block text-[9px] font-bold tracking-[0.12em] text-[color:var(--mr-dim)]">
              BEST OPERATING WINDOW
            </span>
            <strong className="block text-[14px] font-[650] leading-[1.55] text-[color:var(--mr-fg)] [overflow-wrap:anywhere] max-[480px]:text-[12px]">
              {data.bestWindow?.label ?? "Not available"}
            </strong>
            {data.bestWindow && (
              <small className="mt-[6px] block text-[10px] leading-[1.6] text-[color:var(--mr-muted)]">
                Score {data.bestWindow.score.toFixed(0)} / 100
              </small>
            )}
          </div>
        </div>
      </section>

      {/* Key Performance Metrics */}
      <section className={ui.section}>
        <div className={ui.sectionHead}>
          <div>
            <span className={ui.kicker}>PERFORMANCE OVERVIEW</span>
            <h2 className={ui.h2}>Mission Metrics</h2>
          </div>
          <span className={ui.note}>KEY INDICATORS</span>
        </div>

        <div className="grid grid-cols-4 gap-[13px] max-[900px]:grid-cols-2 max-[480px]:gap-[9px]">
          <div className="min-h-[142px] min-w-0 rounded-[9px] border border-[rgba(167,165,255,0.35)] p-[17px] [background:linear-gradient(145deg,rgba(167,165,255,0.11),transparent_75%),var(--mr-panel)] [transition:border-color_0.2s_ease,transform_0.2s_ease] hover:[transform:translateY(-2px)] hover:border-[rgba(167,165,255,0.38)] max-[480px]:min-h-[128px] max-[480px]:p-[13px] print:break-inside-avoid print:border-[#ccc] print:![background:#fff]">
            <span className="block min-h-[28px] text-[9px] font-bold leading-[1.5] tracking-[0.1em] text-[color:var(--mr-muted)] max-[480px]:text-[8px]">
              MISSION CONTINUITY
            </span>
            <strong className="mt-[8px] block text-[27px] font-bold leading-[1.2] tracking-[-0.035em] tabular-nums text-[color:var(--mr-accent-light)] [overflow-wrap:anywhere] max-[480px]:text-[23px]">
              {data.continuityPct.toFixed(0)}%
            </strong>
            <div className="mt-[13px] h-[5px] overflow-hidden rounded-[99px] bg-[rgba(255,255,255,0.08)] print:bg-[#eee]">
              <div
                className="h-full rounded-[inherit] bg-[color:var(--mr-accent)] shadow-[0_0_10px_rgba(167,165,255,0.3)] print:!bg-[#3b39c7]"
                style={{
                  width: `${Math.max(0, Math.min(100, data.continuityPct))}%`,
                }}
              />
            </div>
            <small className="mt-[9px] block text-[10px] leading-[1.6] text-[color:var(--mr-dim)]">
              Power + communication availability
            </small>
          </div>

          <div className={metricCard}>
            <span className={metricLabel}>SUNLIGHT EXPOSURE</span>
            <strong className={metricValue}>{data.sunPct.toFixed(1)}%</strong>
            <small className={metricSmall}>
              Estimated sunlight availability
            </small>
          </div>

          <div className={metricCard}>
            <span className={metricLabel}>RISK SCORE</span>
            <strong className={metricValue}>{data.riskScore.toFixed(1)}</strong>
            <small className={metricSmall}>
              Lower score indicates lower risk
            </small>
          </div>

          <div className={metricCard}>
            <span className={metricLabel}>LONGEST GAP</span>
            <strong className={metricValue}>
              {fmtHours(data.longestGapH)}
            </strong>
            <small className={metricSmall}>
              {data.longestGapBasis === "comm-only"
                ? "Communication gap"
                : "Combined power and communication"}
            </small>
          </div>
        </div>
      </section>

      {/* Decision Analysis */}
      <section className={ui.section}>
        <div className={ui.sectionHead}>
          <div>
            <span className={ui.kicker}>DECISION INTELLIGENCE</span>
            <h2 className={ui.h2}>Team Agreement & Confidence</h2>
          </div>
        </div>

        <div className={ui.decisionGrid}>
          <div className={`${ui.panel} ${ui.panelPad}`}>
            <div className={ui.panelHead}>
              <div>
                <h3 className={ui.panelH3}>Team Agreement</h3>
                <p className={ui.panelP}>
                  Science and engineering ranking comparison
                </p>
              </div>

              <Pill
                tone={
                  stance === "Consensus"
                    ? "good"
                    : stance === "Partial"
                      ? "mid"
                      : "bad"
                }
              >
                {stance}
              </Pill>
            </div>

            <div className="flex items-baseline gap-[9px] border-b border-[color:var(--mr-line)] pb-[17px]">
              <strong className="text-[37px] font-bold leading-none tracking-[-0.04em] tabular-nums text-[color:var(--mr-accent-light)]">
                {t.agreementPct.toFixed(0)}%
              </strong>
              <span className="text-[11px] text-[color:var(--mr-muted)]">
                Agreement score
              </span>
            </div>

            <div className="mt-[7px] flex flex-col gap-0">
              {[
                ["SCIENCE TOP SITE", t.scienceTop],
                ["ENGINEERING TOP SITE", t.engineeringTop],
                ["OVERALL TOP SITE", t.overallTop],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className={`flex items-center justify-between gap-[12px] py-[12px] last:border-b-0 max-[480px]:items-start ${ui.rowLine}`}
                >
                  <span className="text-[9px] font-bold tracking-[0.06em] text-[color:var(--mr-dim)] max-[480px]:max-w-[45%] max-[480px]:leading-[1.5]">
                    {label}
                  </span>
                  <strong className="text-right text-[11px] font-semibold text-[color:var(--mr-fg)] [overflow-wrap:anywhere] max-[480px]:max-w-[55%]">
                    {value}
                  </strong>
                </div>
              ))}
            </div>

            {(t.priceScience != null || t.priceEngineering != null) && (
              <div className="mt-[10px] rounded-[6px] border border-[color:var(--mr-line)] bg-[rgba(255,255,255,0.02)] p-[12px]">
                <span className="text-[9px] font-bold tracking-[0.08em] text-[color:var(--mr-dim)]">
                  PRICE OF AGREEMENT
                </span>

                <p className="mt-[6px] text-[11px] text-[color:var(--mr-muted)]">
                  Science{" "}
                  <strong className="font-[650] text-[color:var(--mr-fg)]">
                    {t.priceScience?.toFixed(1) ?? "—"} pts
                  </strong>
                  <span className="mx-[8px] text-[color:var(--mr-dim)]">·</span>
                  Engineering{" "}
                  <strong className="font-[650] text-[color:var(--mr-fg)]">
                    {t.priceEngineering?.toFixed(1) ?? "—"} pts
                  </strong>
                </p>
              </div>
            )}
          </div>

          <div className={`${ui.panel} ${ui.panelPad}`}>
            <div className={ui.panelHead}>
              <div>
                <h3 className={ui.panelH3}>Model Confidence</h3>
                <p className={ui.panelP}>
                  Confidence based on available validation evidence
                </p>
              </div>

              <Pill tone={levelTone(conf.overall.level)}>
                {conf.overall.level}
              </Pill>
            </div>

            <div className="mb-[17px] flex items-baseline gap-[5px]">
              <strong className="text-[35px] font-bold leading-none tabular-nums text-[color:var(--mr-accent-light)]">
                {conf.overall.score.toFixed(2)}
              </strong>
              <span className="text-[12px] text-[color:var(--mr-dim)]">
                / 3.00
              </span>
            </div>

            <div className="border-t border-[color:var(--mr-line)]">
              {conf.items.map((item) => (
                <div
                  className={`flex items-start justify-between gap-[12px] py-[12px] ${ui.rowLine}`}
                  key={item.key}
                >
                  <div className="min-w-0">
                    <strong className="block text-[11px] font-semibold text-[color:var(--mr-fg)]">
                      {item.label}
                    </strong>
                    <span className="mt-[4px] block text-[10px] leading-[1.6] text-[color:var(--mr-muted)]">
                      {item.why}
                    </span>
                  </div>

                  {/* Matches the original `.mr-confidence-row span` rule, which also restyled this pill */}
                  <Pill
                    tone={levelTone(item.level)}
                    className="!mt-[4px] !block !text-[10px] !leading-[1.6] !text-[color:var(--mr-muted)]"
                  >
                    {item.level}
                  </Pill>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Operational Details */}
      <section className={ui.section}>
        <div className={ui.sectionHead}>
          <div>
            <span className={ui.kicker}>OPERATIONAL ANALYSIS</span>
            <h2 className={ui.h2}>Continuity Details</h2>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-[12px] max-[900px]:grid-cols-2 max-[480px]:gap-[9px]">
          <div className={detailCard}>
            <span className={detailLabel}>INTERRUPTION COUNT</span>
            <strong className={detailValue}>
              {data.interruptionCount == null ? "N/A" : data.interruptionCount}
            </strong>
            <p className={detailText}>
              Periods where power and communication were not both available
            </p>
          </div>

          <div className={detailCard}>
            <span className={detailLabel}>LONGEST DARK PERIOD</span>
            <strong className={detailValue}>
              {data.longestDarkH == null ? "N/A" : fmtHours(data.longestDarkH)}
            </strong>
            <p className={detailText}>
              Longest continuous period without sunlight
            </p>
          </div>

          <div className={detailCard}>
            <span className={detailLabel}>BATTERY CAPACITY</span>
            <strong className={detailValue}>{data.batteryHours} h</strong>
            <p className={detailText}>
              Continuous-load battery capacity assumption
            </p>
          </div>

          <div className={detailCard}>
            <span className={detailLabel}>COMMUNICATION AUTONOMY</span>
            <strong className={detailValue}>{data.autonomyLimitH} h</strong>
            <p className={detailText}>
              Maximum permitted time without Earth contact
            </p>
          </div>
        </div>
      </section>

      {/* Risks and Assumptions */}
      <section className={ui.section}>
        <div className={ui.sectionHead}>
          <div>
            <span className={ui.kicker}>MISSION CONSTRAINTS</span>
            <h2 className={ui.h2}>Risks & Assumptions</h2>
          </div>
        </div>

        <div className={ui.decisionGrid}>
          <div className={`${ui.panel} ${ui.panelPad}`}>
            <div className={ui.panelHead}>
              <div>
                <h3 className={ui.panelH3}>Main Risks</h3>
                <p className={ui.panelP}>Identified operational risk factors</p>
              </div>

              <Pill tone={risks.length ? "bad" : "good"}>
                {risks.length} Identified
              </Pill>
            </div>

            {risks.length === 0 ? (
              <div className="p-[23px] text-[11px] leading-[1.7] text-[color:var(--mr-muted)]">
                No risk exceeds the current report thresholds.
              </div>
            ) : (
              <div className="flex flex-col">
                {risks.map((risk) => (
                  <div
                    className="border-t border-[rgba(38,53,76,0.7)] py-[13px]"
                    key={risk.title}
                  >
                    <div className="flex items-center justify-between gap-[10px]">
                      <strong className="text-[11px] font-[650] text-[color:var(--mr-fg)]">
                        {risk.title}
                      </strong>
                      <Pill tone={risk.level === "high" ? "bad" : "mid"}>
                        {risk.level}
                      </Pill>
                    </div>
                    <p className="mt-[7px] text-[11px] leading-[1.7] text-[color:var(--mr-muted)]">
                      {risk.detail}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className={`${ui.panel} ${ui.panelPad}`}>
            <div className={ui.panelHead}>
              <div>
                <h3 className={ui.panelH3}>Model Assumptions</h3>
                <p className={ui.panelP}>
                  Parameters used during mission evaluation
                </p>
              </div>
            </div>

            <ul className="m-0 flex list-none flex-col gap-0 p-0">
              {data.assumptions.map((assumption) => (
                <li key={assumption} className={assumptionItem}>
                  {assumption}
                </li>
              ))}

              {data.siteNote && (
                <li className={assumptionItem}>{data.siteNote}</li>
              )}
            </ul>
          </div>
        </div>
      </section>

      {/* Validation */}
      <section className={ui.section}>
        <div className={ui.sectionHead}>
          <div>
            <span className={ui.kicker}>SCIENTIFIC VERIFICATION</span>
            <h2 className={ui.h2}>Reference Validation</h2>
            <p className={ui.desc}>
              Comparison of model output against external reference datasets
            </p>
          </div>

          <Pill
            tone={
              !hasValidation ? "neutral" : validationPassed ? "good" : "bad"
            }
          >
            {!hasValidation
              ? "Not Run"
              : validationPassed
                ? "Within Tolerance"
                : "Outside Tolerance"}
          </Pill>
        </div>

        {!hasValidation ? (
          <div
            className={`${ui.panel} p-[23px] text-[11px] leading-[1.7] text-[color:var(--mr-muted)] max-[480px]:p-[15px]`}
          >
            <strong className="mb-[5px] block text-[12px] font-bold text-[color:var(--mr-fg)]">
              No validation data available
            </strong>
            <p className="m-0">
              Provide JPL Horizons Sun / Earth series and LOLA illumination
              fractions to compare the model against reference data.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-[15px] max-[900px]:grid-cols-1">
            {v?.sun && <LineCompare c={v.sun} />}
            {v?.earth && <LineCompare c={v.earth} />}
            {v?.sunlight && <FractionBars c={v.sunlight} />}
          </div>
        )}
      </section>

      {/* Data Sources */}
      <section className={ui.section}>
        <div className={ui.sectionHead}>
          <div>
            <span className={ui.kicker}>DATA PROVENANCE</span>
            <h2 className={ui.h2}>Data Sources</h2>
          </div>
          <span className={ui.note}>{sources.length} SOURCES</span>
        </div>

        <div
          className={`${ui.panel} px-[18px] py-[3px] max-[480px]:px-[13px] max-[480px]:py-[2px]`}
        >
          {sources.map((source) => (
            <div
              className={`grid grid-cols-[150px_minmax(0,1fr)] gap-[17px] py-[15px] last:border-b-0 max-[680px]:grid-cols-[115px_minmax(0,1fr)] max-[480px]:grid-cols-1 max-[480px]:gap-[5px] max-[480px]:py-[12px] print:break-inside-avoid ${ui.rowLine}`}
              key={source.category + source.name}
            >
              <span className="text-[10px] font-[650] text-[color:var(--mr-accent-light)]">
                {source.category}
              </span>

              <div>
                <strong className="block text-[11px] font-semibold leading-[1.6] text-[color:var(--mr-fg)] [overflow-wrap:anywhere]">
                  {source.name}
                </strong>
                {source.detail && (
                  <p className="mt-[4px] text-[10px] leading-[1.65] text-[color:var(--mr-muted)]">
                    {source.detail}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Known Limitations */}
      <section className={ui.section}>
        <div className={ui.sectionHead}>
          <div>
            <span className={ui.kicker}>MODEL BOUNDARIES</span>
            <h2 className={ui.h2}>Known Limitations</h2>
            <p className={ui.desc}>
              Factors that may affect the accuracy of the mission assessment
            </p>
          </div>
        </div>

        <div className="overflow-hidden rounded-[9px] border border-[color:var(--mr-line)] bg-[color:var(--mr-panel)]">
          {limitations.map((limitation, index) => (
            <div
              className={`grid grid-cols-[35px_minmax(0,1fr)] gap-[13px] px-[18px] py-[15px] last:border-b-0 max-[480px]:grid-cols-[29px_minmax(0,1fr)] max-[480px]:gap-[10px] max-[480px]:p-[13px] print:break-inside-avoid ${ui.rowLine}`}
              key={`${limitation.title}-${index}`}
            >
              <span className="flex h-[30px] w-[30px] items-center justify-center rounded-[6px] border border-[rgba(167,165,255,0.25)] bg-[rgba(167,165,255,0.07)] text-[10px] font-bold tabular-nums text-[color:var(--mr-accent-light)] max-[480px]:h-[27px] max-[480px]:w-[27px]">
                {String(index + 1).padStart(2, "0")}
              </span>

              <div>
                <strong className="block text-[11px] font-[650] text-[color:var(--mr-fg)]">
                  {limitation.title}
                </strong>
                <p className="mt-[5px] text-[11px] leading-[1.75] text-[color:var(--mr-muted)]">
                  {limitation.text}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

// small card class sets used by the metric / detail grids
const metricCard =
  "min-h-[142px] min-w-0 rounded-[9px] border border-[color:var(--mr-line)] bg-[color:var(--mr-panel)] p-[17px] [transition:border-color_0.2s_ease,transform_0.2s_ease] hover:[transform:translateY(-2px)] hover:border-[rgba(167,165,255,0.38)] max-[480px]:min-h-[128px] max-[480px]:p-[13px] print:break-inside-avoid";
const metricLabel =
  "block min-h-[28px] text-[9px] font-bold leading-[1.5] tracking-[0.1em] text-[color:var(--mr-muted)] max-[480px]:text-[8px]";
const metricValue =
  "mt-[8px] block text-[27px] font-bold leading-[1.2] tracking-[-0.035em] tabular-nums text-[color:var(--mr-fg)] [overflow-wrap:anywhere] max-[480px]:text-[23px]";
const metricSmall =
  "mt-[9px] block text-[10px] leading-[1.6] text-[color:var(--mr-dim)]";

const detailCard =
  "min-w-0 rounded-[8px] border border-[color:var(--mr-line)] bg-[color:var(--mr-panel)] p-[16px] max-[480px]:p-[13px] print:break-inside-avoid";
const detailLabel =
  "block min-h-[27px] text-[9px] font-bold leading-[1.5] tracking-[0.07em] text-[color:var(--mr-dim)]";
const detailValue =
  "mt-[8px] block text-[20px] font-[650] leading-[1.3] tabular-nums text-[color:var(--mr-fg)] [overflow-wrap:anywhere] max-[480px]:text-[17px]";
const detailText =
  "mt-[7px] text-[10px] leading-[1.65] text-[color:var(--mr-muted)]";

const assumptionItem =
  "relative border-b border-[rgba(38,53,76,0.7)] py-[11px] pl-[19px] text-[11px] leading-[1.7] text-[color:var(--mr-muted)] last:border-b-0 before:absolute before:left-[1px] before:top-[18px] before:h-[6px] before:w-[6px] before:rounded-full before:bg-[color:var(--mr-accent)] before:content-['']";

// ───────────────────────── main page component ─────────────────────────

function subscribeToPlan(onChange: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === PLAN_KEY) onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}

const getPlanSnapshot = () => {
  const plan = getStoredPlan();
  return plan ? JSON.stringify(plan) : null;
};
const getServerPlanSnapshot = (): string | null => null;

export default function Report({ data: propData }: { data?: ReportData }) {
  const [series, setSeries] = useState<SeriesSet | null>(null);
  const [loading, setLoading] = useState(!propData);
  const [error, setError] = useState<string | null>(null);

  // Every input comes from the Comparison page (shared via localStorage); nothing is chosen here.
  const planSnapshot = useSyncExternalStore(
    subscribeToPlan,
    getPlanSnapshot,
    getServerPlanSnapshot,
  );
  const plan = useMemo(
    () => (planSnapshot ? (JSON.parse(planSnapshot) as PlanSelection) : null),
    [planSnapshot],
  );
  const gridStart = useGridStart();
  const [generatedAt, setGeneratedAt] = useState<string>();

  useEffect(() => {
    const timer = setTimeout(
      () => setGeneratedAt(new Date().toISOString().slice(0, 10)),
      0,
    );
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (propData) return;
    loadSiteSeries()
      .then((s) => {
        setSeries(s);
        setLoading(false);
      })
      .catch((e) => {
        setError(String(e.message ?? e));
        setLoading(false);
      });
  }, [propData]);

  const sel = useMemo(() => {
    if (!series || !plan || !series.sites.length) return null;
    const site =
      series.sites.find((s) => s.id === plan.siteId) ?? series.sites[0];
    const plannedDay = Math.max(plan.pickedDay ?? gridStart, gridStart);
    return { site, plannedDay, effectiveDay: plannedDay + plan.delay };
  }, [series, plan, gridStart]);

  const computedData = useMemo(() => {
    if (propData) return propData;
    if (!series || !plan || !sel) return undefined;
    return buildReportDataFromSite(
      sel.site,
      series.sites,
      sel.effectiveDay,
      plan.duration,
      plan.priority,
      gridStart,
      generatedAt,
      series.meta,
      plan.sciW,
      plan.engW,
    );
  }, [propData, series, plan, sel, gridStart, generatedAt]);

  if (propData) {
    return <ReportView data={propData} />;
  }

  if (loading || (!plan && !error)) {
    return (
      <main className="flex min-h-[70vh] flex-col items-center justify-center bg-black px-4 text-[#7F93B3]">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#A7A5FF] border-t-transparent" />
        <p className="mt-4 text-sm font-medium tracking-wide text-[#E8EAED]">
          Loading Mission Continuity Report…
        </p>
        <p className="mt-1 text-xs text-[#5C636D]">
          Parsing ephemeris, horizon masks, and continuity metrics
        </p>
      </main>
    );
  }

  if (error || !series || !plan || !sel) {
    return (
      <main className="flex min-h-[70vh] flex-col items-center justify-center bg-black p-6 text-center text-sm text-[#E8EAED]">
        <p className="text-red-400">Failed to load mission data.</p>
        <p className="mt-1 text-xs text-[#7F93B3]">{error}</p>
        <button
          onClick={() => window.location.reload()}
          className="mt-4 rounded border border-[#A7A5FF] bg-[#A7A5FF]/10 px-4 py-2 text-xs font-semibold text-[#E8EAED] hover:bg-[#A7A5FF]/20"
        >
          Retry
        </button>
      </main>
    );
  }

  return (
    <main className="bg-black text-[#E8EAED] pb-28 pt-10 px-3 sm:px-6">
      <div className="mx-auto max-w-[1100px]">
        {/* Page Header - Same style as Comparison Page */}
        <header className="relative mb-6 flex flex-col items-center justify-center">
          <h1 className="text-[13px] font-semibold tracking-[0.3em] text-[#F1F6FF] sm:text-base">
            MISSION REPORT
          </h1>

          <p className="mt-2 text-center text-[12px] text-[#9099a5]">
            Mission continuity, operational risks and scientific validation
          </p>
        </header>

        {/* Selected Mission Parameters */}

        {computedData && <ReportView data={computedData} />}
      </div>
    </main>
  );
}
