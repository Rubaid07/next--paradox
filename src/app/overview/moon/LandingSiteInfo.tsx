"use client";

import { formatKm, formatLat, formatLon, formatMeters } from "../../../lib/format";
import type { LandingSite } from "../../../lib/types";

interface LandingSiteInfoProps {
  site: LandingSite | null;
  onFocus: () => void;
  canFocus: boolean;
}

const KIND_LABEL: Record<LandingSite["positionKind"], string> = {
  candidate_landing_site: "Candidate landing site inside the region",
  feature_center: "Center of the named crater",
  unresolved: "No verified position",
};

const VERIFICATION_LABEL: Record<LandingSite["verification"], string> = {
  primary: "Primary source (USGS or peer-reviewed)",
  secondary: "Secondary source",
  none: "None found",
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="shrink-0 text-ink-500">{label}</dt>
      <dd className="text-right tabular-nums text-ink-100">{children}</dd>
    </div>
  );
}

export default function LandingSiteInfo({ site, onFocus, canFocus }: LandingSiteInfoProps) {
  if (!site) {
    return (
      <section aria-live="polite" className="px-4 py-5 text-[13px] leading-relaxed text-ink-300">
        Select a site from the list or click a marker on the terrain to see its coordinates and elevation.
      </section>
    );
  }

  const placed = site.status === "placed";
  const statusStyle =
    site.status === "placed"
      ? "border-glow/40 text-glow-soft"
      : site.status === "outside_coverage"
        ? "border-rose-400/50 text-rose-300"
        : "border-amber-400/50 text-amber-300";
  const statusText =
    site.status === "placed" ? "Placed on terrain" : site.status === "outside_coverage" ? "Outside DEM coverage" : "Not placed";

  return (
    <section aria-live="polite" className="px-4 py-4 text-[13px]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold leading-tight text-ink-100">{site.name}</h2>
          {site.artemisRegion && <p className="mt-0.5 text-xs text-ink-500">{site.artemisRegion}</p>}
        </div>
        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] ${statusStyle}`}>{statusText}</span>
      </div>

      {!placed && <p className="mt-3 rounded-md border border-line-strong bg-space-850 p-2.5 leading-relaxed text-ink-300">{site.statusReason}</p>}

      {site.lat !== null && site.lon !== null && (
        <dl className="mt-3 divide-y divide-line border-y border-line">
          <Row label="Latitude">{formatLat(site.lat)}</Row>
          <Row label="Longitude">{formatLon(site.lon)}</Row>
          {placed && (
            <>
              <Row label="Elevation (80 m DEM)">{formatMeters(site.elevation_m, 0)}</Row>
              {site.local && (
                <Row label={`Range within ${site.local.radius_m / 1000} km`}>
                  {formatMeters(site.local.min_m)} to {formatMeters(site.local.max_m)}
                </Row>
              )}
              {site.distanceFromPole_km !== undefined && <Row label="Distance from pole">{formatKm(site.distanceFromPole_km)}</Row>}
            </>
          )}
        </dl>
      )}

      <dl className="mt-3 space-y-1.5 text-xs leading-relaxed">
        <div>
          <dt className="inline text-ink-500">Position basis: </dt>
          <dd className="inline text-ink-300">{KIND_LABEL[site.positionKind]}</dd>
        </div>
        <div>
          <dt className="inline text-ink-500">Verification: </dt>
          <dd className="inline text-ink-300">{VERIFICATION_LABEL[site.verification]}</dd>
        </div>
        {site.source && (
          <div>
            <dt className="inline text-ink-500">Source: </dt>
            <dd className="inline">
              <a
                href={site.source.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-glow underline decoration-glow/40 underline-offset-2 hover:decoration-glow focus-visible:outline focus-visible:outline-2 focus-visible:outline-glow"
              >
                {site.source.label}
              </a>
            </dd>
          </div>
        )}
      </dl>

      {site.note && <p className="mt-3 text-xs leading-relaxed text-ink-300">{site.note}</p>}

      {placed && (
        <p className="mt-3 text-[11px] leading-relaxed text-ink-500">
          Elevation is the DEM value at this point, relative to the 1,737.4 km lunar reference sphere. It is not a surveyed
          landing elevation.
        </p>
      )}

      <button
        type="button"
        onClick={onFocus}
        disabled={!canFocus}
        className="mt-4 w-full rounded-md bg-glow/15 px-3 py-2 text-sm font-medium text-glow-soft transition-colors hover:bg-glow/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-glow disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-glow/15"
      >
        Zoom to site
      </button>
    </section>
  );
}
