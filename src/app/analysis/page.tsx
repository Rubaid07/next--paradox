"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Activity,
  Mountain,
  Orbit,
  Waves,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

import { loadHeightmap, loadMeta, loadSites } from "../../lib/data";
import { computeHorizonMask, type HorizonMask } from "../../lib/horizon";
import {
  analyzeSlopeCoverage,
  buildSiteTerrainRaster,
  type SiteTerrainRaster,
  type SlopeCoverage,
  type TerrainRasterLayer,
} from "../../lib/siteAnalysis";
import { createHeightSampler, cropHeightmap } from "../../lib/terrain";
import {
  getSiteIdFromUrl,
  getStoredSiteId,
  setStoredSiteId,
} from "../../lib/selection";
import { isPlaced } from "../../lib/types";
import type { HeightmapLevel, LandingSite, TerrainMeta } from "../../lib/types";

interface TerrainSlope {
  at_site_deg: number;
  mean_deg: number;
  median_deg: number;
  p95_deg: number;
  max_deg: number;
  pct_below: Record<"5" | "10" | "15", number>;
  largest_safe_patch_km2: number;
  site_patch_km2: number;
  safe_slope_limit_deg: number;
}

interface RoughnessScale {
  window_m: number;
  median_m: number;
  p95_m: number;
  at_site_m: number;
}

interface SiteTerrainAnalysis {
  slope: TerrainSlope;
  roughness: Record<string, RoughnessScale>;
  relief: {
    elevation_m: number;
    min_m: number;
    max_m: number;
    relief_m: number;
    site_percentile: number;
    tpi_1km_m: number;
    tpi_radius_m: number;
    position: string;
  };
  horizon: {
    max_deg: number;
    mean_deg: number;
    pct_azimuths_above_2deg: number;
  };
}

interface TerrainAnalysisDataset {
  dem: string;
  cell_m: number;
  radius_m: number;
  sites: Record<string, SiteTerrainAnalysis>;
}

const TERRAIN_WINDOW_KM = 20;
const SITE_RASTER_ZOOM_STEPS = [6, 12, 24, 50, 100] as const;
type SiteRasterZoom = (typeof SITE_RASTER_ZOOM_STEPS)[number];
const SLOPE_THRESHOLDS = [
  { key: "5", label: "< 5°", color: "#68D7B3" },
  { key: "10", label: "< 10°", color: "#A7A5FF" },
  { key: "15", label: "< 15°", color: "#F4C36A" },
] as const;
const ROUGHNESS_SCALES = ["200", "400", "800", "1600"] as const;
const ELEVATION_COLORS = [
  "#141c52",
  "#1e4796",
  "#1d6aa5",
  "#2aa3b8",
  "#7fd1b9",
  "#d7e8a8",
  "#f4d58d",
  "#f2a65a",
  "#fff4e0",
];
const SLOPE_COLORS = ["#120b2c", "#552078", "#a52d70", "#e65b47", "#ffd166"];
const ROUGHNESS_COLORS = [
  "#111748",
  "#25478f",
  "#277fa1",
  "#22b78a",
  "#dbef6c",
];

async function loadTerrainAnalysis(): Promise<TerrainAnalysisDataset> {
  const response = await fetch("/data/terrain_analysis.json", {
    cache: "force-cache",
  });
  if (!response.ok) {
    throw new Error(`/data/terrain_analysis.json returned ${response.status}`);
  }
  return (await response.json()) as TerrainAnalysisDataset;
}

function percentage(value: number) {
  return `${value.toFixed(1)}%`;
}

function meters(value: number) {
  return `${Math.round(value).toLocaleString()} m`;
}

function positionName(position: string) {
  if (position === "floor") return "Crater floor / basin";
  if (position === "crest") return "Rim / ridge crest";
  if (position === "slope") return "Slope / flank";
  return position;
}

function rgbForValue(
  value: number,
  min: number,
  max: number,
  colors: string[],
) {
  const fraction = Math.min(
    1,
    Math.max(0, (value - min) / Math.max(max - min, 1e-6)),
  );
  const scaled = fraction * (colors.length - 1);
  const index = Math.min(Math.floor(scaled), colors.length - 2);
  const t = scaled - index;
  const from = colors[index];
  const to = colors[index + 1];
  const channel = (offset: number) => {
    const a = Number.parseInt(from.slice(offset, offset + 2), 16);
    const b = Number.parseInt(to.slice(offset, offset + 2), 16);
    return Math.round(a + (b - a) * t);
  };
  return [channel(1), channel(3), channel(5)] as const;
}

