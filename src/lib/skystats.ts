import type { EphemerisData } from "./ephemeris";
import { maskAt, type HorizonMask } from "./horizon";

export interface SkyWindowStats {
  /** Share of the window with the body above the terrain skyline (0..1). Falls back to the smooth horizon without a mask. */
  sunUp: number;
  earthUp: number;
  sunUpHours: number;
  /** Same, against the smooth-Moon horizon (what Horizons alone says) - for comparison. */
  sunUpSmooth: number;
  earthUpSmooth: number;
  /** Longest continuous stretch with the body hidden, hours. Truncated at the window edges. */
  maxSunDarkH: number;
  maxEarthGapH: number;
  masked: boolean;
}

function run(el: number[], az: number[], stepMs: number, mask: HorizonMask | null) {
  let up = 0, upSmooth = 0, cur = 0, longest = 0;
  for (let i = 0; i < el.length; i++) {
    if (el[i] > 0) upSmooth++;
    const visible = el[i] > (mask ? maskAt(mask, az[i]) : 0);
    if (visible) { up++; cur = 0; } else { cur++; if (cur > longest) longest = cur; }
  }
  const h = stepMs / 3_600_000;
  return { frac: up / el.length, smooth: upSmooth / el.length, upH: up * h, downH: longest * h };
}

export function skyWindowStats(eph: EphemerisData, mask: HorizonMask | null = null): SkyWindowStats {
  const s = run(eph.sun.el, eph.sun.az, eph.stepMs, mask);
  const e = run(eph.earth.el, eph.earth.az, eph.stepMs, mask);
  return {
    sunUp: s.frac, earthUp: e.frac, sunUpHours: s.upH,
    sunUpSmooth: s.smooth, earthUpSmooth: e.smooth,
    maxSunDarkH: s.downH, maxEarthGapH: e.downH, masked: !!mask,
  };
}