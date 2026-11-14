export function formatLat(lat: number): string {
  return `${Math.abs(lat).toFixed(4)}° ${lat < 0 ? "S" : "N"}`;
}

export function formatLon(lon: number): string {
  return `${Math.abs(lon).toFixed(4)}° ${lon < 0 ? "W" : "E"}`;
}

export function formatMeters(m: number | null | undefined, digits = 0): string {
  if (m === null || m === undefined || !Number.isFinite(m)) return "n/a";
  return `${m.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })} m`;
}

export function formatKm(km: number, digits = 1): string {
  return `${km.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })} km`;
}