function percentile(values: Float32Array, fraction: number) {
  const sorted = Array.from(values).sort((a, b) => a - b);
  return (
    sorted[
      Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))
    ] ?? 0
  );
}

function TerrainMapPanel({
  title,
  unit,
  layer,
  raster,
  siteXKm,
  siteZKm,
  colors,
  precision = 0,
  min = layer.min,
  max = layer.max,
}: {
  title: string;
  unit: string;
  layer: TerrainRasterLayer;
  raster: SiteTerrainRaster;
  siteXKm: number;
  siteZKm: number;
  colors: string[];
  precision?: number;
  min?: number;
  max?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const size = raster.size;
  const plotStart = 12;
  const plotSize = 88;
  const cellSizeKm = raster.windowKm / size;
  const siteX =
    plotStart +
    plotSize / 2 +
    ((siteXKm - raster.centerXKm) / raster.windowKm) * plotSize;
  const siteY =
    6 +
    plotSize / 2 +
    ((siteZKm - raster.centerZKm) / raster.windowKm) * plotSize;
  const halfWindow = raster.windowKm / 2;
  const colorGradient = `linear-gradient(to top, ${colors.join(", ")})`;

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    canvas.width = size;
    canvas.height = size;
    const image = context.createImageData(size, size);
    const colorLookup = new Uint8ClampedArray(256 * 3);
    for (let colorIndex = 0; colorIndex < 256; colorIndex++) {
      const [red, green, blue] = rgbForValue(colorIndex, 0, 255, colors);
      colorLookup[colorIndex * 3] = red;
      colorLookup[colorIndex * 3 + 1] = green;
      colorLookup[colorIndex * 3 + 2] = blue;
    }

    for (let index = 0; index < layer.values.length; index++) {
      const value = layer.values[index];
      const colorIndex = Math.round(
        Math.min(1, Math.max(0, (value - min) / Math.max(max - min, 1e-6))) *
          255,
      );
      const pixelIndex = index * 4;
      image.data[pixelIndex] = colorLookup[colorIndex * 3];
      image.data[pixelIndex + 1] = colorLookup[colorIndex * 3 + 1];
      image.data[pixelIndex + 2] = colorLookup[colorIndex * 3 + 2];
      image.data[pixelIndex + 3] = 255;
    }
    context.putImageData(image, 0, 0);
  }, [colors, layer.values, max, min, size]);

  function showCellValue(event: React.PointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width;
    const y = (event.clientY - bounds.top) / bounds.height;
    const plotLeft = plotStart / 112;
    const plotTop = 6 / 112;
    const plotFraction = plotSize / 112;

    if (
      x < plotLeft ||
      x >= plotLeft + plotFraction ||
      y < plotTop ||
      y >= plotTop + plotFraction
    ) {
      setHoveredIndex(null);
      return;
    }

    const col = Math.min(
      size - 1,
      Math.floor(((x - plotLeft) / plotFraction) * size),
    );
    const row = Math.min(
      size - 1,
      Math.floor(((y - plotTop) / plotFraction) * size),
    );
    const index = row * size + col;
    setHoveredIndex((current) => (current === index ? current : index));
  }

  const hoveredCell =
    hoveredIndex === null
      ? null
      : {
          value: layer.values[hoveredIndex],
          col: hoveredIndex % size,
          row: Math.floor(hoveredIndex / size),
        };
  const hoveredEastKm = hoveredCell
    ? -halfWindow +
      (hoveredCell.col + 0.5) * cellSizeKm +
      raster.centerXKm -
      siteXKm
    : null;
  const hoveredNorthKm = hoveredCell
    ? halfWindow -
      (hoveredCell.row + 0.5) * cellSizeKm +
      siteZKm -
      raster.centerZKm
    : null;

  return (
    <figure className="min-w-0 rounded-xl border border-[#1E2A3E] bg-[#090F1B] p-3">
      <figcaption className="mb-2 flex items-baseline justify-between gap-2">
        <span className="truncate text-xs font-semibold text-white">
          {title}
        </span>
        <span className="shrink-0 text-[10px] text-[#8393AD]">{unit}</span>
      </figcaption>
      <div className="grid grid-cols-[minmax(0,1fr)_34px] items-stretch gap-2">
        <div
          role="img"
          aria-label={`${title} map around the selected landing site`}
          className="relative aspect-square w-full overflow-hidden rounded-md border border-[#33445f] bg-[#101827]"
          onPointerMove={showCellValue}
          onPointerLeave={() => setHoveredIndex(null)}
        >
          <canvas
            ref={canvasRef}
            aria-hidden="true"
            className="absolute"
            style={{
              left: `${(plotStart / 112) * 100}%`,
              top: `${(6 / 112) * 100}%`,
              width: `${(plotSize / 112) * 100}%`,
              height: `${(plotSize / 112) * 100}%`,
              imageRendering: "pixelated",
            }}
          />
          <svg
            viewBox="0 0 112 112"
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 h-full w-full"
          >
            <path
              d={`M ${plotStart} 6 V 94 H ${plotStart + plotSize}`}
              fill="none"
              stroke="#dbe6f5"
              strokeOpacity="0.5"
              strokeWidth="0.35"
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={siteX}
              cy={siteY}
              r="2.2"
              fill="#07101c"
              stroke="white"
              strokeWidth="0.7"
            />
            <path
              d={`M ${siteX - 1.5} ${siteY} H ${siteX + 1.5} M ${siteX} ${siteY - 1.5} V ${siteY + 1.5}`}
              stroke="white"
              strokeWidth="0.55"
              vectorEffect="non-scaling-stroke"
            />
            <text
              x="12"
              y="106"
              fill="#c6d3e7"
              fontSize="4.5"
              textAnchor="middle"
            >
              −{halfWindow.toFixed(0)}
            </text>
            <text
              x="56"
              y="106"
              fill="#c6d3e7"
              fontSize="4.5"
              textAnchor="middle"
            >
              0
            </text>
            <text
              x="100"
              y="106"
              fill="#c6d3e7"
              fontSize="4.5"
              textAnchor="middle"
            >
              +{halfWindow.toFixed(0)}
            </text>
            <text x="1" y="8" fill="#c6d3e7" fontSize="4.5" textAnchor="start">
              +{halfWindow.toFixed(0)}
            </text>
            <text x="1" y="51" fill="#c6d3e7" fontSize="4.5" textAnchor="start">
              0
            </text>
            <text x="1" y="94" fill="#c6d3e7" fontSize="4.5" textAnchor="start">
              −{halfWindow.toFixed(0)}
            </text>
          </svg>
        </div>
        <div className="flex flex-col items-center justify-between py-1 text-[9px] tabular-nums text-[#9FB0CC]">
          <span>{max.toFixed(precision)}</span>
          <span
            aria-hidden="true"
            className="my-1 min-h-20 w-2 flex-1 rounded-full"
            style={{ background: colorGradient }}
          />
          <span>{min.toFixed(precision)}</span>
        </div>
      </div>
      <p className="mt-1.5 min-h-4 text-center text-[9px] text-[#9FB0CC]">
        {hoveredCell && hoveredEastKm !== null && hoveredNorthKm !== null
          ? `E ${hoveredEastKm.toFixed(2)} km · N ${hoveredNorthKm.toFixed(2)} km · ${hoveredCell.value.toFixed(1)} ${unit}`
          : "West ← 0 → East (km) · North is up · hover for cell value"}
      </p>
    </figure>
  );
}

