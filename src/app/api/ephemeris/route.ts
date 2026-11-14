// epheemeris/ route.ts

import { NextRequest, NextResponse } from "next/server";
import { getSunAndEarthPositions } from "../../../lib/lunarHorizone";
import {
  parseHorizonsObserverTable,
  type EphemerisData,
  type ParsedTable,
} from "../../../lib/ephemeris";

/**
 * GET /api/ephemeris?lat=-89.67&lon=129.78&start=2026-11-11&days=7&step=5m
 *
 * Runs on the server (JPL Horizons cannot be called from the browser reliably) and returns the
 * real topocentric Sun and Earth azimuth/elevation for the site. Nothing here is modelled.
 */

const STEP_MINUTES: Record<string, number> = {
  "1m": 1,
  "2m": 2,
  "5m": 5,
  "10m": 10,
  "15m": 15,
  "30m": 30,
  "60m": 60,
};
const MAX_DAYS = 31;
const MAX_ROWS = 20000;
const DAY_MS = 86_400_000;

const round = (v: number) => Math.round(v * 1e5) / 1e5;
const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace("T", " ");

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/** Horizons rows must be uniformly spaced and identical for both bodies. */
function checkGrid(sun: ParsedTable, earth: ParsedTable): { startMs: number; stepMs: number } {
  if (sun.t.length !== earth.t.length) {
    throw new Error(`Sun and Earth tables differ in length (${sun.t.length} vs ${earth.t.length}).`);
  }
  const stepMs = sun.t[1] - sun.t[0];
  for (let i = 0; i < sun.t.length; i++) {
    if (sun.t[i] !== earth.t[i]) throw new Error("Sun and Earth timestamps do not line up.");
    if (i > 0 && Math.abs(sun.t[i] - sun.t[i - 1] - stepMs) > 1000) {
      throw new Error("Horizons rows are not evenly spaced.");
    }
  }
  return { startMs: sun.t[0], stepMs };
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;

  const lat = Number(q.get("lat"));
  const lon = Number(q.get("lon"));
  const altitudeKm = q.get("alt") === null ? 0 : Number(q.get("alt"));
  const days = Number(q.get("days") ?? 7);
  const step = q.get("step") ?? "5m";
  const startMs = Date.parse(`${q.get("start") ?? ""}T00:00:00Z`);

  if (!Number.isFinite(lat) || lat < -90 || lat > 90) return bad("lat must be between -90 and 90.");
  if (!Number.isFinite(lon) || lon < -180 || lon > 360) return bad("lon must be between -180 and 360.");
  if (!Number.isFinite(altitudeKm)) return bad("alt must be a number (km).");
  if (!Number.isFinite(startMs)) return bad("start must be a UTC date such as 2026-11-11.");
  if (!Number.isFinite(days) || days < 1 || days > MAX_DAYS) return bad(`days must be 1-${MAX_DAYS}.`);
  if (!(step in STEP_MINUTES)) return bad(`step must be one of ${Object.keys(STEP_MINUTES).join(", ")}.`);
  if ((days * 1440) / STEP_MINUTES[step] > MAX_ROWS) return bad("That window and step give too many rows.");

  const stopMs = startMs + days * DAY_MS;

  try {
    const raw = await getSunAndEarthPositions({
      site: {
        latitude: lat,
        longitude: ((lon % 360) + 360) % 360, // Horizons takes east longitude
        altitudeKm,
      },
      startTime: fmt(startMs),
      stopTime: fmt(stopMs),
      stepSize: step,
    });

    const sun = parseHorizonsObserverTable(raw.sun);
    const earth = parseHorizonsObserverTable(raw.earth);
    const grid = checkGrid(sun, earth);

    const body: EphemerisData = {
      site: { lat, lon, altitudeKm },
      startMs: grid.startMs,
      stepMs: grid.stepMs,
      count: sun.t.length,
      sun: { az: sun.az.map(round), el: sun.el.map(round) },
      earth: { az: earth.az.map(round), el: earth.el.map(round) },
      source: "NASA/JPL Horizons API (observer table, topocentric, airless apparent)",
      fetchedAt: new Date().toISOString(),
    };

    return NextResponse.json(body, {
      // Ephemerides are deterministic, so browsers and CDNs may reuse the answer.
      headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400" },
    });
  } catch (e) {
    return bad(e instanceof Error ? e.message : String(e), 502);
  }
}