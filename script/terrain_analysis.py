"""
Terrain analysis for the landing-site candidates (slope, roughness, relief / position / horizon)
- Google Colab & Google Drive Optimized Version
"""
import argparse, json, os
import numpy as np
from scipy import ndimage as ndi
from scipy.ndimage import map_coordinates

# ─────────────────────────── গুগল ড্রাইভ পাথ ও সেটিংস ───────────────────────────
# ড্রাইভ মাউন্ট করা না থাকলে প্রথমে মাউন্ট করে নিন
try:
    from google.colab import drive
    drive.mount('/content/drive')
    BASE_PATH = "/content/drive/MyDrive/"
except ImportError:
    BASE_PATH = ""

DEFAULT_DEM = os.path.join(BASE_PATH, "LDEM_80S_80MPP_ADJ.tiff")
DEFAULT_SITES = os.path.join(BASE_PATH, "sites.json")
DEFAULT_OUT = os.path.join(BASE_PATH, "terrain_analysis.json")
DEFAULT_PNG_DIR = os.path.join(BASE_PATH, "terrain_png")

R_MOON = 1737400.0
DEG = np.pi / 180
HALF_EXTENT = 304000.0  # DEM covers +-304 km around the pole

ap = argparse.ArgumentParser()
ap.add_argument("--dem", default=DEFAULT_DEM, help=".tif/.tiff (GeoTIFF) or raw float32 (.f32)")
ap.add_argument("--size", type=int, help="width = height in pixels, only for .f32 files")
ap.add_argument("--sites", default=DEFAULT_SITES)
ap.add_argument("--out", default=DEFAULT_OUT)
ap.add_argument("--radius", type=float, default=5000.0, help="analysis radius around each site, m")
ap.add_argument("--baselines", default="200,400,800,1600", help="roughness baselines (window diameters), m")
ap.add_argument("--slope-limits", default="5,10,15", help="slope classes in degrees")
ap.add_argument("--safe-slope", type=float, default=10.0, help="slope limit used for the contiguous safe patch, deg")
ap.add_argument("--png-dir", default=DEFAULT_PNG_DIR)

# কোলাব নোটবুকে আর্গুমেন্ট পার্সিং ত্রুটি এড়ানোর ব্যবস্থা
import sys
if 'google.colab' in sys.modules:
    a, unknown = ap.parse_known_args()
else:
    a = ap.parse_args()


# ------------------------------------------------------------------ DEM
def read_dem(path):
    if path.lower().endswith((".tif", ".tiff")):
        try:
            import rasterio
            with rasterio.open(path) as ds:
                return ds.read(1).astype(np.float32)
        except ImportError:
            import tifffile
            return tifffile.imread(path).astype(np.float32)
    if not a.size:
        raise SystemExit("--size is required for raw .f32 files")
    return np.fromfile(path, "<f4").reshape(a.size, a.size)


print(f"Loading DEM from: {a.dem}")
H = read_dem(a.dem)
if H.ndim != 2 or H.shape[0] != H.shape[1]:
    raise SystemExit(f"expected a square DEM, got {H.shape}")
H = np.where(np.isfinite(H) & (H > -1e5), H, np.nan).astype(np.float32)
SIZE = H.shape[0]
CELL = 2 * HALF_EXTENT / SIZE
print(f"DEM {SIZE}x{SIZE}, {CELL:.0f} m/px, NaN cells: {int(np.isnan(H).sum())}")


def to_px(lat, lon):  # radians -> (col, row)
    rho = 2 * R_MOON * np.tan(np.pi / 4 + lat / 2)
    x, y = rho * np.sin(lon), rho * np.cos(lon)
    return (x + HALF_EXTENT) / CELL - 0.5, (HALF_EXTENT - y) / CELL - 0.5


def dem_at(lat, lon):
    col, row = to_px(lat, lon)
    return map_coordinates(H, [row, col], order=1, mode="nearest")


# ------------------------------------------------------------------ terrain metrics
def slope_deg(z):
    gy, gx = np.gradient(z, CELL)
    return np.degrees(np.arctan(np.hypot(gx, gy)))


