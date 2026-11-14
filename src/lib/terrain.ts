import * as THREE from "three";

/**
 * Scene units are kilometres. x = projected easting, z = -projected northing, y = elevation.
 * Grid row 0 (north edge of the DEM) therefore sits at z = -extent/2.
 */
export function buildTerrainGeometry(heights: Float32Array, n: number, extentKm: number): THREE.BufferGeometry {
  const cell = extentKm / n;
  const half = extentKm / 2;
  const count = n * n;

  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);

  for (let j = 0; j < n; j++) {
    const z = -half + (j + 0.5) * cell;
    const ju = Math.max(j - 1, 0);
    const jd = Math.min(j + 1, n - 1);
    for (let i = 0; i < n; i++) {
      const idx = j * n + i;
      const p = idx * 3;
      positions[p] = -half + (i + 0.5) * cell;
      positions[p + 1] = heights[idx] / 1000;
      positions[p + 2] = z;

      // Central-difference slope in true (unexaggerated) kilometres.
      const il = Math.max(i - 1, 0);
      const ir = Math.min(i + 1, n - 1);
      const dhdx = (heights[j * n + ir] - heights[j * n + il]) / 1000 / ((ir - il) * cell);
      const dhdz = (heights[jd * n + i] - heights[ju * n + i]) / 1000 / ((jd - ju) * cell);
      const inv = 1 / Math.sqrt(dhdx * dhdx + 1 + dhdz * dhdz);
      normals[p] = -dhdx * inv;
      normals[p + 1] = inv;
      normals[p + 2] = -dhdz * inv;
    }
  }

  // Counter-clockwise when viewed from +Y: (a, c, b) and (b, c, d).
  const indices = new Uint32Array((n - 1) * (n - 1) * 6);
  let k = 0;
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      indices[k++] = a;
      indices[k++] = c;
      indices[k++] = b;
      indices[k++] = b;
      indices[k++] = c;
      indices[k++] = d;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return geometry;
}

/** Bilinear height lookup (returns kilometres) on the displayed heightmap. */
export function createHeightSampler(heights: Float32Array, n: number, extentKm: number) {
  const cell = extentKm / n;
  const half = extentKm / 2;
  return (xKm: number, zKm: number): number => {
    const c = Math.min(Math.max((xKm + half) / cell - 0.5, 0), n - 1);
    const r = Math.min(Math.max((zKm + half) / cell - 0.5, 0), n - 1);
    const c0 = Math.floor(c);
    const r0 = Math.floor(r);
    const c1 = Math.min(c0 + 1, n - 1);
    const r1 = Math.min(r0 + 1, n - 1);
    const fc = c - c0;
    const fr = r - r0;
    const v =
      heights[r0 * n + c0] * (1 - fr) * (1 - fc) +
      heights[r0 * n + c1] * (1 - fr) * fc +
      heights[r1 * n + c0] * fr * (1 - fc) +
      heights[r1 * n + c1] * fr * fc;
    return v / 1000;
  };
}

export type HeightSampler = ReturnType<typeof createHeightSampler>;

export interface HeightWindow {
  /** size x size heights in metres, row 0 = north, cropped out of the full heightmap. */
  heights: Float32Array;
  size: number;
  /** Real side length of the window in km (size * cell). */
  windowKm: number;
  /** World (scene) coordinates, in km, of the window centre. */
  centerX: number;
  centerZ: number;
  min: number;
  max: number;
  mean: number;
}

/**
 * Crops a square window (about `windowKm` wide) out of the full heightmap, centred as closely as
 * possible on the scene point (cx, cz) while staying inside the DEM. The window is snapped to
 * whole cells so no resampling is needed; use `centerX/centerZ` to convert world -> window coords.
 */
export function cropHeightmap(
  heights: Float32Array,
  n: number,
  extentKm: number,
  cx: number,
  cz: number,
  windowKm: number,
): HeightWindow {
  const cell = extentKm / n;
  const half = extentKm / 2;
  const m = Math.min(n, Math.max(8, Math.round(windowKm / cell)));
  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
  const col0 = clamp(Math.round((cx + half) / cell - 0.5 - (m - 1) / 2), 0, n - m);
  const row0 = clamp(Math.round((cz + half) / cell - 0.5 - (m - 1) / 2), 0, n - m);

  const out = new Float32Array(m * m);
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (let j = 0; j < m; j++) {
    const start = (row0 + j) * n + col0;
    out.set(heights.subarray(start, start + m), j * m);
  }
  for (let i = 0; i < out.length; i++) {
    const v = out[i];
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
  }

  return {
    heights: out,
    size: m,
    windowKm: m * cell,
    centerX: -half + (col0 + m / 2) * cell,
    centerZ: -half + (row0 + m / 2) * cell,
    min,
    max,
    mean: sum / out.length,
  };
}
