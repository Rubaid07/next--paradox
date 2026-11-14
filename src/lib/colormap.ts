import * as THREE from "three";
import type { ColorMode } from "./types";

/** Elevation (m, relative to the 1,737.4 km reference sphere) -> colour, deep navy to warm white. */
const STOPS: ReadonlyArray<readonly [number, string]> = [
  [-7300, "#141c52"],
  [-5000, "#1e4796"],
  [-3000, "#1d6aa5"],
  [-1500, "#2aa3b8"],
  [0, "#7fd1b9"],
  [1500, "#d7e8a8"],
  [3500, "#f4d58d"],
  [5500, "#f2a65a"],
  [7100, "#fff4e0"],
];

// THREE.Color converts the hex (sRGB) to linear working space, which is what vertex colours expect.
const LINEAR_STOPS = STOPS.map(([e, hex]) => [e, new THREE.Color(hex)] as const);
const NEUTRAL_LOW = new THREE.Color("#7b8596");
const NEUTRAL_HIGH = new THREE.Color("#d3d9e4");
const MIN_E = STOPS[0][0];
const MAX_E = STOPS[STOPS.length - 1][0];

function elevationColor(elev: number, out: THREE.Color): void {
  if (elev <= LINEAR_STOPS[0][0]) {
    out.copy(LINEAR_STOPS[0][1]);
    return;
  }
  for (let s = 1; s < LINEAR_STOPS.length; s++) {
    const [e1, c1] = LINEAR_STOPS[s];
    if (elev <= e1) {
      const [e0, c0] = LINEAR_STOPS[s - 1];
      out.copy(c0).lerp(c1, (elev - e0) / (e1 - e0));
      return;
    }
  }
  out.copy(LINEAR_STOPS[LINEAR_STOPS.length - 1][1]);
}

/** Writes the colour attribute in place. */
export function applyVertexColors(
  geometry: THREE.BufferGeometry,
  heights: Float32Array,
  mode: ColorMode,
  /**
   * Optional [min, max] elevation of the data being shown. When given, the whole palette is
   * stretched over that range, so a small local area uses all the colours instead of one band.
   */
  range?: readonly [number, number],
): void {
  const attr = geometry.getAttribute("color") as THREE.BufferAttribute;
  const arr = attr.array as Float32Array;
  const c = new THREE.Color();
  const lo = range ? range[0] : MIN_E;
  const span = range ? Math.max(range[1] - range[0], 1) : MAX_E - MIN_E;
  for (let i = 0; i < heights.length; i++) {
    // Position inside the palette's own domain.
    const t = Math.min(Math.max((heights[i] - lo) / span, 0), 1);
    if (mode === "elevation") {
      elevationColor(range ? MIN_E + t * (MAX_E - MIN_E) : heights[i], c);
    } else {
      c.copy(NEUTRAL_LOW).lerp(NEUTRAL_HIGH, t);
    }
    const p = i * 3;
    arr[p] = c.r;
    arr[p + 1] = c.g;
    arr[p + 2] = c.b;
  }
  attr.needsUpdate = true;
}

/** CSS gradient (bottom = lowest) for the legend, positioned over the DEM's own min/max. */
export function legendGradient(minE: number, maxE: number): string {
  const stops = STOPS.filter(([e]) => e >= minE - 500 && e <= maxE + 500)
    .map(([e, hex]) => `${hex} ${(Math.min(Math.max((e - minE) / (maxE - minE), 0), 1) * 100).toFixed(1)}%`)
    .join(", ");
  return `linear-gradient(to top, ${stops})`;
}
