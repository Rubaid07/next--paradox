/**
 * Terrain horizon mask from the DEM window the page already loads.
 *
 * Horizons gives Az/El against the *smooth* Moon (airless, site altitude 0). A body is only really
 * visible when its elevation is above the terrain skyline in that azimuth, so Sun / Earth visibility
 * must be tested against this mask - otherwise a polar site looks "100 % sunlit, 0 h dark".
 *
 * Azimuth convention = Horizons = SiteScene: clockwise from north (-Z) towards east (+X).
 * Limitation: only terrain inside the loaded window (windowKm / 2 from the site) is seen.
 */
export interface HorizonMask {
  stepDeg: number;
  /** skyline elevation (deg) per azimuth bin, bin i = i * stepDeg */
  el: Float32Array;
  rangeKm: number;
}

const MOON_R_KM = 1737.4;

export function computeHorizonMask(
  sample: (xKm: number, zKm: number) => number, // metres
  x0: number,
  z0: number,
  windowKm: number,
  opts: {
    observerHeightM?: number;
    stepKm?: number;
    azCount?: number;
    maxRangeKm?: number;
  } = {},
): HorizonMask {
  const n = opts.azCount ?? 360;
  const half = windowKm / 2;
  const step = opts.stepKm ?? Math.max(0.1, windowKm / 600);
  const maxRange = opts.maxRangeKm ?? Infinity;
  const rangeKm = Math.min(
    maxRange,
    Math.max(
      Math.hypot(x0 - half, z0 - half),
      Math.hypot(x0 - half, z0 + half),
      Math.hypot(x0 + half, z0 - half),
      Math.hypot(x0 + half, z0 + half),
    ),
  );
  const base = sample(x0, z0) + (opts.observerHeightM ?? 0);
  const el = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    const az = (i / n) * 2 * Math.PI;
    const sx = Math.sin(az);
    const sz = -Math.cos(az);
    let best = -90;
    for (let d = step; d <= maxRange; d += step) {
      const x = x0 + sx * d;
      const z = z0 + sz * d;
      if (Math.abs(x) > half || Math.abs(z) > half) break;
      const curvatureDropM = ((d * d) / (2 * MOON_R_KM)) * 1000;
      const ang = (Math.atan2(sample(x, z) - base - curvatureDropM, d * 1000) * 180) / Math.PI;
      if (ang > best) best = ang;
    }
    el[i] = best === -90 ? 0 : best;
  }
  return { stepDeg: 360 / n, el, rangeKm };
}

export function maskAt(mask: HorizonMask, azDeg: number): number {
  const n = mask.el.length;
  const f = ((((azDeg % 360) + 360) % 360) / mask.stepDeg);
  const i0 = Math.floor(f) % n;
  const i1 = (i0 + 1) % n;
  const t = f - Math.floor(f);
  return mask.el[i0] * (1 - t) + mask.el[i1] * t;
}