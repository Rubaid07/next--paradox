"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { HOME_DIRECTION, HOME_DISTANCE, HOME_TARGET } from "../../../lib/camera";
import { loadHeightmap, loadMeta } from "../../../lib/data";
import { createHeightSampler } from "../../../lib/terrain";
import { overviewHref } from "../../../lib/selection";
import {
  isPlaced,
  type HeightmapLevel,
  type LandingSite,
  type TerrainMeta,
  type ViewRequest,
  type ViewSettings,
} from "../../../lib/types";

const LunarScene = dynamic(() => import("./LunarScene"), { ssr: false });

// Default settings configured as requested
const DEFAULT_SETTINGS: ViewSettings = {
  exaggeration: 2, // Changed to 2x
  sunAzimuth: 315,
  sunElevation: 12,
  shadows: true,
  colorMode: "neutral", // Changed to neutral
  showLabels: true,
  levelId: "x8",
};

interface TerrainState {
  level: HeightmapLevel;
  heights: Float32Array;
}

interface LunarViewerProps {
  sites?: LandingSite[];
  selectedId?: string | null;
  onSelectSite?: (id: string) => void;
}

export default function LunarViewer({
  sites = [],
  selectedId = null,
  onSelectSite,
}: LunarViewerProps) {
  const [meta, setMeta] = useState<TerrainMeta | null>(null);
  const [terrain, setTerrain] = useState<TerrainState | null>(null);
  // Settings state initialized with our new defaults
  const [settings, setSettings] = useState<ViewSettings>(DEFAULT_SETTINGS);
  const [viewRequest, setViewRequest] = useState<ViewRequest | null>(null);
  const [loadingMesh, setLoadingMesh] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const nonce = useRef(0);
  const cache = useRef(new Map<string, Float32Array>());

  useEffect(() => {
    let cancelled = false;
    loadMeta()
      .then((m) => {
        if (cancelled) return;
        setMeta(m);
        setSettings((prev) =>
          m.levels.some((l) => l.id === prev.levelId)
            ? prev
            : { ...prev, levelId: m.levels[0].id },
        );
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!meta) return;
    const level = meta.levels.find((l) => l.id === settings.levelId);
    if (!level) return;
    let cancelled = false;
    const cached = cache.current.get(level.id);
    const pending = cached ? Promise.resolve(cached) : loadHeightmap(level);
    pending
      .then((heights) => {
        if (cancelled) return;
        cache.current.set(level.id, heights);
        setTerrain({ level, heights });
        setLoadingMesh(false);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setLoadingMesh(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [meta, settings.levelId]);

  const extentKm = meta?.coverage.extentKm[0] ?? 608;

  const sampler = useMemo(
    () =>
      terrain
        ? createHeightSampler(terrain.heights, terrain.level.width, extentKm)
        : null,
    [terrain, extentKm],
  );

  const placedSites = useMemo(() => sites.filter(isPlaced), [sites]);

  const selectedSite = useMemo(
    () => sites.find((s) => s.id === selectedId) ?? null,
    [sites, selectedId],
  );

  const focusSite = useCallback(
    (site: LandingSite | null) => {
      if (!site || !isPlaced(site) || !sampler) return;
      const { x_km, z_km } = site.world;
      setViewRequest({
        nonce: ++nonce.current,
        target: [x_km, sampler(x_km, z_km) * settings.exaggeration, z_km],
        distance: 70,
      });
    },
    [sampler, settings.exaggeration],
  );

  useEffect(() => {
    if (selectedSite) {
      focusSite(selectedSite);
    }
  }, [selectedSite, focusSite]);

  const selectFromScene = useCallback(
    (id: string) => {
      if (onSelectSite) onSelectSite(id);
    },
    [onSelectSite],
  );

  return (
    <div className="flex h-full w-full flex-col bg-space-950 text-ink-100 rounded-lg overflow-hidden relative">
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <section
          className="relative min-h-0 flex-1 bg-space-950"
          aria-label="3D terrain viewer"
        >
          {/* Top Right Button */}
          <div className="absolute top-3 right-3 z-10">
            <Link
              href={overviewHref(selectedId)}
              className="rounded border border-[#33415e] bg-[#0d1525]/90 px-3 py-1.5 text-[11px] font-medium text-slate-300 backdrop-blur transition-colors hover:bg-[#18233b] hover:text-white"
            >
              Open site 3D overview →
            </Link>
          </div>

          {terrain && sampler && (
            <LunarScene
              heights={terrain.heights}
              size={terrain.level.width}
              extentKm={extentKm}
              settings={settings}
              sites={placedSites}
              selectedId={selectedId}
              sampler={sampler}
              viewRequest={viewRequest}
              onSelect={selectFromScene}
            />
          )}

          {/* TerrainControls component has been completely removed from here */}

          {loadingMesh && !error && (
            <div
              role="status"
              className="absolute inset-x-0 bottom-4 flex justify-center"
            >
              <span className="rounded-full border border-line-strong bg-space-900/90 px-3 py-1.5 text-xs text-ink-300 backdrop-blur">
                {terrain
                  ? "Switching mesh detail…"
                  : "Loading terrain from the DEM…"}
              </span>
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="absolute inset-0 flex items-center justify-center p-6"
            >
              <div className="max-w-md rounded-lg border border-rose-400/40 bg-space-900 p-4 text-sm leading-relaxed text-ink-300">
                <p className="font-medium text-rose-300">
                  Terrain data could not be loaded
                </p>
                <p className="mt-1">{error}</p>
                <p className="mt-2 text-xs text-ink-500">
                  Run <code className="text-ink-300">npm run build:data</code>{" "}
                  to generate the files in public/data from the GeoTIFF.
                </p>
              </div>
            </div>
          )}

          {/* Zoom to site button */}
          <button
            onClick={() => focusSite(selectedSite)}
            disabled={!selectedSite || !isPlaced(selectedSite)}
            className="absolute bottom-3 right-3 z-10 rounded border border-[#33415e] bg-[#0d1525]/90 px-3 py-1.5 text-[11px] font-medium text-slate-300 backdrop-blur transition-colors hover:bg-[#18233b] hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Zoom to site
          </button>
        </section>
      </main>
    </div>
  );
}
