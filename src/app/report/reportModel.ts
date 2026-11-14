/**
 * Pure helpers for the Report page (no React, no app imports) so they can be unit-tested.
 */

// ───────────────────────── continuity analysis ─────────────────────────

export interface ContinuityResult {
  /** % of samples where power AND communication are both available */
  continuityPct: number;
  /** number of separate periods where power and comm are NOT both available */
  interruptionCount: number;
  /** longest run (hours) where power and comm are not both available */
  longestGapH: number;
  /** longest run (hours) without power (Sun not visible) */
  longestDarkH: number;
  /** longest run (hours) without Earth contact */
  longestCommGapH: number;
}

function longestRun(flags: ArrayLike<boolean | number>, want: boolean): number {
  let run = 0;
  let best = 0;
  for (let i = 0; i < flags.length; i++) {
    if (!!flags[i] === want) {
      run++;
      if (run > best) best = run;
    } else run = 0;
  }
  return best;
}

/**
 * powerOk[i] / commOk[i]: sample i has power / Earth contact. stepH: sample spacing in hours.
 * Interruption = one contiguous period in which power and communication are not both available
 * (a window that starts inside such a period counts it as one).
 */
export function analyseContinuity(
  powerOk: ArrayLike<boolean | number>,
  commOk: ArrayLike<boolean | number>,
  stepH: number,
): ContinuityResult {
  const n = Math.min(powerOk.length, commOk.length);
  if (n === 0) {
    return { continuityPct: 0, interruptionCount: 0, longestGapH: 0, longestDarkH: 0, longestCommGapH: 0 };
  }
  const both = new Uint8Array(n);
  let up = 0;
  let outages = 0;
  for (let i = 0; i < n; i++) {
    both[i] = powerOk[i] && commOk[i] ? 1 : 0;
    if (both[i]) up++;
    else if (i === 0 || both[i - 1]) outages++;
  }
  return {
    continuityPct: (up / n) * 100,
    interruptionCount: outages,
    longestGapH: longestRun(both, false) * stepH,
    longestDarkH: longestRun(Array.from({ length: n }, (_, i) => powerOk[i]), false) * stepH,
    longestCommGapH: longestRun(Array.from({ length: n }, (_, i) => commOk[i]), false) * stepH,
  };
}

// ───────────────────────── main risks ─────────────────────────

export interface RiskInput {
  continuityPct: number;
  longestDarkH: number | null;
  longestGapH: number | null;
  sunPct: number;
  riskScore: number;
  batteryHours: number;
  autonomyLimitH: number;
}

export interface RiskItem {
  title: string;
  detail: string;
  level: "high" | "medium";
  severity: number;
}

export function mainRisks(i: RiskInput): RiskItem[] {
  const out: RiskItem[] = [];
  if (i.longestDarkH != null && i.longestDarkH > i.batteryHours) {
    const r = i.longestDarkH / i.batteryHours;
    out.push({
      title: "Darkness longer than battery autonomy",
      detail: `Longest dark period ${fmtHours(i.longestDarkH)} vs battery ${fmtHours(i.batteryHours)}.`,
      level: r >= 1.5 ? "high" : "medium",
      severity: 2 + r,
    });
  }
  if (i.longestGapH != null && i.longestGapH > i.autonomyLimitH) {
    const r = i.longestGapH / i.autonomyLimitH;
    out.push({
      title: "Power + communication gap exceeds autonomy limit",
      detail: `Longest combined gap ${fmtHours(i.longestGapH)} vs limit ${fmtHours(i.autonomyLimitH)}.`,
      level: r >= 1.5 ? "high" : "medium",
      severity: 2 + r,
    });
  }
  if (i.continuityPct < 50) {
    out.push({
      title: "Low mission continuity",
      detail: `Power and communication are both available only ${i.continuityPct.toFixed(0)}% of the mission.`,
      level: i.continuityPct < 30 ? "high" : "medium",
      severity: 2 + (50 - i.continuityPct) / 50,
    });
  }
  if (i.sunPct < 60) {
    out.push({
      title: "Limited sun exposure",
      detail: `Sun is visible only ${i.sunPct.toFixed(0)}% of the window.`,
      level: "medium",
      severity: 1 + (60 - i.sunPct) / 60,
    });
  }
  if (i.riskScore >= 50) {
    out.push({
      title: "High composite risk score",
      detail: `Model risk score ${i.riskScore.toFixed(0)} / 100.`,
      level: "medium",
      severity: 1 + (i.riskScore - 50) / 50,
    });
  }
  return out.sort((a, b) => b.severity - a.severity).slice(0, 3);
}

// ───────────────────────── validation statistics ─────────────────────────

export interface ErrorStats {
  n: number;
  rmse: number;
  maxAbs: number;
  bias: number;
  r: number; // Pearson correlation (NaN when undefined)
}

