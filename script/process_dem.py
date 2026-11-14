#!/usr/bin/env python3
"""
Preprocess a LOLA LDEM GeoTIFF (south polar stereographic, spherical Moon) for the
web viewer.

Outputs (written to --out, default public/data):
  heightmap_<N>.f32   little-endian float32, row-major, row 0 = north edge (y = +max),
                      col 0 = west edge (x = -max). Values are metres relative to the
                      1,737,400 m lunar reference sphere, block-MEAN downsampled from
                      the original DEM (no smoothing, no synthetic detail).
  meta.json           everything that was read from the file + the mesh levels
  sites.json          each landing site projected into the DEM's CRS, checked against
                      the DEM coverage, and sampled from the ORIGINAL full-resolution
                      DEM (bilinear)

The original GeoTIFF is only ever read, never modified.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import sys
from pathlib import Path

import numpy as np
import rasterio

EXPECTED_LAT0 = -90.0


# --------------------------------------------------------------------------- #
# Projection: polar stereographic, south pole, spherical body
#   rho = 2 R k0 tan(pi/4 + phi/2)    (phi negative in the southern hemisphere)
#   x = rho sin(lam - lam0),  y = rho cos(lam - lam0)
# --------------------------------------------------------------------------- #
def forward(lat_deg: float, lon_deg: float, radius: float, lon0: float = 0.0, k0: float = 1.0):
    phi = math.radians(lat_deg)
    lam = math.radians(lon_deg - lon0)
    rho = 2.0 * radius * k0 * math.tan(math.pi / 4.0 + phi / 2.0)
    return rho * math.sin(lam), rho * math.cos(lam)


def inverse(x: float, y: float, radius: float, lon0: float = 0.0, k0: float = 1.0):
    rho = math.hypot(x, y)
    c = 2.0 * math.atan(rho / (2.0 * radius * k0))
    lat = math.degrees(c - math.pi / 2.0)
    lon = math.degrees(math.atan2(x, y)) + lon0
    return lat, lon


def wrap180(lon: float) -> float:
    return ((lon + 180.0) % 360.0) - 180.0


# --------------------------------------------------------------------------- #
# CRS handling
# --------------------------------------------------------------------------- #
def _wkt_param(wkt: str, names: list[str]) -> float | None:
    for n in names:
        m = re.search(r'PARAMETER\["%s",\s*(-?[0-9.eE+-]+)' % re.escape(n), wkt, re.IGNORECASE)
        if m:
            return float(m.group(1))
    return None


def read_crs_params(wkt: str, fallback_radius: float):
    radius = None
    m = re.search(r'(?:SPHEROID|ELLIPSOID)\["[^"]*",\s*([0-9.]+)', wkt, re.IGNORECASE)
    if m:
        radius = float(m.group(1))
    lat0 = _wkt_param(wkt, ["latitude_of_origin", "Latitude of natural origin", "Latitude of standard parallel"])
    lon0 = _wkt_param(wkt, ["central_meridian", "Longitude of natural origin", "Longitude of origin"])
    k0 = _wkt_param(wkt, ["scale_factor", "Scale factor at natural origin"])

    if radius is None:
        print(f"  ! could not parse sphere radius from CRS; using --radius {fallback_radius}")
        radius = fallback_radius
    if lat0 is not None and abs(lat0 - EXPECTED_LAT0) > 1e-9:
        sys.exit(f"CRS latitude of origin is {lat0}, but this script implements a south-pole "
                 f"stereographic projection (lat0 = {EXPECTED_LAT0}). Refusing to continue.")
    return radius, (lon0 if lon0 is not None else 0.0), (k0 if k0 is not None else 1.0)


def optional_pyproj_crosscheck(wkt: str, radius: float, lon0: float, k0: float):
    """If pyproj is installed, compare our analytic projection to PROJ for a few points."""
    try:
        from pyproj import CRS, Transformer  # type: ignore
    except ImportError:
        print("  (pyproj not installed - skipping independent PROJ cross-check)")
        return
    try:
        proj_crs = CRS.from_wkt(wkt)
        tr = Transformer.from_crs(proj_crs.geodetic_crs, proj_crs, always_xy=True)
        worst = 0.0
        for lat, lon in [(-89.5, -150.0), (-85.9, -0.9), (-84.5, 67.0), (-81.0, 120.0)]:
            px, py = tr.transform(lon, lat)
            ax, ay = forward(lat, lon, radius, lon0, k0)
            worst = max(worst, math.hypot(px - ax, py - ay))
        print(f"  PROJ cross-check: worst difference vs analytic projection = {worst:.4f} m")
        if worst > 1.0:
            sys.exit("Analytic projection disagrees with PROJ by more than 1 m. Refusing to continue.")
    except Exception as exc:  # noqa: BLE001
        print(f"  ! PROJ cross-check could not run: {exc}")


# --------------------------------------------------------------------------- #
# Raster helpers
# --------------------------------------------------------------------------- #
def block_mean(dem: np.ndarray, factor: int) -> np.ndarray:
    h, w = dem.shape
    if h % factor or w % factor:
        sys.exit(f"Raster {w}x{h} is not divisible by factor {factor}; pick a factor that divides both.")
    valid = np.isfinite(dem)
    blocks = np.where(valid, dem, 0.0).reshape(h // factor, factor, w // factor, factor)
    counts = valid.reshape(h // factor, factor, w // factor, factor).sum(axis=(1, 3))
    sums = blocks.sum(axis=(1, 3), dtype=np.float64)
    out = np.full(sums.shape, np.nan, dtype=np.float64)
    ok = counts > 0
    out[ok] = sums[ok] / counts[ok]
    return out.astype(np.float32)


def bilinear(dem: np.ndarray, x: float, y: float, x0: float, y0: float, px: float):
    """Bilinear sample at projected (x, y). Pixel centres sit at x0+(c+.5)px, y0-(r+.5)px."""
    h, w = dem.shape
    c = (x - x0) / px - 0.5
    r = (y0 - y) / px - 0.5
    c = min(max(c, 0.0), w - 1.0)
    r = min(max(r, 0.0), h - 1.0)
    c0, r0 = int(math.floor(c)), int(math.floor(r))
    c1, r1 = min(c0 + 1, w - 1), min(r0 + 1, h - 1)
    fc, fr = c - c0, r - r0
    v = (
        dem[r0, c0] * (1 - fr) * (1 - fc)
        + dem[r0, c1] * (1 - fr) * fc
        + dem[r1, c0] * fr * (1 - fc)
        + dem[r1, c1] * fr * fc
    )
    return (None if not np.isfinite(v) else float(v)), c + 0.5, r + 0.5


def local_stats(dem: np.ndarray, x: float, y: float, x0: float, y0: float, px: float, radius_m: float):
    h, w = dem.shape
    cc = int(round((x - x0) / px - 0.5))
    rr = int(round((y0 - y) / px - 0.5))
    n = int(math.ceil(radius_m / px))
    r_lo, r_hi = max(rr - n, 0), min(rr + n + 1, h)
    c_lo, c_hi = max(cc - n, 0), min(cc + n + 1, w)
    win = dem[r_lo:r_hi, c_lo:c_hi]
    rows, cols = np.mgrid[r_lo:r_hi, c_lo:c_hi]
    mask = ((rows - rr) ** 2 + (cols - cc) ** 2) * px * px <= radius_m * radius_m
    vals = win[mask]
    vals = vals[np.isfinite(vals)]
    if vals.size == 0:
        return None
    return {
        "radius_m": radius_m,
        "min_m": float(vals.min()),
        "max_m": float(vals.max()),
        "mean_m": float(vals.mean()),
        "samples": int(vals.size),
    }


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 22), b""):
            h.update(chunk)
    return h.hexdigest()


# --------------------------------------------------------------------------- #
def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--input", default="data/LDEM_80S_80MPP_ADJ.tiff")
    ap.add_argument("--sites", default="data/sites_input.json")
    ap.add_argument("--out", default="public/data")
    ap.add_argument("--factors", type=int, nargs="+", default=[8, 5],
                    help="block-mean downsample factors for the mesh levels (default: 8 5)")
    ap.add_argument("--radius", type=float, default=1737400.0,
                    help="fallback sphere radius in metres if it cannot be parsed from the CRS")
    ap.add_argument("--local-radius", type=float, default=5000.0,
                    help="radius (m) for the local min/max/mean around each site")
    args = ap.parse_args()

    in_path, out_dir = Path(args.input), Path(args.out)
    if not in_path.exists():
        sys.exit(f"Input GeoTIFF not found: {in_path}\nCopy it to data/ or pass --input.")
    out_dir.mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------------ inspect
    with rasterio.open(in_path) as src:
        print(f"\n=== Inspecting {in_path.name} ===")
        if src.crs is None:
            sys.exit("The GeoTIFF has no CRS; cannot georeference sites.")
        wkt = src.crs.to_wkt()
        t = src.transform
        if not (t.b == 0 and t.d == 0 and t.e < 0 and abs(abs(t.a) - abs(t.e)) < 1e-9):
            sys.exit(f"Unexpected geotransform {t}: expected north-up with square pixels.")
        px, x0, y0 = float(t.a), float(t.c), float(t.f)
        width, height = src.width, src.height
        left, bottom, right, top = (float(v) for v in src.bounds)
        radius, lon0, k0 = read_crs_params(wkt, args.radius)

        print(f"  size        : {width} x {height} px, {src.count} band(s), dtype {src.dtypes[0]}")
        print(f"  CRS         : polar stereographic (south), R = {radius:.0f} m, lat0 = -90, lon0 = {lon0}, k0 = {k0}")
        print(f"  pixel size  : {px} m")
        print(f"  bounds (m)  : x {left:.0f}..{right:.0f}, y {bottom:.0f}..{top:.0f}")
        print(f"  nodata      : {src.nodata}")
        optional_pyproj_crosscheck(wkt, radius, lon0, k0)

        dem = src.read(1).astype(np.float32)
        nodata = src.nodata
        if nodata is not None and not (isinstance(nodata, float) and math.isnan(nodata)):
            dem[dem == nodata] = np.nan
        dem[~np.isfinite(dem)] = np.nan
        dtype_name = src.dtypes[0]

    finite = np.isfinite(dem)
    n_nan = int((~finite).sum())
    vals = dem[finite]
    emin, emax = float(vals.min()), float(vals.max())
    pcts = np.percentile(vals, [0.1, 1, 5, 50, 95, 99, 99.9])
    imin = np.unravel_index(int(np.nanargmin(dem)), dem.shape)
    imax = np.unravel_index(int(np.nanargmax(dem)), dem.shape)

    def pix_info(rc):
        r, c = int(rc[0]), int(rc[1])
        x, y = x0 + (c + 0.5) * px, y0 - (r + 0.5) * px
        lat, lon = inverse(x, y, radius, lon0, k0)
        return {"row": r, "col": c, "x_m": x, "y_m": y, "lat": lat, "lon": wrap180(lon),
                "elevation_m": float(dem[r, c])}

    half_w = min(right - left, top - bottom) / 2.0
    lat_inscribed = inverse(half_w, 0.0, radius, lon0, k0)[0]
    lat_corner = inverse(right, top, radius, lon0, k0)[0]

    print(f"  elevation   : min {emin:.2f} m, max {emax:.2f} m, mean {vals.mean():.2f} m, std {vals.std():.2f} m")
    print(f"  NaN/nodata  : {n_nan} px ({100.0 * n_nan / dem.size:.4f}%)")
    print(f"  coverage    : {(right - left) / 1000:.0f} x {(top - bottom) / 1000:.0f} km square;"
          f" every longitude poleward of {abs(lat_inscribed):.2f} deg S, corners reach {abs(lat_corner):.2f} deg S")

    # ------------------------------------------------------------------ mesh levels
    levels = []
    for f in sorted(set(args.factors), reverse=True):
        grid = block_mean(dem, f)
        holes = int((~np.isfinite(grid)).sum())
        if holes:
            print(f"  ! level x{f}: {holes} empty cells filled with the DEM minimum")
            grid[~np.isfinite(grid)] = emin
        n_h, n_w = grid.shape
        fname = f"heightmap_{n_w}.f32"
        grid.astype("<f4").tofile(out_dir / fname)
        levels.append({
            "id": f"x{f}", "file": fname, "width": int(n_w), "height": int(n_h), "factor": f,
            "cellSizeM": px * f, "bytes": (out_dir / fname).stat().st_size,
            "min_m": float(grid.min()), "max_m": float(grid.max()), "emptyCellsFilled": holes,
        })
        print(f"  wrote {fname}: {n_w} x {n_h}, {px * f:.0f} m/cell, {levels[-1]['bytes'] / 1e6:.1f} MB")

    meta = {
        "source": {"file": in_path.name, "sizeBytes": in_path.stat().st_size, "sha256": sha256_of(in_path)},
        "crs": {
            "name": "Moon (2015) sphere, south polar stereographic",
            "projection": "polar_stereographic_south", "radius_m": radius,
            "lat0_deg": EXPECTED_LAT0, "lon0_deg": lon0, "k0": k0, "latitudeType": "planetocentric",
            "wkt": wkt,
        },
        "raster": {
            "width": width, "height": height, "dtype": dtype_name, "nodata": "nan" if nodata is None else str(nodata),
            "pixelSize_m": px, "geotransform": [t.a, t.b, t.c, t.d, t.e, t.f],
            "bounds_m": {"left": left, "bottom": bottom, "right": right, "top": top},
            "layout": "float32 little-endian, row-major, row 0 = north edge (max y), col 0 = west edge (min x)",
            "elevationUnits": "metres relative to the 1,737,400 m lunar reference sphere",
        },
        "coverage": {
            "extentKm": [(right - left) / 1000.0, (top - bottom) / 1000.0],
            "fullLongitudeCoverageSouthOfLat": lat_inscribed,
            "cornerLat": lat_corner,
        },
        "elevation": {
            "min_m": emin, "max_m": emax, "mean_m": float(vals.mean()), "std_m": float(vals.std()),
            "nanCount": n_nan,
            "percentiles_m": dict(zip(["p0_1", "p1", "p5", "p50", "p95", "p99", "p99_9"], [float(p) for p in pcts])),
            "argmin": pix_info(imin), "argmax": pix_info(imax),
        },
        "levels": levels,
    }
    (out_dir / "meta.json").write_text(json.dumps(meta, indent=2))

    # ------------------------------------------------------------------ sites
    print("\n=== Landing sites ===")
    registry = json.loads(Path(args.sites).read_text())
    out_sites = []
    for s in registry["sites"]:
        rec = {
            "id": s["id"], "name": s["name"], "artemisRegion": s.get("artemisRegion"),
            "positionKind": s["positionKind"], "verification": s["verification"],
            "source": s.get("source"), "note": s.get("note"),
            "lat": s["lat"], "lon": None if s["lon"] is None else wrap180(s["lon"]),
        }
        if s["lat"] is None or s["lon"] is None:
            rec.update(status="unresolved",
                       statusReason="No coordinate from a citable source; not placed on the terrain.")
            out_sites.append(rec)
            print(f"  [unresolved] {s['name']}")
            continue

        x, y = forward(s["lat"], s["lon"], radius, lon0, k0)
        inside = left <= x <= right and bottom <= y <= top
        rec["projected"] = {"x_m": x, "y_m": y}
        rec["distanceFromPole_km"] = math.hypot(x, y) / 1000.0
        if not inside:
            rec.update(status="outside_coverage",
                       statusReason=f"Projected position ({x / 1000:.1f}, {y / 1000:.1f}) km lies outside the "
                                    f"DEM extent; not placed.")
            out_sites.append(rec)
            print(f"  [OUTSIDE]    {s['name']}")
            continue

        elev, col, row = bilinear(dem, x, y, x0, y0, px)
        rec.update(
            status="placed",
            statusReason="Inside DEM coverage.",
            world={"x_km": x / 1000.0, "z_km": -y / 1000.0},
            pixel={"col": col, "row": row},
            elevation_m=elev,
            local=local_stats(dem, x, y, x0, y0, px, args.local_radius),
        )
        out_sites.append(rec)
        print(f"  [placed]     {s['name']:<18} lat {s['lat']:>9.5f} lon {rec['lon']:>10.5f}"
              f"  x {x / 1000:8.2f} km  y {y / 1000:8.2f} km  elev {elev:8.1f} m")

    (out_dir / "sites.json").write_text(json.dumps({"sites": out_sites}, indent=2))
    placed = sum(1 for r in out_sites if r["status"] == "placed")
    print(f"\n{placed}/{len(out_sites)} sites placed. Outputs in {out_dir.resolve()}\n")


if __name__ == "__main__":
    main()
