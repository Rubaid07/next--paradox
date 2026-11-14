// useSkyEphemeris.ts

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { EphemerisData } from "../../../lib/ephemeris";

export type EphStatus = "idle" | "loading" | "ready" | "error";

export const SPEEDS = [
  { label: "1× real-time", value: 1 },
  { label: "1 min/s", value: 60 },
  { label: "10 min/s", value: 600 },
  { label: "1 hr/s", value: 3600 },
  { label: "6 hr/s", value: 21600 },
  { label: "1 day/s", value: 86400 },
] as const;

/** Step sizes (minutes) the /api/ephemeris route accepts, and its row limit. */
const STEPS_MIN = [1, 2, 5, 10, 15, 30, 60];
const MAX_ROWS = 20000;

/** Smallest allowed step >= the requested one that keeps the row count under the server limit. */
function pickStep(days: number, requestedMin: number): number {
  return STEPS_MIN.find((s) => s >= requestedMin && (days * 1440) / s + 1 <= MAX_ROWS) ?? 60;
}

/**
 * Loads real JPL Horizons Sun/Earth azimuth+elevation for a site (via /api/ephemeris) and owns the
 * playback clock. `tRef` holds the exact current time for the 3D scene (read every frame, no
 * re-render); `t` is a throttled copy for the DOM.
 */
export function useSkyEphemeris(
  target: { lat: number | null; lon: number | null; altitudeKm: number | null } | null,
  enabled: boolean,
) {
  const lat = target?.lat ?? null;
  const lon = target?.lon ?? null;
  const altitudeKm = target?.altitudeKm ?? null;

  // Filled in after mount (a Date during render would be frozen at prerender time).
  const [startDate, setStartDate] = useState("");
  // 3 days at 1-minute resolution: today's window always contains "now".
  const [days, setDays] = useState(3);
  const [stepMin, setStepMin] = useState(1);
  const [showTrails, setShowTrails] = useState(true);

  // Step actually requested from the server (coarser than stepMin for long windows).
  const effStep = pickStep(days, stepMin);

  const [eph, setEph] = useState<EphemerisData | null>(null);
  const [status, setStatus] = useState<EphStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const cache = useRef(new Map<string, EphemerisData>());

  const tRef = useRef(0);
  const [t, setT] = useState(0);
  // Runs by itself, like a real-time clock: starts at "now" (UTC) at 1x speed.
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeedState] = useState<number>(1);
  const [live, setLive] = useState(true);

  const setTime = useCallback((ms: number) => {
    tRef.current = ms;
    setT(ms);
  }, []);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setStartDate((d) => d || new Date().toISOString().slice(0, 10));
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  // Fetch whenever the site / window changes.
  useEffect(() => {
    if (!enabled || lat === null || lon === null || altitudeKm === null || !startDate) {
      return;
    }

    const qs = new URLSearchParams({
      lat: String(lat),
      lon: String(lon),
      alt: String(altitudeKm),
      start: startDate,
      days: String(days),
      step: `${effStep}m`,
    }).toString();

    const accept = (data: EphemerisData) => {
      setEph(data);
      setStatus("ready");
      setError(null);
      const end = data.startMs + (data.count - 1) * data.stepMs;
      if (tRef.current < data.startMs || tRef.current > end) {
        const now = Date.now();
        setTime(Math.min(end, Math.max(data.startMs, now)));
        setLive(now >= data.startMs && now <= end);
      }
    };

    const hit = cache.current.get(qs);
    if (hit) {
      accept(hit);
      return;
    }

    const ctrl = new AbortController();
    setStatus("loading");
    setError(null);

    fetch(`/api/ephemeris?${qs}`, { signal: ctrl.signal })
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body?.error ?? `HTTP ${r.status}`);
        return body as EphemerisData;
      })
      .then((data) => {
        cache.current.set(qs, data);
        accept(data);
      })
      .catch((e: unknown) => {
        if (ctrl.signal.aborted) return;
        setEph(null);
        setStatus("error");
        setError(e instanceof Error ? e.message : String(e));
      });

    return () => ctrl.abort();
  }, [enabled, lat, lon, altitudeKm, startDate, days, effStep, setTime]);

  const endMs = eph ? eph.startMs + (eph.count - 1) * eph.stepMs : 0;

  // Playback loop (loops back to the start at the end of the window).
  useEffect(() => {
    if (!playing || !eph || !enabled) return;
    const start = eph.startMs;
    const span = endMs - start;
    let raf = 0;
    let last = performance.now();
    let lastUi = 0;
    const loop = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      let next = tRef.current + dt * speed * 1000;
      if (next > endMs) next = start + ((next - start) % span);
      tRef.current = next;
      if (now - lastUi > 66) {
        lastUi = now;
        setT(next);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, eph, endMs, speed, enabled]);

  /** User-driven time changes (scrubbing, skipping) leave live mode. */
  const scrub = useCallback(
    (ms: number) => {
      setLive(false);
      setTime(ms);
    },
    [setTime],
  );

  const jump = useCallback(
    (deltaMs: number) => {
      if (!eph) return;
      scrub(Math.min(endMs, Math.max(eph.startMs, tRef.current + deltaMs)));
    },
    [eph, endMs, scrub],
  );

  const togglePlay = useCallback(() => {
    setPlaying((p) => !p);
    setLive(false);
  }, []);

  const setSpeed = useCallback((v: number) => {
    setSpeedState(v);
    setLive(false);
  }, []);

  /** Jump back to the current UTC time and run at 1x. */
  const goLive = useCallback(() => {
    setSpeedState(1);
    setPlaying(true);
    if (eph) {
      const now = Date.now();
      setTime(Math.min(endMs, Math.max(eph.startMs, now)));
      setLive(now >= eph.startMs && now <= endMs);
    } else {
      setLive(true);
    }
  }, [eph, endMs, setTime]);

  // Space = play / pause
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (e.code === "Space" && tag !== "INPUT" && tag !== "SELECT" && tag !== "BUTTON" && tag !== "TEXTAREA") {
        e.preventDefault();
        togglePlay();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, togglePlay]);

  return {
    eph,
    status: !enabled || lat === null || lon === null || altitudeKm === null || !startDate ? "idle" : status,
    error, endMs,
    tRef, t, setTime, scrub, jump,
    playing, setPlaying, togglePlay, speed, setSpeed, live, goLive,
    startDate, setStartDate, days, setDays, stepMin, setStepMin, effStep,
    showTrails, setShowTrails,
  };
}

export type SkyEphemeris = ReturnType<typeof useSkyEphemeris>;