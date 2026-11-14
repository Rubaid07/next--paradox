/**
 * Sun / Earth ephemeris helpers (no React, no three.js, safe for server and client).
 *
 * Source of truth: JPL Horizons observer tables (QUANTITIES=4 -> apparent azimuth / elevation),
 * fetched by lib/lunarHorizone.ts for a topocentric lunar site. Nothing in here generates or
 * approximates positions: it only parses what Horizons returned and interpolates *between*
 * the returned rows so the timeline can be scrubbed smoothly.
 */

export interface BodyTrack {
  /** Degrees, 0 = local north, 90 = east (clockwise seen from above). */
  az: number[];
  /** Degrees above the local geometric horizon. */
  el: number[];
}

/** What /api/ephemeris returns. Samples are uniformly spaced: t[i] = startMs + i * stepMs. */
export interface EphemerisData {
  site: { lat: number; lon: number; altitudeKm: number };
  startMs: number;
  stepMs: number;
  count: number;
  sun: BodyTrack;
  earth: BodyTrack;
  source: string;
  fetchedAt: string;
}

export interface ParsedTable {
  /** UTC epoch milliseconds of every row. */
  t: number[];
  az: number[];
  el: number[];
}

const MONTHS: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};

// "2026-Nov-12 00:05:00[.fff]" followed by optional presence flags and then Azi, Elev.
const ROW = /^\s*(\d{4})-([A-Za-z]{3})-(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?(.*)$/;

/**
 * Parses the $$SOE ... $$EOE block of a Horizons OBSERVER table that was requested with
 * QUANTITIES='4' (Azi_(a-app)_Elev). The one or two solar/lunar presence flag columns that
 * Horizons inserts between the time and the angles are blank for most rows, so the angles are
 * taken as the *last two* numeric tokens of each row.
 */
export function parseHorizonsObserverTable(text: string): ParsedTable {
  const soe = text.indexOf("$$SOE");
  const eoe = text.indexOf("$$EOE");
  if (soe < 0 || eoe < 0 || eoe < soe) {
    const snippet = text.replace(/\s+/g, " ").trim().slice(0, 400);
    throw new Error(`Horizons returned no ephemeris rows. Response began: ${snippet}`);
  }

  const t: number[] = [];
  const az: number[] = [];
  const el: number[] = [];

  for (const line of text.slice(soe + 5, eoe).split(/\r?\n/)) {
    if (!line.trim()) continue;
    const m = ROW.exec(line);
    if (!m) throw new Error(`Unrecognised Horizons row: "${line.trim()}"`);

    const month = MONTHS[m[2]];
    if (month === undefined) throw new Error(`Unknown month "${m[2]}" in row: "${line.trim()}"`);

    const tokens = m[7].trim().split(/\s+/).filter(Boolean);
    if (tokens.length < 2) throw new Error(`Row has no azimuth/elevation: "${line.trim()}"`);
    const a = Number(tokens[tokens.length - 2]);
    const e = Number(tokens[tokens.length - 1]);
    if (!Number.isFinite(a) || !Number.isFinite(e)) {
      throw new Error(`Non-numeric azimuth/elevation in row: "${line.trim()}"`);
    }

    t.push(Date.UTC(+m[1], month, +m[3], +m[4], +m[5], m[6] ? Number(m[6]) : 0));
    az.push(a);
    el.push(e);
  }

  if (t.length < 2) throw new Error("Horizons returned fewer than two ephemeris rows.");
  return { t, az, el };
}

// ---------------------------------------------------------------------------------------------
// Sampling
// ---------------------------------------------------------------------------------------------

export interface AzEl {
  az: number;
  el: number;
}

/** Interpolates between the two nearest Horizons rows (azimuth along the shortest arc). */
export function sampleBody(
  eph: Pick<EphemerisData, "startMs" | "stepMs" | "count"> & Record<"sun" | "earth", BodyTrack>,
  body: "sun" | "earth",
  tMs: number,
): AzEl {
  const track = eph[body];
  const f = Math.min(Math.max((tMs - eph.startMs) / eph.stepMs, 0), eph.count - 1);
  const i0 = Math.floor(f);
  const i1 = Math.min(i0 + 1, eph.count - 1);
  const w = f - i0;

  const a0 = track.az[i0];
  const a1 = track.az[i1];
  const d = ((((a1 - a0) % 360) + 540) % 360) - 180;
  return {
    az: (((a0 + d * w) % 360) + 360) % 360,
    el: track.el[i0] + (track.el[i1] - track.el[i0]) * w,
  };
}

// ---------------------------------------------------------------------------------------------
// Direction in the terrain scene
// ---------------------------------------------------------------------------------------------

/**
 * Unit vector (scene axes: x = projected easting, y = up, z = -projected northing) towards a
 * body at local azimuth/elevation for a site at east longitude `lonDeg`.
 *
 * The DEM is a south-polar stereographic map with lon0 = 0, so map-north is only local north
 * for a site on the 0 degree meridian. At longitude L the local north is the outward radial
 * direction (sin L, -cos L) in scene x/z and local east is (cos L, sin L). Using the map's own
 * "up" for azimuth would rotate every site's sky by its longitude.
 */
export function localDirection(
  azDeg: number,
  elDeg: number,
  lonDeg: number,
): [number, number, number] {
  const A = (azDeg * Math.PI) / 180;
  const E = (elDeg * Math.PI) / 180;
  const L = (lonDeg * Math.PI) / 180;

  const nx = Math.sin(L);
  const nz = -Math.cos(L);
  const ex = Math.cos(L);
  const ez = Math.sin(L);

  const h = Math.cos(E);
  return [
    h * (Math.cos(A) * nx + Math.sin(A) * ex),
    Math.sin(E),
    h * (Math.cos(A) * nz + Math.sin(A) * ez),
  ];
}

// ---------------------------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------------------------

const POINTS = [
  "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
  "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
];

export function compass(azDeg: number): string {
  return POINTS[Math.round((((azDeg % 360) + 360) % 360) / 22.5) % 16];
}

export function formatUtc(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").slice(0, 19) + " UTC";
}