def rms_plane_residual(z, win):
    h, w = z.shape
    yy, xx = np.mgrid[0:h, 0:w]
    X, Y = (xx - w / 2) * CELL, (yy - h / 2) * CELL
    f = lambda arr: ndi.uniform_filter(arr, size=win, mode="nearest")
    mz, mx, my = f(z), f(X), f(Y)
    vz, vx, vy = f(z * z) - mz ** 2, f(X * X) - mx ** 2, f(Y * Y) - my ** 2
    cx, cy = f(z * X) - mz * mx, f(z * Y) - mz * my
    res = vz - cx ** 2 / vx - cy ** 2 / vy
    return np.sqrt(np.clip(res, 0, None))


def horizon_profile(lat, lon, h0, max_km=300):
    u = np.array([np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)])
    n = np.array([-np.sin(lat) * np.cos(lon), -np.sin(lat) * np.sin(lon), np.cos(lat)])
    e = np.array([-np.sin(lon), np.cos(lon), 0.0])
    az = np.arange(0, 360, 1.0) * DEG
    dist = np.concatenate([np.arange(CELL, 20000, CELL), np.arange(20000, max_km * 1000 + 1, 2000)])
    th = dist / R_MOON
    d = np.cos(az)[:, None] * n + np.sin(az)[:, None] * e
    p = np.cos(th)[None, :, None] * u + np.sin(th)[None, :, None] * d[:, None, :]
    plat, plon = np.arcsin(np.clip(p[..., 2], -1, 1)), np.arctan2(p[..., 1], p[..., 0])
    rho = 2 * R_MOON * np.tan(np.pi / 4 + plat / 2)
    inside = (np.abs(rho * np.sin(plon)) < HALF_EXTENT - 1000) & (np.abs(rho * np.cos(plon)) < HALF_EXTENT - 1000)
    col, row = to_px(plat, plon)
    h = map_coordinates(H, [row.ravel(), col.ravel()], order=1, mode="nearest").reshape(plat.shape)
    rr = R_MOON + h
    ang = np.degrees(np.arctan2(rr * np.cos(th)[None, :] - (R_MOON + h0), rr * np.sin(th)[None, :]))
    return np.where(inside, ang, -90).max(1)


def pct(arr, q):
    return float(np.nanpercentile(arr, q))


# ------------------------------------------------------------------ per site
baselines = [float(b) for b in a.baselines.split(",")]
slope_limits = [float(s) for s in a.slope_limits.split(",")]

print(f"Loading sites from: {a.sites}")
with open(a.sites, encoding="utf-8") as f:
    sites = [s for s in json.load(f)["sites"] if s.get("lat") is not None]

result = {"dem": os.path.basename(a.dem), "cell_m": CELL, "radius_m": a.radius, "sites": {}}

