"use client";

import { formatKm } from "../../../lib/format";
import type { HeightmapLevel, TerrainMeta } from "../../../lib/types";

export default function DatasetSummary({ meta, level }: { meta: TerrainMeta; level: HeightmapLevel | null }) {
  const [w, h] = meta.coverage.extentKm;
  const rows: [string, string][] = [
    ["File", meta.source.file],
    ["Grid", `${meta.raster.width} × ${meta.raster.height} px, ${meta.raster.pixelSize_m} m`],
    ["Projection", `South polar stereographic, sphere R ${(meta.crs.radius_m / 1000).toFixed(1)} km`],
    ["Extent", `${formatKm(w, 0)} × ${formatKm(h, 0)}; all longitudes south of ${Math.abs(meta.coverage.fullLongitudeCoverageSouthOfLat).toFixed(1)}° S`],
    [
      "Elevation",
      `${Math.round(meta.elevation.min_m).toLocaleString("en-US")} to ${Math.round(meta.elevation.max_m).toLocaleString("en-US")} m`,
    ],
    ["Mesh", level ? `${level.width} × ${level.height}, block mean of ${level.factor} × ${level.factor} px` : "loading"],
  ];

  return (
    <section aria-label="Dataset" className="px-4 py-4">
      <h2 className="pb-2 text-xs font-medium text-ink-500">Terrain data</h2>
      <dl className="space-y-1.5 text-xs">
        {rows.map(([k, v]) => (
          <div key={k} className="flex gap-3">
            <dt className="w-[4.5rem] shrink-0 text-ink-500">{k}</dt>
            <dd className="min-w-0 break-words text-ink-300">{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
