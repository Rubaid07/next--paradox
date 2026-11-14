"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Activity, RotateCcw, Sun } from "lucide-react";

import { loadHeightmap, loadMeta, loadSites } from "../../lib/data";
import { computeHorizonMask } from "../../lib/horizon";
import { skyWindowStats } from "../../lib/skystats";
import { createHeightSampler, cropHeightmap } from "../../lib/terrain";
import { legendGradient } from "../../lib/colormap";
import { formatKm, formatLat, formatLon, formatMeters } from "../../lib/format";
import {
  getSiteIdFromUrl,
  getStoredPlan,
  getStoredSiteId,
  isMissionDuration,
  MISSION_DURATIONS,
  PLAN_KEY,
  setStoredSiteId,
} from "../../lib/selection";

import type {
  ColorMode,
  HeightmapLevel,
  LandingSite,
  PlacedSite,
  TerrainMeta,
} from "../../lib/types";

import { isPlaced } from "../../lib/types";
import { sampleBody } from "../../lib/ephemeris";
import { useSkyEphemeris } from "./moon/useSkyEphemeris";
import { SkyReadouts, SkyTimeline } from "./moon/SkyTimeline";
import {
  Bar,
  Card,
  Divider,
  Pill,
  RangeRow,
  Ring,
  Seg,
  StatRow,
  Tile,
  Toggle,
  type Tone,
} from "./moon/Panelui";

const SiteScene = dynamic(() => import("./SiteScene"), {
  ssr: false,
});

const AREA_OPTIONS_KM = [30, 60, 100] as const;
// Match the comparison series: 2 m mast, 200 m steps, 0.5° bins, 400 km range.
const HORIZON_MASK_OPTIONS = {
  observerHeightM: 2,
  stepKm: 0.2,
  azCount: 720,
  maxRangeKm: 400,
} as const;

// --------------------------------------------------
// Main Overview
// --------------------------------------------------

