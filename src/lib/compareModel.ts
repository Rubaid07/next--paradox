/**
 * Comparison model for the Site × Date planner.
 *
 * ALL site numbers now come from one computed dataset, /data/site_series.json, built by
 * scripts/compute_site_series.py:
 *   - JPL DE421 Sun / Earth positions + lunar libration (ME frame)
 *   - per-site horizon mask ray-marched through the 400 m LOLA DEM (heightmap_1520.f32)
 *   - Earth line-of-sight and DSN (Goldstone / Canberra / Madrid) visibility
 *   - terrain elevation, 5 km relief and slope from the same DEM for every site
 * Hourly samples, 2026-11-10 → 2028-12-31. No placeholder values remain.
 *
 * Remaining MODEL ASSUMPTIONS (not data) are the named constants below.
 */

export type Priority = "power" | "comms" | "balance";
export type HeatMetric = "score" | "sun" | "power" | "comms" | "risk";

export const DATA_START_MS = Date.UTC(2026, 10, 10);
export const DATA_DAYS = 783; // 2026-11-10 … 2028-12-31 inclusive
export const SAMPLES_PER_DAY = 24; // hourly
export const GRID_STEP_DAYS = 3;
export const GRID_COLS = 14;
export const MAX_DELAY = 30;
export const SCAN_DAYS = 60;
export const SAFE_DELAY_TOLERANCE = 8; // score points
export const REGION_RADIUS_KM = 150;
const MAX_DURATION_DAYS = 30; // longest window the UI offers
const DAY_MS = 86_400_000;
const MOON_R_KM = 1737.4;

/* ── power model assumptions ── */
export const GEN_TO_LOAD = 2.0; // array output at full sun = 2 × the lander's continuous load
export const BATTERY_HOURS = 24; // battery capacity, in hours of continuous load
/* ── continuity / risk scales (scale caps, not measurements) ── */
export const AUTONOMY_LIMIT_H = 72; // "Mission Continuity" = powered AND last Earth contact ≤ this many hours ago
export const DARK_LIMIT_H = 336; // 14 d = a full lunar night; darkness risk saturates here
export const GAP_RISK_H = 120; // comm-gap risk saturates at 5 days
export const SLOPE_LIMIT_DEG = 20; // mean 400 m-baseline slope that gives full slope risk
const RUN_CAP_H = 999;

export const PRIORITY_WEIGHTS: Record<Priority, [number, number, number]> = {
  power: [0.6, 0.25, 0.15],
  comms: [0.25, 0.6, 0.15],
  balance: [0.4, 0.4, 0.2],
};
export const PRIORITY_LABEL: Record<Priority, string> = {
  power: "Power First",
  comms: "Comm First",
  balance: "Balance",
};

/* ───────────── data ───────────── */

export interface SiteData {
  id: string;
  name: string;
  lat: number;
  lon: number;
  analysisNote: string;
  elevationM: number;
  reliefM: number; // max − min within 5 km (400 m DEM)
  slopeMeanDeg: number;
  sun: Uint8Array; // 0..15 = visible fraction of the solar disk
  earth: Uint8Array; // Earth above the horizon mask
  dte: Uint8Array; // Earth visible AND a DSN complex sees the Moon
  darkRun: Uint16Array; // length (h) of the no-sun run each sample belongs to (0 if lit)
  gapRun: Uint16Array; // length (h) of the no-DTE run each sample belongs to (0 if link up)
  sinceLink: Uint16Array; // hours since the last DTE sample (0 while the link is up)
}

export interface SeriesSet {
  n: number;
  sites: SiteData[];
  meta: { dsn_min_elev_deg: number; mast_m: number; ephemeris: string; dem: string };
}

interface RawSite {
  id: string;
  name: string;
  lat: number;
  lon: number;
  analysis?: { method?: string } | null;
  elevation_m: number;
  relief_m: number;
  slope_mean_deg: number;
  sun: string;
  earth: string;
  dte: string;
}

interface RawSeries {
  meta: SeriesSet["meta"] & { samples: number };
  sites: RawSite[];
}

