export type SiteStatus = "placed" | "outside_coverage" | "unresolved";
export type PositionKind = "candidate_landing_site" | "feature_center" | "unresolved";
export type Verification = "primary" | "secondary" | "none";

export interface SiteSource {
  label: string;
  url: string;
}

export interface LocalStats {
  radius_m: number;
  min_m: number;
  max_m: number;
  mean_m: number;
  samples: number;
}

/** One record from public/data/sites.json (written by scripts/process_dem.py). */
export interface LandingSite {
  id: string;
  name: string;
  artemisRegion: string | null;
  status: SiteStatus;
  statusReason: string;
  lat: number | null;
  lon: number | null;
  positionKind: PositionKind;
  verification: Verification;
  source: SiteSource | null;
  note: string | null;
  projected?: { x_m: number; y_m: number };
  distanceFromPole_km?: number;
  /** Scene coordinates in km: x = projected x, z = -projected y. */
  world?: { x_km: number; z_km: number };
  pixel?: { col: number; row: number };
  /** Bilinear sample of the ORIGINAL 80 m DEM, metres. */
  elevation_m?: number | null;
  local?: LocalStats | null;
}

export type PlacedSite = LandingSite & { status: "placed"; world: { x_km: number; z_km: number } };

export function isPlaced(site: LandingSite): site is PlacedSite {
  return site.status === "placed" && site.world !== undefined;
}

export interface HeightmapLevel {
  id: string;
  file: string;
  width: number;
  height: number;
  factor: number;
  cellSizeM: number;
  bytes: number;
  min_m: number;
  max_m: number;
}

export interface PixelInfo {
  row: number;
  col: number;
  x_m: number;
  y_m: number;
  lat: number;
  lon: number;
  elevation_m: number;
}

/** Subset of public/data/meta.json that the UI reads. */
export interface TerrainMeta {
  source: { file: string; sizeBytes: number; sha256: string };
  crs: { name: string; radius_m: number; lat0_deg: number; lon0_deg: number; k0: number; latitudeType: string };
  raster: {
    width: number;
    height: number;
    dtype: string;
    pixelSize_m: number;
    bounds_m: { left: number; bottom: number; right: number; top: number };
    elevationUnits: string;
  };
  coverage: { extentKm: [number, number]; fullLongitudeCoverageSouthOfLat: number; cornerLat: number };
  elevation: {
    min_m: number;
    max_m: number;
    mean_m: number;
    std_m: number;
    nanCount: number;
    argmin: PixelInfo;
    argmax: PixelInfo;
  };
  levels: HeightmapLevel[];
}

export type ColorMode = "elevation" | "neutral";

export interface ViewSettings {
  exaggeration: number;
  sunAzimuth: number;
  sunElevation: number;
  shadows: boolean;
  colorMode: ColorMode;
  showLabels: boolean;
  levelId: string;
}

export interface ViewRequest {
  nonce: number;
  target: [number, number, number];
  distance: number;
  direction?: [number, number, number];
}