for s in sites:
    lat, lon = s["lat"] * DEG, s["lon"] * DEG
    col, row = to_px(lat, lon)
    rpx = a.radius / CELL
    wins = []
    for b in baselines:
        w = max(3, int(round(b / CELL)))
        w += 1 - w % 2
        wins.append(w)
    margin = int(np.ceil(rpx)) + max(wins) // 2 + 3
    c0, r0 = int(round(col)), int(round(row))
    if min(c0, r0) - margin < 0 or max(c0, r0) + margin >= SIZE:
        print(f"skip {s['id']}: analysis window leaves the DEM"); continue
    sl = (slice(r0 - margin, r0 + margin + 1), slice(c0 - margin, c0 + margin + 1))
    z = H[sl].astype(np.float64)
    if np.isnan(z).any():
        z = np.where(np.isnan(z), np.nanmean(z), z)
    z0 = z.mean()
    z = z - z0
    yy, xx = np.mgrid[0:z.shape[0], 0:z.shape[1]]
    disc = np.hypot(xx - (col - (c0 - margin)), yy - (row - (r0 - margin))) <= rpx
    ci, ri = margin, margin

    # ---- 1. slope
    slope = slope_deg(z)
    sv = slope[disc]
    out = {
        "lat": s["lat"], "lon": s["lon"],
        "slope": {
            "at_site_deg": round(float(slope[ri - 1: ri + 2, ci - 1: ci + 2].mean()), 2),
            "mean_deg": round(float(sv.mean()), 2), "median_deg": round(pct(sv, 50), 2),
            "p95_deg": round(pct(sv, 95), 2), "max_deg": round(float(sv.max()), 2),
            "pct_below": {f"{lim:g}": round(float((sv < lim).mean() * 100), 1) for lim in slope_limits},
        },
    }
    safe = (slope < a.safe_slope) & disc
    lab, nlab = ndi.label(safe)
    if nlab:
        areas = ndi.sum(np.ones_like(lab), lab, index=np.arange(1, nlab + 1)) * (CELL / 1000) ** 2
        site_lab = lab[ri, ci]
        out["slope"]["largest_safe_patch_km2"] = round(float(areas.max()), 3)
        out["slope"]["site_patch_km2"] = round(float(areas[site_lab - 1]), 3) if site_lab else 0.0
    else:
        out["slope"]["largest_safe_patch_km2"] = 0.0
        out["slope"]["site_patch_km2"] = 0.0
    out["slope"]["safe_slope_limit_deg"] = a.safe_slope

    # ---- 2. roughness
    rough = {}
    maps = {}
    for b, w in zip(baselines, wins):
        rr_ = rms_plane_residual(z, w)
        rv = rr_[disc]
        rough[f"{b:g}"] = {"window_m": round(w * CELL), "median_m": round(pct(rv, 50), 3), "p95_m": round(pct(rv, 95), 3),
                           "at_site_m": round(float(rr_[ri, ci]), 3)}
        maps[b] = rr_
    out["roughness"] = rough

    # ---- 3. relief, position, horizon
    zd = z[disc] + z0
    site_z = float(z[ri, ci] + z0)
    h0 = float(dem_at(np.array([lat]), np.array([lon]))[0])
    pctl = float((zd < site_z).mean() * 100)
    ring = disc & (np.hypot(xx - ci, yy - ri) <= 1000 / CELL)
    tpi_1km = site_z - float(z[ring].mean() + z0)
    tpi_all = site_z - float(zd.mean())
    out["relief"] = {
        "elevation_m": round(site_z, 1), "min_m": round(float(zd.min()), 1), "max_m": round(float(zd.max()), 1),
        "relief_m": round(float(zd.max() - zd.min()), 1),
        "site_percentile": round(pctl, 1), "tpi_1km_m": round(tpi_1km, 1), "tpi_radius_m": round(tpi_all, 1),
        "position": "crest" if pctl >= 85 else "floor" if pctl <= 15 else "slope",
    }
    hz = horizon_profile(lat, lon, h0)
    out["horizon"] = {"max_deg": round(float(hz.max()), 2), "mean_deg": round(float(hz.mean()), 2),
                      "pct_azimuths_above_2deg": round(float((hz > 2).mean() * 100), 1)}
    result["sites"][s["id"]] = out
    print(f"{s['id']:20s} slope mean {sv.mean():5.1f}  p95 {pct(sv, 95):5.1f}  <10deg {out['slope']['pct_below'].get('10', 0):5.1f}%  "
          f"safe patch {out['slope']['largest_safe_patch_km2']:7.3f} km2  rough400 {rough[f'{baselines[1]:g}']['median_m']:6.2f} m  "
          f"relief {out['relief']['relief_m']:6.0f}  pos {out['relief']['position']:5s}  horizon {hz.max():5.1f}")

    if a.png_dir:
        try:
            import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
            os.makedirs(a.png_dir, exist_ok=True)
            fig, ax = plt.subplots(1, 3, figsize=(15, 5))
            ext = [-margin * CELL / 1000, margin * CELL / 1000] * 2
            for axx, img, title, cmap in [(ax[0], z + z0, "Elevation (m)", "terrain"), (ax[1], slope, "Slope (deg)", "magma"),
                                         (ax[2], maps[baselines[1]], f"Roughness {baselines[1]:g} m (RMS m)", "viridis")]:
                im = axx.imshow(np.where(disc | True, img, np.nan), cmap=cmap, extent=ext); axx.set_title(f"{s['id']}: {title}")
                axx.plot(0, 0, "w+", ms=12); plt.colorbar(im, ax=axx, shrink=0.8)
            fig.tight_layout(); fig.savefig(os.path.join(a.png_dir, f"{s['id']}.png"), dpi=110); plt.close(fig)
        except ImportError:
            print("matplotlib not installed, skipping PNGs"); a.png_dir = None

with open(a.out, "w", encoding="utf-8") as f:
    json.dump(result, f, indent=1)
print("wrote", a.out)