export function errorStats(ours: ArrayLike<number>, ref: ArrayLike<number>): ErrorStats {
  const n = Math.min(ours.length, ref.length);
  if (n === 0) return { n: 0, rmse: NaN, maxAbs: NaN, bias: NaN, r: NaN };
  let se = 0;
  let maxAbs = 0;
  let bias = 0;
  let sa = 0;
  let sb = 0;
  for (let i = 0; i < n; i++) {
    const d = ours[i] - ref[i];
    se += d * d;
    bias += d;
    if (Math.abs(d) > maxAbs) maxAbs = Math.abs(d);
    sa += ours[i];
    sb += ref[i];
  }
  const ma = sa / n;
  const mb = sb / n;
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < n; i++) {
    cov += (ours[i] - ma) * (ref[i] - mb);
    va += (ours[i] - ma) ** 2;
    vb += (ref[i] - mb) ** 2;
  }
  return {
    n,
    rmse: Math.sqrt(se / n),
    maxAbs,
    bias: bias / n,
    r: va > 0 && vb > 0 ? cov / Math.sqrt(va * vb) : NaN,
  };
}

/** Keep at most `max` evenly spaced points (for drawing). */
export function downsample<T>(a: T[], max: number): T[] {
  if (a.length <= max) return a;
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(a[Math.round((i * (a.length - 1)) / (max - 1))]);
  return out;
}

// ───────────────────────── confidence ─────────────────────────

export type Level = "High" | "Medium" | "Low";

export interface ConfidenceItem {
  key: string;
  label: string;
  level: Level | "N/A";
  why: string;
}

export interface ConfidenceInput {
  demCellM: number;
  /** null = validation not run, true = within tolerance, false = outside tolerance */
  sunEarthValidated: boolean | null;
  sunlightValidated: boolean | null;
  hasLinkBudget: boolean;
  hasThermalModel: boolean;
}

const SCORE: Record<Level, number> = { High: 3, Medium: 2, Low: 1 };

export function confidenceItems(c: ConfidenceInput): ConfidenceItem[] {
  const eph: ConfidenceItem =
    c.sunEarthValidated === true
      ? { key: "eph", label: "Sun / Earth position", level: "High", why: "Ephemeris matches the Horizons reference within tolerance." }
      : c.sunEarthValidated === false
        ? { key: "eph", label: "Sun / Earth position", level: "Low", why: "Differs from the Horizons reference by more than the tolerance." }
        : { key: "eph", label: "Sun / Earth position", level: "Medium", why: "Ephemeris-based, but not cross-checked against Horizons here." };

  const ill: ConfidenceItem =
    c.sunlightValidated === false
      ? { key: "ill", label: "Illumination (terrain horizon)", level: "Low", why: "Sunlight fraction differs from the LOLA illumination reference." }
      : c.sunlightValidated === true && c.demCellM <= 100
        ? { key: "ill", label: "Illumination (terrain horizon)", level: "High", why: `${c.demCellM} m DEM and agreement with the LOLA illumination reference.` }
        : {
            key: "ill",
            label: "Illumination (terrain horizon)",
            level: "Medium",
            why:
              c.sunlightValidated === true
                ? `Matches the LOLA reference, but the ${c.demCellM} m DEM is coarse.`
                : `${c.demCellM} m DEM; not cross-checked against a LOLA illumination map here.`,
          };

  const comm: ConfidenceItem = c.hasLinkBudget
    ? { key: "comm", label: "Communication", level: "Medium", why: "Geometry plus a link budget." }
    : { key: "comm", label: "Communication", level: "Low", why: "Geometric Earth visibility only; no radio link budget." };

  const pow: ConfidenceItem = { key: "pow", label: "Power", level: "Low", why: "Proxy from Sun visibility / elevation, not a full power budget." };

  const therm: ConfidenceItem = c.hasThermalModel
    ? { key: "therm", label: "Thermal", level: "Medium", why: "Simplified thermal model." }
    : { key: "therm", label: "Thermal", level: "N/A", why: "No temperature model; not part of the confidence score." };

  return [eph, ill, comm, pow, therm];
}

export function overallConfidence(items: ConfidenceItem[]): { level: Level; score: number } {
  const scored = items.filter((i): i is ConfidenceItem & { level: Level } => i.level !== "N/A");
  const score = scored.reduce((s, i) => s + SCORE[i.level], 0) / Math.max(1, scored.length);
  return { level: score >= 2.5 ? "High" : score >= 1.75 ? "Medium" : "Low", score };
}

// ───────────────────────── formatting ─────────────────────────

export function fmtHours(h: number): string {
  if (!Number.isFinite(h)) return "—";
  if (h >= 48) return `${(h / 24).toFixed(1)} d`;
  return `${Number.isInteger(h) ? h : h.toFixed(1)} h`;
}