function SiteTerrainMaps({
  raster,
  siteName,
  siteXKm,
  siteZKm,
  resolutionM,
  mapWindowKm,
  onMapWindowChange,
}: {
  raster: SiteTerrainRaster;
  siteName: string;
  siteXKm: number;
  siteZKm: number;
  resolutionM: number;
  mapWindowKm: SiteRasterZoom;
  onMapWindowChange: (windowKm: SiteRasterZoom) => void;
}) {
  const roughnessMax = Math.max(percentile(raster.roughness.values, 0.95), 1);
  const zoomIndex = SITE_RASTER_ZOOM_STEPS.indexOf(mapWindowKm);

  return (
    <MetricCard
      title={`Local maps · ${siteName} at crosshair`}
      icon={<Mountain size={17} />}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-[#9FB0CC]">
          Map width:{" "}
          <span className="font-semibold text-white">{mapWindowKm} km</span>
          <span className="ml-2 text-[#637795]">
            Crosshair stays on the selected site.
          </span>
        </p>
        <div
          role="group"
          aria-label="Local terrain map zoom"
          className="inline-flex items-center gap-1 rounded-xl border border-[#26354C] bg-[#070B13] p-1"
        >
          <button
            type="button"
            aria-label={`Zoom in to ${SITE_RASTER_ZOOM_STEPS[zoomIndex - 1] ?? mapWindowKm} km map width`}
            title="Zoom in"
            disabled={zoomIndex === 0}
            onClick={() =>
              onMapWindowChange(SITE_RASTER_ZOOM_STEPS[zoomIndex - 1])
            }
            className="flex h-9 w-9 items-center justify-center rounded-lg text-[#C7C3FF] transition-colors hover:bg-[#A7A5FF]/15 disabled:cursor-not-allowed disabled:opacity-35"
          >
            <ZoomIn size={17} />
          </button>
          <span className="min-w-[48px] text-center text-xs font-semibold tabular-nums text-white">
            {mapWindowKm} km
          </span>
          <button
            type="button"
            aria-label={`Zoom out to ${SITE_RASTER_ZOOM_STEPS[zoomIndex + 1] ?? mapWindowKm} km map width`}
            title="Zoom out"
            disabled={zoomIndex === SITE_RASTER_ZOOM_STEPS.length - 1}
            onClick={() =>
              onMapWindowChange(SITE_RASTER_ZOOM_STEPS[zoomIndex + 1])
            }
            className="flex h-9 w-9 items-center justify-center rounded-lg text-[#C7C3FF] transition-colors hover:bg-[#A7A5FF]/15 disabled:cursor-not-allowed disabled:opacity-35"
          >
            <ZoomOut size={17} />
          </button>
        </div>
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <TerrainMapPanel
          title="Elevation"
          unit="m"
          layer={raster.elevation}
          raster={raster}
          siteXKm={siteXKm}
          siteZKm={siteZKm}
          colors={ELEVATION_COLORS}
        />
        <TerrainMapPanel
          title="Slope"
          unit="degrees"
          layer={raster.slope}
          raster={raster}
          siteXKm={siteXKm}
          siteZKm={siteZKm}
          colors={SLOPE_COLORS}
          min={0}
          max={30}
        />
        <TerrainMapPanel
          title="Surface roughness · local RMS"
          unit="m"
          layer={raster.roughness}
          raster={raster}
          siteXKm={siteXKm}
          siteZKm={siteZKm}
          colors={ROUGHNESS_COLORS}
          min={0}
          max={roughnessMax}
          precision={1}
        />
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-[10px] leading-relaxed text-[#637795]">
        <span>
          {raster.windowKm.toFixed(1)} × {raster.windowKm.toFixed(1)} km area ·{" "}
          {raster.cellSizeM} m map cell
        </span>
        <span>
          Source DEM: {resolutionM} m; the wider views aggregate source cells
          for display.
        </span>
        <span>
          Roughness is detrended RMS over a 3×3-cell (~
          {((raster.cellSizeM * 3) / 1000).toFixed(1)} km) window; colors are
          clipped at the local 95th percentile; sub-pixel boulders are not
          resolved.
        </span>
      </div>
    </MetricCard>
  );
}

function MetricCard({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-[#1E2A3E] bg-[#080D18]/80 p-5 sm:p-6">
      <div className="mb-5 flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#34445e] bg-[#111a2b] text-[#A7A5FF]">
          {icon}
        </span>
        <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-[#DCE5F5]">
          {title}
        </h2>
      </div>
      {children}
    </section>
  );
}

function SlopeBar({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3 text-sm">
        <span className="text-[#A9B8D0]">Area with slope {label}</span>
        <span className="font-semibold tabular-nums text-white">
          {percentage(value)}
        </span>
      </div>
      <div
        role="img"
        aria-label={`${percentage(value)} of the area has slope ${label}`}
        className="h-2 overflow-hidden rounded-full bg-[#1B2434]"
      >
        <div
          className="h-full rounded-full"
          style={{ width: `${value}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

function HorizonPlot({ mask }: { mask: HorizonMask }) {
  const maxAngle = Math.max(
    5,
    Math.ceil(Math.max(...Array.from(mask.el)) / 5) * 5,
  );
  const points = Array.from(mask.el, (elevation, index) => {
    const azimuth = (index / mask.el.length) * 2 * Math.PI;
    const radius = (70 * Math.max(0, elevation)) / maxAngle;
    return `${100 + radius * Math.sin(azimuth)},${100 - radius * Math.cos(azimuth)}`;
  });
  const path = `M ${points.join(" L ")} Z`;
  const mean = mask.el.reduce((sum, value) => sum + value, 0) / mask.el.length;
  const max = Math.max(...Array.from(mask.el));
  const blockedAzimuths =
    (mask.el.filter((elevation) => elevation > 2).length / mask.el.length) *
    100;

  return (
    <div className="grid items-center gap-5 sm:grid-cols-[minmax(190px,0.8fr)_1fr]">
      <div className="mx-auto w-full max-w-[250px]">
        <svg
          viewBox="0 0 200 200"
          role="img"
          aria-label="Terrain horizon elevation by azimuth"
        >
          {[17.5, 35, 52.5, 70].map((radius) => (
            <circle
              key={radius}
              cx="100"
              cy="100"
              r={radius}
              fill="none"
              stroke="#26354C"
              strokeWidth="1"
            />
          ))}
          <path
            d="M 100 27 V 173 M 27 100 H 173"
            stroke="#34445e"
            strokeWidth="1"
          />
          <path
            d={path}
            fill="rgba(167,165,255,0.32)"
            stroke="#A7A5FF"
            strokeWidth="2"
          />
          <text x="100" y="13" textAnchor="middle" fill="#9FB0CC" fontSize="10">
            N
          </text>
          <text
            x="188"
            y="103"
            textAnchor="middle"
            fill="#9FB0CC"
            fontSize="10"
          >
            E
          </text>
          <text
            x="100"
            y="196"
            textAnchor="middle"
            fill="#9FB0CC"
            fontSize="10"
          >
            S
          </text>
          <text x="12" y="103" textAnchor="middle" fill="#9FB0CC" fontSize="10">
            W
          </text>
        </svg>
        <p className="mt-1 text-center text-[10px] uppercase tracking-[0.14em] text-[#637795]">
          North-up · clockwise azimuth · scale 0–{maxAngle}°
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <ValueTile label="Maximum skyline" value={`${max.toFixed(1)}°`} />
        <ValueTile label="Mean skyline" value={`${mean.toFixed(1)}°`} />
        <ValueTile label="Azimuths > 2°" value={percentage(blockedAzimuths)} />
        <ValueTile
          label="Ray range"
          value={`up to ${mask.rangeKm.toFixed(0)} km`}
        />
      </div>
    </div>
  );
}

function ValueTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[#1E2A3E] bg-[#0A111E] px-3 py-3">
      <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-[#6E7F9E]">
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-white">
        {value}
      </p>
    </div>
  );
}

export default function AnalysisPage() {
  const [sites, setSites] = useState<LandingSite[]>([]);
  const [meta, setMeta] = useState<TerrainMeta | null>(null);
  const [level, setLevel] = useState<HeightmapLevel | null>(null);
  const [heights, setHeights] = useState<Float32Array | null>(null);
  const [analysis, setAnalysis] = useState<TerrainAnalysisDataset | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [radiusKm, setRadiusKm] = useState<5 | 10>(5);
  const [mapWindowKm, setMapWindowKm] = useState<SiteRasterZoom>(12);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [loadedSites, loadedMeta, loadedAnalysis] = await Promise.all([
          loadSites(),
          loadMeta(),
          loadTerrainAnalysis(),
        ]);
        if (cancelled) return;

        const finestLevel = [...loadedMeta.levels].sort(
          (a, b) => a.cellSizeM - b.cellSizeM,
        )[0];
        if (!finestLevel)
          throw new Error("No terrain heightmap level is available.");

        const placed = loadedSites.filter(isPlaced);
        const requestedIds = [getSiteIdFromUrl(), getStoredSiteId()];
        const initialId =
          requestedIds.find(
            (id) => id && placed.some((site) => site.id === id),
          ) ??
          placed[0]?.id ??
          null;

        setSites(loadedSites);
        setMeta(loadedMeta);
        setAnalysis(loadedAnalysis);
        setLevel(finestLevel);
        setSelectedId(initialId);

        const loadedHeights = await loadHeightmap(finestLevel);
        if (!cancelled) setHeights(loadedHeights);
      } catch (cause: unknown) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const placedSites = useMemo(() => sites.filter(isPlaced), [sites]);
  const site = useMemo(
    () => placedSites.find((candidate) => candidate.id === selectedId) ?? null,
    [placedSites, selectedId],
  );
  const siteAnalysis = site ? (analysis?.sites[site.id] ?? null) : null;
  const extentKm = meta?.coverage.extentKm[0] ?? 608;

  const coarseSlope = useMemo<SlopeCoverage | null>(() => {
    if (radiusKm !== 10 || !site || !heights || !level) return null;
    return analyzeSlopeCoverage(
      heights,
      level.width,
      extentKm,
      site.world.x_km,
      site.world.z_km,
      radiusKm,
    );
  }, [radiusKm, site, heights, level, extentKm]);

  const horizon = useMemo(() => {
    if (!site || !heights || !level) return null;
    const window = cropHeightmap(
      heights,
      level.width,
      extentKm,
      site.world.x_km,
      site.world.z_km,
      TERRAIN_WINDOW_KM,
    );
    const sampleHeightKm = createHeightSampler(
      window.heights,
      window.size,
      window.windowKm,
    );
    return computeHorizonMask(
      (x, z) => sampleHeightKm(x, z) * 1000,
      site.world.x_km - window.centerX,
      site.world.z_km - window.centerZ,
      window.windowKm,
      { stepKm: 0.1 },
    );
  }, [site, heights, level, extentKm]);

  const terrainRaster = useMemo(() => {
    if (!site || !heights || !level) return null;
    return buildSiteTerrainRaster(
      heights,
      level.width,
      extentKm,
      site.world.x_km,
      site.world.z_km,
      mapWindowKm,
    );
  }, [site, heights, level, extentKm, mapWindowKm]);

  const selectedSlope = radiusKm === 5 ? null : coarseSlope;
  const slopeValues =
    radiusKm === 5
      ? siteAnalysis?.slope.pct_below
      : selectedSlope
        ? {
            "5": selectedSlope.below5Pct,
            "10": selectedSlope.below10Pct,
            "15": selectedSlope.below15Pct,
          }
        : null;

  function selectSite(id: string) {
    setSelectedId(id);
    setStoredSiteId(id);
    window.history.replaceState(
      null,
      "",
      `/analysis?site=${encodeURIComponent(id)}`,
    );
  }

  return (
    <main className="min-h-full bg-[#05080F] px-4 pb-32 pt-6 text-[#E8EAED] sm:px-6 sm:pt-8">
      <div className="mx-auto max-w-[1440px] space-y-5">
        {/* Page Header - Same style as Comparison & Report */}
        <header className="mb-6 flex flex-col items-center justify-center gap-4 pt-1">
          <div className="text-center">
            <h1 className="text-[13px] font-semibold tracking-[0.3em] text-[#F1F6FF] sm:text-base">
              MISSION ANALYSIS
            </h1>

            <p className="mt-2 max-w-2xl text-center text-[12px] leading-relaxed text-[#9099a5]">
              Slope safety, surface roughness, local relief, and terrain-blocked
              horizon from the available LOLA elevation data.
            </p>
          </div>
        </header>

        {loading && (
          <div
            role="status"
            className="rounded-2xl border border-[#1E2A3E] bg-[#080D18] p-8 text-center text-sm text-[#9FB0CC]"
          >
            Loading landing sites and terrain data…
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="rounded-2xl border border-red-400/30 bg-red-950/20 p-5 text-sm text-red-200"
          >
            <p className="font-semibold">
              Terrain analysis could not be loaded.
            </p>
            <p className="mt-1 break-words text-red-200/80">{error}</p>
          </div>
        )}

        {!loading && !error && (
          <>
            <section className="rounded-2xl border border-[#1E2A3E] bg-[#080D18]/80 p-4 sm:p-5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-[#8393AD]">
                  Select a landing site
                </h2>
                {site && (
                  <p className="text-[11px] tabular-nums text-[#6E7F9E]">
                    {site.lat?.toFixed(3)}° · {site.lon?.toFixed(3)}° ·{" "}
                    {site.positionKind.replaceAll("_", " ")}
                  </p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {placedSites.map((candidate) => {
                  const active = candidate.id === selectedId;
                  return (
                    <button
                      key={candidate.id}
                      type="button"
                      onClick={() => selectSite(candidate.id)}
                      aria-pressed={active}
                      className={
                        "rounded-xl border px-3 py-3 text-left transition-colors " +
                        (active
                          ? "border-[#A7A5FF]/70 bg-[#A7A5FF]/[0.10]"
                          : "border-[#1E2A3E] bg-[#0A111E] hover:border-[#A7A5FF]/40")
                      }
                    >
                      <span className="block truncate text-xs font-semibold text-white">
                        {candidate.name}
                      </span>
                      <span className="mt-1 block text-[10px] text-[#6E7F9E]">
                        {candidate.artemisRegion ?? "Lunar feature coordinate"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            {site && (
              <>
                {terrainRaster && level && (
                  <SiteTerrainMaps
                    raster={terrainRaster}
                    siteName={site.name}
                    siteXKm={site.world.x_km}
                    siteZKm={site.world.z_km}
                    resolutionM={level.cellSizeM}
                    mapWindowKm={mapWindowKm}
                    onMapWindowChange={setMapWindowKm}
                  />
                )}

                <MetricCard
                  title="Slope coverage · landing safety"
                  icon={<Activity size={17} />}
                >
                  <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <p className="text-sm text-[#9FB0CC]">
                        Share of circular area with slope below each threshold
                      </p>
                      <p className="mt-1 text-[11px] text-[#637795]">
                        A low slope is a screening indicator, not a
                        landing-safety guarantee.
                      </p>
                    </div>
                    <div
                      className="inline-flex rounded-xl border border-[#26354C] bg-[#070B13] p-1"
                      role="group"
                      aria-label="Slope analysis radius"
                    >
                      {[5, 10].map((radius) => (
                        <button
                          key={radius}
                          type="button"
                          aria-pressed={radiusKm === radius}
                          onClick={() => setRadiusKm(radius as 5 | 10)}
                          className={
                            "rounded-lg px-4 py-2 text-xs font-semibold transition-colors " +
                            (radiusKm === radius
                              ? "bg-[#A7A5FF]/20 text-[#D2CEFF]"
                              : "text-[#7F93B3] hover:text-white")
                          }
                        >
                          {radius} km radius
                        </button>
                      ))}
                    </div>
                  </div>

                  {slopeValues ? (
                    <>
                      <div className="grid gap-4 sm:grid-cols-3">
                        {SLOPE_THRESHOLDS.map((threshold) => (
                          <div
                            key={threshold.key}
                            className="rounded-xl border border-[#1E2A3E] bg-[#0A111E] p-4"
                          >
                            <SlopeBar
                              label={threshold.label}
                              value={slopeValues[threshold.key]}
                              color={threshold.color}
                            />
                          </div>
                        ))}
                      </div>
                      <p className="mt-4 text-[11px] leading-relaxed text-[#637795]">
                        {radiusKm === 5
                          ? `5 km values use the precomputed ${analysis?.cell_m ?? 80} m source DEM analysis.`
                          : `10 km values are calculated from the ${level?.cellSizeM ?? 400} m heightmap; small-scale hazards are not resolved.`}
                      </p>
                    </>
                  ) : (
                    <p className="rounded-xl border border-[#1E2A3E] p-4 text-sm text-[#9FB0CC]">
                      Slope coverage is unavailable for this site.
                    </p>
                  )}
                  {radiusKm === 10 && coarseSlope && (
                    <p className="mt-2 text-[10px] text-[#526783]">
                      {coarseSlope.samples.toLocaleString()} DEM cells inside
                      the radius.
                    </p>
                  )}
                </MetricCard>

                <div className="grid gap-5 xl:grid-cols-2">
                  <MetricCard
                    title="Surface roughness"
                    icon={<Waves size={17} />}
                  >
                    {siteAnalysis ? (
                      <>
                        <div className="overflow-x-auto">
                          <table className="w-full min-w-[520px] text-left text-xs">
                            <thead className="text-[10px] uppercase tracking-[0.1em] text-[#6E7F9E]">
                              <tr className="border-b border-[#1E2A3E]">
                                <th className="pb-3 pr-3 font-medium">
                                  Baseline
                                </th>
                                <th className="pb-3 pr-3 font-medium">
                                  Window
                                </th>
                                <th className="pb-3 pr-3 font-medium">
                                  Median
                                </th>
                                <th className="pb-3 pr-3 font-medium">
                                  95th pct.
                                </th>
                                <th className="pb-3 font-medium">At site</th>
                              </tr>
                            </thead>
                            <tbody>
                              {ROUGHNESS_SCALES.map((scale) => {
                                const roughness = siteAnalysis.roughness[scale];
                                if (!roughness) return null;
                                return (
                                  <tr
                                    key={scale}
                                    className="border-b border-[#1E2A3E]/70 last:border-0"
                                  >
                                    <td className="py-3 pr-3 font-medium text-white">
                                      {scale} m
                                    </td>
                                    <td className="py-3 pr-3 tabular-nums text-[#9FB0CC]">
                                      {roughness.window_m} m
                                    </td>
                                    <td className="py-3 pr-3 tabular-nums text-[#C7C3FF]">
                                      {roughness.median_m.toFixed(2)} m
                                    </td>
                                    <td className="py-3 pr-3 tabular-nums text-[#F4C36A]">
                                      {roughness.p95_m.toFixed(2)} m
                                    </td>
                                    <td className="py-3 tabular-nums text-white">
                                      {roughness.at_site_m.toFixed(2)} m
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                        <p className="mt-4 text-[11px] leading-relaxed text-[#637795]">
                          Height variation at multiple baselines helps flag
                          uneven terrain; this DEM cannot identify individual
                          boulders smaller than its 80 m source cells.
                        </p>
                      </>
                    ) : (
                      <p className="text-sm text-[#9FB0CC]">
                        Roughness data is unavailable for this site.
                      </p>
                    )}
                  </MetricCard>

                  <MetricCard
                    title="Relief · local terrain position"
                    icon={<Mountain size={17} />}
                  >
                    {siteAnalysis ? (
                      <>
                        <div className="grid grid-cols-2 gap-3">
                          <ValueTile
                            label="5 km relief"
                            value={meters(siteAnalysis.relief.relief_m)}
                          />
                          <ValueTile
                            label="Site elevation"
                            value={meters(siteAnalysis.relief.elevation_m)}
                          />
                          <ValueTile
                            label="Area minimum"
                            value={meters(siteAnalysis.relief.min_m)}
                          />
                          <ValueTile
                            label="Area maximum"
                            value={meters(siteAnalysis.relief.max_m)}
                          />
                        </div>
                        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#26354C] bg-[#0A111E] px-4 py-3">
                          <span className="text-xs text-[#9FB0CC]">
                            Terrain position in local relief
                          </span>
                          <span className="rounded-full border border-[#A7A5FF]/40 px-3 py-1 text-xs font-semibold text-[#C7C3FF]">
                            {positionName(siteAnalysis.relief.position)}
                          </span>
                        </div>
                        <div className="mt-3 flex flex-wrap justify-between gap-2 text-[11px] text-[#6E7F9E]">
                          <span>
                            Site elevation percentile:{" "}
                            {siteAnalysis.relief.site_percentile.toFixed(1)}%
                          </span>
                          <span>5 km circular neighborhood</span>
                        </div>
                        {site.positionKind === "feature_center" && (
                          <div className="mt-4 flex gap-2 rounded-xl border border-[#F4C36A]/30 bg-[#F4C36A]/[0.06] p-3 text-xs leading-relaxed text-[#E7D2A6]">
                            <AlertTriangle
                              size={15}
                              className="mt-0.5 shrink-0"
                            />
                            <span>
                              This coordinate marks a feature center, not a
                              verified landing point. The elevation model
                              classifies it as{" "}
                              {positionName(
                                siteAnalysis.relief.position,
                              ).toLowerCase()}
                              . Confirm the coordinates before interpreting it
                              as a crater-rim site.
                            </span>
                          </div>
                        )}
                      </>
                    ) : (
                      <p className="text-sm text-[#9FB0CC]">
                        Relief data is unavailable for this site.
                      </p>
                    )}
                  </MetricCard>
                </div>

                <MetricCard
                  title="Terrain horizon mask"
                  icon={<Orbit size={17} />}
                >
                  {horizon ? (
                    <>
                      <HorizonPlot mask={horizon} />
                      <p className="mt-4 text-[11px] leading-relaxed text-[#637795]">
                        Each azimuth shows the highest terrain elevation above
                        the local horizontal. Rays are sampled from the 400 m
                        DEM within a window extending about 10 km from the site;
                        lunar surface curvature is applied, but distant terrain
                        is not included.
                      </p>
                    </>
                  ) : (
                    <p className="text-sm text-[#9FB0CC]">
                      Horizon mask is unavailable for this site.
                    </p>
                  )}
                </MetricCard>
              </>
            )}
          </>
        )}
      </div>
    </main>
  );
}