export default function Overview() {
  const [sites, setSites] = useState<LandingSite[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [meta, setMeta] = useState<TerrainMeta | null>(null);
  const [level, setLevel] = useState<HeightmapLevel | null>(null);
  const [heights, setHeights] = useState<Float32Array | null>(null);

  const [error, setError] = useState<string | null>(null);

  const [areaKm, setAreaKm] = useState<number>(60);
  const [exaggeration, setExaggeration] = useState(2);
  const [sunAzimuth, setSunAzimuth] = useState(315);
  const [sunElevation, setSunElevation] = useState(12);
  const [shadows, setShadows] = useState(true);
  const [colorMode, setColorMode] = useState<ColorMode>("elevation");
  const [resetNonce, setResetNonce] = useState(0);
  const [liveSky, setLiveSky] = useState(true);

  // Load sites and terrain data
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [loadedSites, m] = await Promise.all([loadSites(), loadMeta()]);

        if (cancelled) return;

        const finest = [...m.levels].sort(
          (a, b) => a.cellSizeM - b.cellSizeM,
        )[0];

        setMeta(m);
        setLevel(finest);
        setSites(loadedSites);

        const placed = loadedSites.filter(isPlaced);

        const wanted = [getSiteIdFromUrl(), getStoredSiteId()];

        const found = wanted.find(
          (id) => id && placed.some((s) => s.id === id),
        );

        setSelectedId(found ?? placed[0]?.id ?? null);

        const h = await loadHeightmap(finest);

        if (!cancelled) {
          setHeights(h);
        }
      } catch (e: unknown) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const placedSites = useMemo(() => sites.filter(isPlaced), [sites]);

  const site = useMemo(
    () => placedSites.find((s) => s.id === selectedId) ?? null,
    [placedSites, selectedId],
  );
  const extentKm = meta?.coverage.extentKm[0] ?? 608;
  const sampleTerrainHeightKm = useMemo(
    () =>
      heights && level
        ? createHeightSampler(heights, level.width, extentKm)
        : null,
    [heights, level, extentKm],
  );
  const observerAltitudeKm =
    site && sampleTerrainHeightKm
      ? sampleTerrainHeightKm(site.world.x_km, site.world.z_km) + 0.002
      : null;

  // Real JPL Horizons Sun/Earth ephemeris + playback clock for the selected site
  const sky = useSkyEphemeris(
    site ? { lat: site.lat, lon: site.lon, altitudeKm: observerAltitudeKm } : null,
    liveSky,
  );
  const setSkyDays = sky.setDays;
  useEffect(() => {
    const syncDuration = () => {
      const duration = getStoredPlan().duration;
      if (isMissionDuration(duration)) setSkyDays(duration);
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === PLAN_KEY) syncDuration();
    };

    syncDuration();
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [setSkyDays]);

  const siteEph =
    site &&
    observerAltitudeKm !== null &&
    sky.eph?.site.lat === site.lat &&
    sky.eph.site.lon === site.lon &&
    sky.eph.site.altitudeKm === observerAltitudeKm
      ? sky.eph
      : null;
  const liveSun = liveSky && siteEph ? sampleBody(siteEph, "sun", sky.t) : null;
  const liveEarth =
    liveSky && siteEph ? sampleBody(siteEph, "earth", sky.t) : null;

  const liveBadge: { label: string; tone: Tone } = !liveSky
    ? { label: "Off", tone: "neutral" }
    : sky.status === "error"
      ? { label: "Error", tone: "bad" }
      : sky.status !== "ready"
        ? { label: "Loading", tone: "warn" }
        : sky.live && sky.playing
          ? { label: "Live", tone: "good" }
          : { label: sky.playing ? "Playing" : "Paused", tone: "warn" };

  // Select landing site
  const selectSite = (id: string) => {
    setSelectedId(id);
    setStoredSiteId(id);

    try {
      window.history.replaceState(
        null,
        "",
        `/overview?site=${encodeURIComponent(id)}`,
      );
    } catch {
      // Ignore history errors
    }
  };

  const horizonMask = useMemo(() => {
    if (!liveSky || !site || !sampleTerrainHeightKm) return null;
    return computeHorizonMask(
      (x, z) => sampleTerrainHeightKm(x, z) * 1000,
      site.world.x_km,
      site.world.z_km,
      extentKm,
      HORIZON_MASK_OPTIONS,
    );
  }, [liveSky, site, sampleTerrainHeightKm, extentKm]);

  const skyStats = useMemo(
    () => (siteEph && horizonMask ? skyWindowStats(siteEph, horizonMask) : null),
    [siteEph, horizonMask],
  );

  // Crop terrain around selected site
  const win = useMemo(() => {
    if (!site || !heights || !level) return null;

    return cropHeightmap(
      heights,
      level.width,
      extentKm,
      site.world.x_km,
      site.world.z_km,
      areaKm,
    );
  }, [site, heights, level, extentKm, areaKm]);

  const localSite = useMemo<PlacedSite | null>(() => {
    if (!site || !win) return null;

    return {
      ...site,
      world: {
        x_km: site.world.x_km - win.centerX,
        z_km: site.world.z_km - win.centerZ,
      },
    };
  }, [site, win]);

  const colorRange = useMemo<readonly [number, number] | undefined>(
    () => (win ? [win.min, win.max] : undefined),
    [win],
  );

  return (
    <main className="min-h-screen bg-[#05080F] p-4 pb-32 text-[#E8EAED] sm:px-6 sm:pb-18">
      <div className="mx-auto max-w-[1900px]">
        {/* ==========================================
            MAIN DASHBOARD
        ========================================== */}

        <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(340px,0.34fr)_minmax(0,0.66fr)]">
          {/* ========================================
              LEFT SIDEBAR
          ======================================== */}

          <aside className="space-y-4">
            {/* LANDING SITE SELECTION */}

            <Card
              title="Landing site selection"
              badge={<Pill>{placedSites.length} sites</Pill>}
            >
              <div className="grid grid-cols-2 gap-2">
                {placedSites.map((s) => {
                  const active = s.id === selectedId;

                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => selectSite(s.id)}
                      aria-pressed={active}
                      className={
                        "rounded-xl border px-3 py-2.5 text-left transition-colors " +
                        (active
                          ? "border-[#A7A5FF]/60 bg-[#A7A5FF]/[0.10]"
                          : "border-[#1E2A3E] hover:border-[#A7A5FF]/40")
                      }
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={
                            "h-1.5 w-1.5 shrink-0 rounded-full " +
                            (active ? "bg-[#A7A5FF]" : "bg-[#526783]")
                          }
                        />
                        <span
                          className={
                            "truncate text-xs font-semibold " +
                            (active ? "text-[#C7C3FF]" : "text-[#C3D0E6]")
                          }
                        >
                          {s.name}
                        </span>
                      </div>

                      {s.distanceFromPole_km !== undefined && (
                        <div className="mt-1 pl-3.5 text-[10px] tabular-nums text-[#5F7399]">
                          {formatKm(s.distanceFromPole_km)} from pole
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>

              {placedSites.length === 0 && (
                <p className="text-xs text-[#7F93B3]">
                  No placed landing sites available.
                </p>
              )}
            </Card>

            {/* LIVE SUN & EARTH (JPL HORIZONS) */}

            <Card
              title="Live Sun & Earth"
              badge={<Pill tone={liveBadge.tone}>{liveBadge.label}</Pill>}
            >
              {liveSky && sky.status === "ready" && skyStats && siteEph && (
                <>
                  <div className="flex items-center gap-5">
                    <Ring
                      value={skyStats.sunUp}
                      label={`${Math.round(skyStats.sunUp * 100)}%`}
                      caption="SUN UP"
                    />

                    <div className="min-w-0 flex-1">
                      <p className="text-lg font-semibold text-white">
                        {skyStats.sunUpHours.toFixed(1)} h sunlight
                      </p>
                      <p className="mt-0.5 text-[13px] text-[#8FA3C2]">
                        terrain-visible in the loaded {sky.days}-day window
                      </p>
                      <div className="mt-3">
                        <Bar value={skyStats.earthUp} />
                      </div>
                      <p className="mt-1.5 text-[11px] text-[#6E7F9E]">
                        Earth visible {Math.round(skyStats.earthUp * 100)}% of
                        window
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-2 min-[420px]:grid-cols-4">
                    <Tile
                      value={liveSun ? `${liveSun.el.toFixed(2)}°` : "—"}
                      label="Sun elev"
                    />
                    <Tile
                      value={liveEarth ? `${liveEarth.el.toFixed(2)}°` : "—"}
                      label="Earth elev"
                    />
                    <Tile
                      value={`${skyStats.maxSunDarkH.toFixed(1)}h`}
                      label="Max dark"
                    />
                    <Tile
                      value={`${skyStats.maxEarthGapH.toFixed(1)}h`}
                      label="Earth gap"
                    />
                  </div>

                  <Divider />
                </>
              )}

              {liveSky &&
                sky.status !== "error" &&
                (sky.status === "ready" && skyStats && siteEph ? null : (
                  <div
                    role="status"
                    aria-label="Loading Sun and Earth data"
                    className="mb-4 animate-pulse"
                  >
                    {/* Ring and sunlight information */}
                    <div className="flex items-center gap-5">
                      <div className="h-24 w-24 shrink-0 rounded-full border-[5px] border-[#26354C] border-t-[#A7A5FF]/70" />

                      <div className="min-w-0 flex-1 space-y-3">
                        <div className="h-5 w-36 rounded-md bg-[#26354C]" />
                        <div className="h-3 w-48 max-w-full rounded bg-[#1E2A3E]" />
                        <div className="mt-3 h-1.5 w-full rounded-full bg-[#26354C]" />
                        <div className="h-2.5 w-40 max-w-full rounded bg-[#1E2A3E]" />
                      </div>
                    </div>

                    {/* Statistics skeleton */}
                    <div className="mt-4 grid grid-cols-2 gap-2 min-[420px]:grid-cols-4">
                      {Array.from({ length: 4 }).map((_, i) => (
                        <div
                          key={i}
                          className="flex h-[77px] flex-col items-center justify-center gap-3 rounded-xl border border-[#1E2A3E] bg-[#080d1a]/50"
                        >
                          <div className="h-4 w-12 rounded bg-[#26354C]" />
                          <div className="h-2 w-16 rounded bg-[#1E2A3E]" />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}

              <div className="space-y-4">
                <Toggle
                  label="Use real ephemeris"
                  checked={liveSky}
                  onChange={(v) => {
                    setLiveSky(v);
                    if (v) sky.goLive();
                    else sky.setPlaying(false);
                  }}
                />

                {liveSky && (
                  <>
                    <Seg<number>
                      label="Duration"
                      value={sky.days}
                      options={MISSION_DURATIONS.map((d) => ({
                        value: d,
                        label: `${d}d`,
                      }))}
                      onChange={sky.setDays}
                    />

                    <Seg<number>
                      label="Sample step"
                      value={sky.stepMin}
                      options={[1, 5, 10, 30].map((m) => ({
                        value: m,
                        label: `${m} min`,
                      }))}
                      onChange={sky.setStepMin}
                    />

                    <Toggle
                      label="Show Sun / Earth tracks"
                      checked={sky.showTrails}
                      onChange={sky.setShowTrails}
                    />

                    <p className="text-[11px] leading-relaxed text-[#5F7399]">
                      {siteEph
                        ? `${siteEph.count} NASA/JPL Horizons samples. `
                        : ""}
                      Sun/Earth visibility includes the local 400 m DEM horizon
                      at 2 m observer height. Directions are true site Az/El.
                    </p>
                  </>
                )}
              </div>
            </Card>

            {/* TERRAIN VIEW CONTROLS */}

            <Card title="Terrain view controls">
              <div className="space-y-4">
                <Seg<number>
                  label="Map area"
                  value={areaKm}
                  options={AREA_OPTIONS_KM.map((k) => ({
                    value: k,
                    label: `${k} km`,
                  }))}
                  onChange={setAreaKm}
                />

                <RangeRow
                  label="Vertical exaggeration"
                  value={exaggeration}
                  min={1}
                  max={10}
                  step={0.5}
                  display={`${exaggeration}×`}
                  onChange={setExaggeration}
                />

                {/* Manual sun (only when the live ephemeris is off) */}

                {!liveSky && (
                  <>
                    <RangeRow
                      label="Sun azimuth"
                      value={sunAzimuth}
                      min={0}
                      max={360}
                      step={5}
                      display={`${sunAzimuth}°`}
                      onChange={setSunAzimuth}
                    />

                    <RangeRow
                      label="Sun elevation"
                      value={sunElevation}
                      min={0.5}
                      max={45}
                      step={0.5}
                      display={`${sunElevation}°`}
                      onChange={setSunElevation}
                    />
                  </>
                )}

                <Seg<ColorMode>
                  label="Surface colour"
                  value={colorMode}
                  options={[
                    { value: "elevation", label: "Elevation" },
                    { value: "neutral", label: "Neutral" },
                  ]}
                  onChange={setColorMode}
                />

                <Toggle
                  label="Shadows"
                  checked={shadows}
                  onChange={setShadows}
                />

                <button
                  type="button"
                  onClick={() => setResetNonce((n) => n + 1)}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#1E2A3E] px-3 py-2.5 text-xs font-medium text-[#A9BBD5] transition hover:border-[#A7A5FF]/60 hover:bg-[#A7A5FF]/[0.08] hover:text-[#C7C3FF]"
                >
                  <RotateCcw size={14} />
                  Reset terrain view
                </button>
              </div>
            </Card>
          </aside>

          {/* ========================================
              RIGHT: 3D TERRAIN VIEWER
          ======================================== */}

          <section className="min-w-0 space-y-3 xl:sticky xl:top-5">
            <div className="relative h-[450px] overflow-hidden rounded-xl border border-[#344054] bg-black sm:h-[500px] lg:h-[550px] xl:h-[calc(100vh-220px)] xl:min-h-[450px]">
              {/* Terrain */}

              {win && localSite && (
                <SiteScene
                  heights={win.heights}
                  size={win.size}
                  windowKm={win.windowKm}
                  site={localSite}
                  exaggeration={exaggeration}
                  sunAzimuth={sunAzimuth}
                  sunElevation={sunElevation}
                  eph={liveSky ? siteEph : null}
                  tRef={sky.tRef}
                  lonDeg={site?.lon ?? 0}
                  showTrails={sky.showTrails}
                  shadows={shadows}
                  colorMode={colorMode}
                  colorRange={colorRange!}
                  resetNonce={resetNonce}
                />
              )}

              {/* Viewer header */}

              <div className="pointer-events-none absolute left-4 top-4 z-10">
                <p className="text-xs font-semibold tracking-[0.18em] text-white">
                  SOUTH POLE
                </p>

                <p className="mt-1 text-[9px] tracking-wider text-[#8996A8]">
                  3D TERRAIN VISUALIZATION
                </p>
              </div>

              <div className="pointer-events-none absolute right-4 top-4 z-10 text-[9px] tracking-wider text-[#8996A8]">
                DRAG TO ROTATE · SCROLL TO ZOOM
              </div>

              {/* Live Sun / Earth Az-El */}

              {/* Live Sun / Earth Az-El */}

              {liveSky && sky.status !== "error" && (
                <div className="pointer-events-none absolute left-4 top-16 z-10 w-56">
                  {sky.status === "ready" && siteEph ? (
                    <SkyReadouts eph={siteEph} t={sky.t} />
                  ) : (
                    <div className="space-y-2 animate-pulse">
                      {/* Sun Skeleton */}
                      <div className="rounded-lg border border-[#344054] bg-[#080F1C]/90 p-3 backdrop-blur-md">
                        <div className="mb-3 flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className="h-2 w-2 rounded-full bg-[#A7A5FF]/50" />
                            <div className="h-3 w-9 rounded bg-[#26354C]" />
                          </div>
                          <div className="h-2 w-14 rounded bg-[#26354C]" />
                        </div>

                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <div className="h-2 w-14 rounded bg-[#1E2A3E]" />
                            <div className="h-2.5 w-16 rounded bg-[#26354C]" />
                          </div>
                          <div className="flex items-center justify-between">
                            <div className="h-2 w-14 rounded bg-[#1E2A3E]" />
                            <div className="h-2.5 w-12 rounded bg-[#26354C]" />
                          </div>
                        </div>
                      </div>

                      {/* Earth Skeleton */}
                      <div className="rounded-lg border border-[#344054] bg-[#080F1C]/90 p-3 backdrop-blur-md">
                        <div className="mb-3 flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className="h-2 w-2 rounded-full bg-[#A7A5FF]/50" />
                            <div className="h-3 w-12 rounded bg-[#26354C]" />
                          </div>
                          <div className="h-2 w-14 rounded bg-[#26354C]" />
                        </div>

                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <div className="h-2 w-14 rounded bg-[#1E2A3E]" />
                            <div className="h-2.5 w-16 rounded bg-[#26354C]" />
                          </div>
                          <div className="flex items-center justify-between">
                            <div className="h-2 w-14 rounded bg-[#1E2A3E]" />
                            <div className="h-2.5 w-12 rounded bg-[#26354C]" />
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Selected site */}

              {site && (
                <div className="pointer-events-none absolute bottom-4 left-4 z-10 rounded-lg border border-[#526783]/60 bg-[#080F1C]/85 px-3 py-2 backdrop-blur-md">
                  <p className="text-[10px] text-[#8198BA]">
                    SELECTED LANDING SITE
                  </p>

                  <p className="mt-1 text-sm font-semibold text-white">
                    {site.name}
                  </p>
                </div>
              )}

              {/* Coordinates */}

              {site && (
                <div className="pointer-events-none absolute bottom-4 right-4 z-10 text-right text-[10px] text-[#A0AFC4]">
                  <p>
                    {site.lon !== null
                      ? `Longitude ${formatLon(site.lon)}`
                      : "Longitude N/A"}
                  </p>

                  <p className="mt-1">
                    {site.lat !== null
                      ? `Latitude ${formatLat(site.lat)}`
                      : "Latitude N/A"}
                  </p>
                </div>
              )}

              {/* Elevation legend */}

              {win && colorMode === "elevation" && (
                <div className="pointer-events-none absolute bottom-20 left-4 z-10 flex items-stretch gap-2 rounded-lg border border-[#344054] bg-[#080F1C]/90 p-2.5 backdrop-blur-md">
                  <div
                    aria-hidden
                    className="w-2.5 rounded-sm"
                    style={{
                      background: legendGradient(-7300, 7100),
                      minHeight: "4rem",
                    }}
                  />

                  <div className="flex flex-col justify-between text-[10px] tabular-nums text-[#A0B4D1]">
                    <span>{formatMeters(Math.round(win.max))}</span>

                    <span>{formatMeters(Math.round(win.min))}</span>
                  </div>
                </div>
              )}

              {/* Loading */}

              {!win && !error && (
                <div
                  role="status"
                  className="absolute inset-0 z-20 flex items-center justify-center bg-black/40"
                >
                  <div className="rounded-lg border border-[#344054] bg-[#0A101C] px-5 py-3 text-xs text-[#9DB4D6]">
                    Loading terrain from the DEM...
                  </div>
                </div>
              )}

              {/* Error */}

              {error && (
                <div
                  role="alert"
                  className="absolute inset-0 z-20 flex items-center justify-center bg-black/70 p-6"
                >
                  <p className="max-w-md rounded-lg border border-white/30 bg-[#0A101C] p-4 text-sm text-[#C9D6EA]">
                    Terrain data could not be loaded: {error}
                  </p>
                </div>
              )}
            </div>

            {liveSky && <SkyTimeline sky={sky} />}

            {/* ======================================
                TERRAIN INSIGHT BAR
            ====================================== */}
          </section>
        </div>
      </div>
    </main>
  );
}