function runLengths(on: (i: number) => boolean, n: number): Uint16Array {
  const out = new Uint16Array(n);
  let i = 0;
  while (i < n) {
    if (on(i)) {
      i++;
      continue;
    }
    let j = i;
    while (j < n && !on(j)) j++;
    const len = Math.min(RUN_CAP_H, j - i);
    for (let k = i; k < j; k++) out[k] = len;
    i = j;
  }
  return out;
}

function hoursSinceLink(dte: Uint8Array): Uint16Array {
  const out = new Uint16Array(dte.length);
  let since = RUN_CAP_H; // no contact before the series starts
  for (let i = 0; i < dte.length; i++) {
    since = dte[i] ? 0 : Math.min(RUN_CAP_H, since + 1);
    out[i] = since;
  }
  return out;
}

export function parseSeries(raw: RawSeries): SeriesSet {
  const n: number = raw.meta.samples;
  const sites: SiteData[] = raw.sites.map((s) => {
    const sun = Uint8Array.from(s.sun as string, (c) => parseInt(c, 16));
    const earth = Uint8Array.from(s.earth as string, (c) => (c === "1" ? 1 : 0));
    const dte = Uint8Array.from(s.dte as string, (c) => (c === "1" ? 1 : 0));
    return {
      id: s.id,
      name: s.name,
      lat: s.lat,
      lon: s.lon,
      analysisNote: s.analysis?.method ?? "",
      elevationM: s.elevation_m,
      reliefM: s.relief_m,
      slopeMeanDeg: s.slope_mean_deg,
      sun,
      earth,
      dte,
      darkRun: runLengths((i) => sun[i] >= 8, n),
      gapRun: runLengths((i) => dte[i] === 1, n),
      sinceLink: hoursSinceLink(dte),
    };
  });
  return { n, sites, meta: raw.meta };
}

export async function loadSiteSeries(): Promise<SeriesSet> {
  const res = await fetch("/data/site_series.json", { cache: "force-cache" });
  if (!res.ok) throw new Error(`/data/site_series.json returned ${res.status}`);
  return parseSeries(await res.json());
}

/* ───────────── dates ───────────── */

/**
 * First heatmap day (days since 2026-11-10) = today in UTC. Past dates drop off and new ones appear
 * every day. Clamped so the whole grid + delay + longest window stays inside the dataset.
 */
export function gridStartDay(now: number): number {
  const today = Math.floor((now - DATA_START_MS) / DAY_MS);
  const lastStart = DATA_DAYS - 1 - (GRID_COLS - 1) * GRID_STEP_DAYS - MAX_DELAY - MAX_DURATION_DAYS;
  return Math.max(0, Math.min(today, lastStart));
}

export function dayToDate(day: number): Date {
  return new Date(DATA_START_MS + day * DAY_MS);
}
export function fmtDay(day: number): string {
  return dayToDate(day).toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" });
}
export function fmtRange(day: number, duration: number): string {
  return `${fmtDay(day)} – ${fmtDay(day + duration)}`;
}
/** Day of heatmap column `col`. Pass `start` (from useGridStart) so a render uses one consistent value. */
export function gridDay(col: number, start: number): number {
  return start + col * GRID_STEP_DAYS;
}
export function fmtHours(h: number): string {
  return h >= RUN_CAP_H ? `>${RUN_CAP_H} h` : `${h.toFixed(0)} h`;
}

/* ───────────── metrics ───────────── */

