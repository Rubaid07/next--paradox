import type { LandingSite, TerrainMeta, HeightmapLevel } from "./types";

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "force-cache" });
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return (await res.json()) as T;
}

export const loadMeta = () => getJson<TerrainMeta>("/data/meta.json");

export async function loadSites(): Promise<LandingSite[]> {
  const data = await getJson<{ sites: LandingSite[] }>("/data/sites.json");
  return data.sites;
}

/** Heightmap: float32, row-major, row 0 = north edge. Values are metres. */
export async function loadHeightmap(level: HeightmapLevel): Promise<Float32Array> {
  const res = await fetch(`/data/${level.file}`, { cache: "force-cache" });
  if (!res.ok) throw new Error(`/data/${level.file} returned ${res.status}`);
  const buf = await res.arrayBuffer();
  const expected = level.width * level.height * 4;
  if (buf.byteLength !== expected) {
    throw new Error(`${level.file}: expected ${expected} bytes, received ${buf.byteLength}`);
  }
  // The file is little-endian float32; every browser platform in practice is little-endian too.
  return new Float32Array(buf);
}