export interface CellMetrics {
  sun: number; // % of window with the Sun centre above the terrain horizon (geometric illumination)
  powerAvail: number; // % of window the lander is powered (sunlight + battery ride-through)
  earth: number; // % of window with Earth above the horizon mask
  commAvail: number; // % of window with a usable DTE link (Earth LOS + DSN)
  commHours: number; // usable DTE hours per day
  overlap: number; // % of window powered AND link up at the same time
  continuity: number; // % of window powered with Earth contact within the last AUTONOMY_LIMIT_H hours
  longestCommGapH: number;
  longestDarkH: number;
  slopeMeanDeg: number;
  risk: number; // 0-100, lower is better
  power: number; // score input = powerAvail
  comms: number; // score input = commAvail
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Evaluate one site over a window that starts `startDay` days after 2026-11-10. */
export function evaluate(site: SiteData, startDay: number, days: number): CellMetrics {
  const total = days * SAMPLES_PER_DAY;
  const k0 = Math.max(0, Math.min(startDay * SAMPLES_PER_DAY, site.sun.length - total));

  let sunCount = 0;
  let powered = 0;
  let earthCount = 0;
  let dteCount = 0;
  let both = 0;
  let cont = 0;
  let longestGap = 0;
  let longestDark = 0;
  let soc = BATTERY_HOURS; // mission starts with a full battery

  for (let k = 0; k < total; k++) {
    const i = k0 + k;
    const frac = site.sun[i] / 15;
    if (site.sun[i] >= 8) sunCount++;
    if (site.earth[i]) earthCount++;

    soc = Math.min(BATTERY_HOURS, soc + GEN_TO_LOAD * frac - 1); // 1 h step, load = 1
    let on = true;
    if (soc < 0) {
      soc = 0;
      on = false;
    }
    if (on) powered++;

    const link = site.dte[i] === 1;
    if (link) dteCount++;
    if (on && link) both++;
    if (on && site.sinceLink[i] <= AUTONOMY_LIMIT_H) cont++;
    if (site.gapRun[i] > longestGap) longestGap = site.gapRun[i];
    if (site.darkRun[i] > longestDark) longestDark = site.darkRun[i];
  }

  const pct = (c: number) => (c / total) * 100;
  const commAvail = pct(dteCount);
  const powerAvail = pct(powered);
  const slopeRisk = clamp01(site.slopeMeanDeg / SLOPE_LIMIT_DEG);
  const darkRisk = clamp01(longestDark / DARK_LIMIT_H);
  const commRisk = 1 - commAvail / 100;
  const gapRisk = clamp01(longestGap / GAP_RISK_H);

  return {
    sun: pct(sunCount),
    powerAvail,
    earth: pct(earthCount),
    commAvail,
    commHours: (commAvail / 100) * 24,
    overlap: pct(both),
    continuity: pct(cont),
    longestCommGapH: longestGap,
    longestDarkH: longestDark,
    slopeMeanDeg: site.slopeMeanDeg,
    risk: 100 * (0.3 * slopeRisk + 0.3 * darkRisk + 0.2 * commRisk + 0.2 * gapRisk),
    power: powerAvail,
    comms: commAvail,
  };
}

export interface Components {
  power: number;
  comms: number;
  safety: number;
}

/** Overall score = wP × Power Availability + wC × Comm Availability + wR × (100 − Risk). */
export function components(m: CellMetrics, p: Priority): Components {
  const [wp, wc, wr] = PRIORITY_WEIGHTS[p];
  return { power: wp * m.power, comms: wc * m.comms, safety: wr * (100 - m.risk) };
}

export function scoreOf(m: CellMetrics, p: Priority): number {
  const c = components(m, p);
  return c.power + c.comms + c.safety;
}

export function scoreBreakdown(m: CellMetrics, p: Priority): string {
  const [wp, wc, wr] = PRIORITY_WEIGHTS[p];
  const c = components(m, p);
  return `${wp}×Power ${m.power.toFixed(0)} = ${c.power.toFixed(1)}  +  ${wc}×Comm ${m.comms.toFixed(0)} = ${c.comms.toFixed(1)}  +  ${wr}×(100−Risk ${m.risk.toFixed(0)}) = ${c.safety.toFixed(1)}`;
}

/** One ranking rule for every list: compare the displayed (rounded) score, then lower risk, then name. */
export function rankCmp(
  a: { score: number; risk: number; name: string },
  b: { score: number; risk: number; name: string },
): number {
  return Math.round(b.score) - Math.round(a.score) || a.risk - b.risk || a.name.localeCompare(b.name);
}

export function fmtDelta(a: number, b: number): string {
  const d = Math.round(a) - Math.round(b);
  return d > 0 ? `+${d}` : `${d}`;
}

export function metricValue(m: CellMetrics, metric: HeatMetric, p: Priority): number {
  return metric === "score" ? scoreOf(m, p) : m[metric];
}

/* ───────────── geography ───────────── */

export function distanceKm(a: SiteData, b: SiteData): number {
  const r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r;
  const dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * MOON_R_KM * Math.asin(Math.sqrt(h));
}

export function neighbours(site: SiteData, all: SiteData[]): SiteData[] {
  return all.filter((s) => s.id !== site.id && distanceKm(site, s) <= REGION_RADIUS_KM);
}

/* ───────────── Best Window Finder ───────────── */

export interface WindowHit {
  day: number;
  score: number;
  m: CellMetrics;
}

/** Scores every start day from today (UTC) for the next SCAN_DAYS days. */
export function scanWindows(site: SiteData, duration: number, p: Priority, startDay: number): WindowHit[] {
  const out: WindowHit[] = [];
  for (let d = startDay; d < startDay + SCAN_DAYS; d++) {
    const m = evaluate(site, d, duration);
    out.push({ day: d, score: scoreOf(m, p), m });
  }
  return out;
}

/** Top N windows at least `gap` days apart. */
export function topWindows(hits: WindowHit[], n = 3, gap = 4): WindowHit[] {
  const sorted = [...hits].sort((a, b) => b.score - a.score);
  const picked: WindowHit[] = [];
  for (const h of sorted) {
    if (picked.every((x) => Math.abs(x.day - h.day) >= gap)) picked.push(h);
    if (picked.length === n) break;
  }
  return picked;
}

/* ───────────── Delay / What-if ───────────── */

export interface Flip {
  delay: number;
  from: string;
  to: string;
  reason: string;
}

export interface DelayAnalysis {
  scores: number[][]; // [site][delay]
  leaders: number[];
  flips: Flip[];
  safeDelay: Record<string, number>;
}

export function analyseDelay(sites: SiteData[], plannedDay: number, duration: number, p: Priority): DelayAnalysis {
  const metrics = sites.map((s) => Array.from({ length: MAX_DELAY + 1 }, (_, d) => evaluate(s, plannedDay + d, duration)));
  const scores = metrics.map((row) => row.map((m) => scoreOf(m, p)));
  const leaders = Array.from({ length: MAX_DELAY + 1 }, (_, d) => {
    let best = 0;
    scores.forEach((row, i) => {
      if (row[d] > scores[best][d]) best = i;
    });
    return best;
  });

  const flips: Flip[] = [];
  for (let d = 1; d <= MAX_DELAY; d++) {
    if (leaders[d] !== leaders[d - 1]) {
      const from = leaders[d - 1];
      const to = leaders[d];
      const cf = components(metrics[from][d], p);
      const ct = components(metrics[to][d], p);
      const diffs: [string, number][] = [
        ["Power", ct.power - cf.power],
        ["Comms", ct.comms - cf.comms],
        ["Safety", ct.safety - cf.safety],
      ];
      diffs.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
      const [label, v] = diffs[0];
      flips.push({ delay: d, from: sites[from].name, to: sites[to].name, reason: `${label} ${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)} pts in the weighted score` });
    }
  }

  const safeDelay: Record<string, number> = {};
  sites.forEach((s, i) => {
    let safe = 0;
    for (let d = 0; d <= MAX_DELAY; d++) {
      if (scores[i][d] >= scores[i][0] - SAFE_DELAY_TOLERANCE) safe = d;
      else break;
    }
    safeDelay[s.id] = safe;
  });
  return { scores, leaders, flips, safeDelay };
}

/* ───────────── Science ↔ Engineering ───────────── */

export type Stance = "consensus" | "conflict" | "neutral";

export interface TeamRow {
  id: string;
  name: string;
  reliefM: number;
  reliefNorm: number;
  scienceScore: number;
  engineeringScore: number;
  scienceRank: number;
  engineeringRank: number;
  stance: Stance;
}

export interface AgreementPrice {
  site: string;
  basis: "consensus" | "all-sites";
  scienceBest: string;
  engineeringBest: string;
  scienceLoss: number; // points below Science's own #1 score
  engineeringLoss: number; // points below Engineering's own #1 score
}

/** Terrain relief (max − min inside 5 km, 400 m DEM) min–max normalised to 0-100 across the compared sites. */
export function reliefNormalised(sites: SiteData[]): Record<string, number> {
  const vals = sites.map((s) => s.reliefM);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  return Object.fromEntries(sites.map((s) => [s.id, hi === lo ? 50 : ((s.reliefM - lo) / (hi - lo)) * 100]));
}

export function teamRanking(
  rows: { site: SiteData; m: CellMetrics }[],
  sciW: number,
  engW: number,
): { rows: TeamRow[]; agreement: number; price: AgreementPrice } {
  const sw = sciW / 100;
  const ew = engW / 100;
  const norm = reliefNormalised(rows.map((r) => r.site));
  const base = rows.map(({ site, m }) => ({
    id: site.id,
    name: site.name,
    reliefM: site.reliefM,
    reliefNorm: norm[site.id],
    scienceScore: sw * norm[site.id] + (1 - sw) * m.power,
    engineeringScore: ew * (100 - m.risk) + (1 - ew) * m.comms,
  }));
  const cmp = (key: "scienceScore" | "engineeringScore") => (a: (typeof base)[number], b: (typeof base)[number]) =>
    b[key] - a[key] || a.name.localeCompare(b.name);
  const byS = [...base].sort(cmp("scienceScore")).map((r) => r.id);
  const byE = [...base].sort(cmp("engineeringScore")).map((r) => r.id);
  const topS = new Set(byS.slice(0, 3));
  const topE = new Set(byE.slice(0, 3));
  const out: TeamRow[] = base.map((r) => ({
    ...r,
    scienceRank: byS.indexOf(r.id) + 1,
    engineeringRank: byE.indexOf(r.id) + 1,
    stance: topS.has(r.id) && topE.has(r.id) ? "consensus" : topS.has(r.id) || topE.has(r.id) ? "conflict" : "neutral",
  }));
  const shared = out.filter((r) => r.stance === "consensus");
  const agreement = (shared.length / 3) * 100;

  // Price of agreement: the site that minimises the WORSE of the two teams' losses against their own #1
  // (min-max regret; ties → smaller total loss). Candidates: sites in both top-3, else every site.
  const bestS = Math.max(...base.map((r) => r.scienceScore));
  const bestE = Math.max(...base.map((r) => r.engineeringScore));
  const pool = shared.length ? shared : out;
  const loss = (r: TeamRow) => ({ s: bestS - r.scienceScore, e: bestE - r.engineeringScore });
  const pick = [...pool].sort((a, b) => {
    const la = loss(a), lb = loss(b);
    return Math.max(la.s, la.e) - Math.max(lb.s, lb.e) || la.s + la.e - (lb.s + lb.e) || a.name.localeCompare(b.name);
  })[0];
  const l = loss(pick);
  const price: AgreementPrice = {
    site: pick.name,
    basis: shared.length ? "consensus" : "all-sites",
    scienceBest: out.find((r) => r.scienceRank === 1)!.name,
    engineeringBest: out.find((r) => r.engineeringRank === 1)!.name,
    scienceLoss: l.s,
    engineeringLoss: l.e,
  };
  return { rows: out.sort((a, b) => a.scienceRank - b.scienceRank), agreement, price };
}

/* ───────────── colour ───────────── */

/** t = 1 is excellent (lavender), t = 0 is poor (dark purple). */
export function heatColor(t: number): string {
  const c = clamp01(t);

  const colors = [
    [41, 36, 63], // #29243F - Poor
    [57, 52, 95], // #39345F
    [80, 75, 136], // #504B88
    [105, 98, 181], // #6962B5
    [137, 129, 223], // #8981DF - Excellent
  ];

  const position = c * (colors.length - 1);
  const index = Math.min(Math.floor(position), colors.length - 2);
  const fraction = position - index;

  const from = colors[index];
  const to = colors[index + 1];

  const rgb = from.map((value, i) => Math.round(value + (to[i] - value) * fraction));

  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}