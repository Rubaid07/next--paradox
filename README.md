# Lunar Landing Site Navigator

A browser-based decision-support tool for exploring lunar south-polar landing-site terrain and comparing candidate mission windows. It brings terrain screening, Sun/Earth visibility, communication geometry, and mission-planning assumptions into one interface.

> **Scope:** This is an exploratory planning aid, not a landing-site certification, flight-dynamics product, communications link budget, or spacecraft power/thermal simulation.

## What it helps answer

- How steep or rough is the terrain around a candidate site, and how does the site sit in its local relief?
- Which terrain features can obstruct the Sun or Earth at a given location?
- How do candidate sites compare over a selected mission duration and launch date?
- How sensitive are power, communications, and the composite ranking to mission priority or launch delay?
- What assumptions and data limitations should accompany a mission-planning result?

## Main pages

| Route | Purpose |
| --- | --- |
| `/analysis` | Landing-site terrain maps, slope coverage, roughness, local relief, and a terrain horizon mask. |
| `/overview` | Interactive 3D terrain and site view; live Sun/Earth ephemerides, terrain-masked visibility, and time playback. |
| `/` | Mission comparison heatmap, site rankings, best launch windows, delay analysis, and Science/Engineering comparison. |
| `/report` | A report generated from the saved plan on the Comparison page. |

The selected site is shared between pages. Comparison mission duration options are 3, 7, and 14 days; the Overview follows the saved duration.

## Data included and used

| File | Contents and role |
| --- | --- |
| `public/data/meta.json` | DEM source identity, CRS, lunar reference radius, coverage, raster metadata, and available heightmap levels. |
| `public/data/sites.json` | Eight mapped site records, coordinates, projected positions, source notes, verification labels, and sampled elevations. Some candidate-region coordinates are approximate or secondary-source values; see each record's `source` and `note`. |
| `public/data/heightmap_1520.f32` | 1520 x 1520 little-endian float32 terrain grid at 400 m/cell. Used by the terrain viewer, local maps, and runtime terrain-horizon calculations. |
| `public/data/heightmap_950.f32` | 950 x 950 little-endian float32 terrain grid at 640 m/cell; an additional coarser level. Current pages select the 400 m level as the finest available. |
| `public/data/terrain_analysis.json` | Precomputed per-site metrics from the 80 m `LDEM_80S_80MPP_ADJ` DEM, including 5 km slope coverage, multi-baseline roughness, and 5 km relief statistics. |
| `public/data/site_series.json` | Precomputed hourly Sun, Earth, and DSN-visibility series for eight sites, from 2026-11-10 through 2028-12-31 (783 days). It also contains each site's coarse terrain attributes and the model metadata. |

The original 80 m GeoTIFF is not included in `public/data`. `scripts/process_dem.py` documents the terrain preprocessing: it reads the south-polar stereographic GeoTIFF, converts site coordinates into the DEM projection, checks coverage, samples site elevations, and block-mean downsamples the DEM into binary heightmaps. To rerun it, supply the original GeoTIFF and site-input JSON:

```bash
python scripts/process_dem.py --input <LDEM_80S_80MPP_ADJ.tiff> --sites <sites_input.json> --out public/data
```

The script requires the packages in `scripts/requirements.txt`; the `pyproj` projection cross-check is optional. This script does **not** regenerate `terrain_analysis.json` or `site_series.json`; those are precomputed data artifacts, and their full generation pipelines are not included here.

### Coordinate and elevation conventions

- The DEM is a south-polar stereographic raster on a spherical Moon with reference radius **1,737,400 m**. Elevations are metres relative to that reference sphere, not an absolute radius from the lunar centre.
- The scene uses kilometres: projected easting is `x`, elevation is `y`, and projected northing is represented by `z = -northing`.
- Site coordinates have different provenance and precision. The app preserves source/verification notes rather than treating every marker as a surveyed landing coordinate.
- Coordinate sources recorded in `sites.json` include USGS/IAU Gazetteer data, NASA Artemis candidate-region references, and published candidate-site sources. Some entries are explicitly marked secondary or approximate; a region center is not necessarily a proposed touchdown point.
- Heightmaps are block means of source DEM cells; downsampling adds no terrain detail. A 400 m grid cannot resolve small boulders, narrow ridges, or other sub-cell hazards.

## How the calculations work

### Terrain screening

- **Slope coverage:** The Analysis page shows the fraction of a circular neighborhood below 5°, 10°, and 15° slope. Its 5 km values come from the precomputed 80 m analysis. The selectable 10 km values are calculated from the 400 m heightmap using central-difference elevation gradients and `atan(sqrt(dz/dx^2 + dz/dy^2))`. These are screening thresholds, not a landing-safety guarantee.
- **Local maps:** The selected 400 m heightmap is cropped into 6, 12, 24, 50, or 100 km views. Larger views aggregate cells to keep the displayed raster compact. Elevation is shown relative to the lunar reference sphere; slope is derived from neighboring height samples. Map roughness is a local detrended RMS over a 3 x 3 cell neighborhood, with its display colors clipped at the local 95th percentile.
- **Roughness table:** The 200, 400, 800, and 1600 m baseline rows are precomputed in `terrain_analysis.json`. The displayed effective windows (240, 400, 880, and 1680 m) reflect the source grid and analysis sampling; they are not claims of 200 m source resolution.
- **Local relief:** The precomputed 5 km neighborhood minimum and maximum define relief as `maximum - minimum`. Site elevation percentile and terrain-position classification are also supplied by the precomputed analysis.

### Terrain horizon and visibility

A horizon mask records the highest terrain elevation angle in each azimuth direction. For a sample at distance `d`, lunar curvature is accounted for using a spherical Moon (`R = 1,737.4 km`); the curvature drop is approximately `d^2 / (2R)`. A Sun or Earth sample is terrain-visible when its apparent elevation is above the mask at its azimuth.

The pages use different documented grids and extents:

- **Analysis:** 400 m heightmap, a roughly 20 km square around the site, 360 azimuth bins, and 100 m ray steps. Diagonal rays can reach farther than the square's 10 km half-width.
- **Overview:** 400 m heightmap, 720 azimuth bins (0.5°), 200 m steps, a 2 m observer height, and a 400 km cap. Rays stop at the edge of available DEM coverage, so terrain beyond the dataset is not included.
- **Mission comparison:** The precomputed series uses a 400 m LOLA grid, 0.5° azimuth bins, 200 m steps up to 400 km (again truncated at the DEM edge), and a 2 m mast.

In the Overview, visibility percentages and longest hidden intervals are measured over the selected Horizons time window. That live display uses the Sun/Earth centre elevation against the terrain skyline; it does not model partial-disc occultation.

### Ephemerides and live Overview

The `/api/ephemeris` route requests Sun and Earth observer tables from the JPL Horizons API for the selected lunar-site latitude, longitude, altitude, UTC date range, and time step. It parses the returned azimuth/elevation rows, verifies that Sun and Earth timestamps align, and returns the sampled series to the browser. The Overview interpolates between those rows for smooth playback and applies its local DEM horizon mask to the visibility statistics.

The Comparison page does **not** make a live Horizons request for every heatmap cell. It reads `site_series.json`, a precomputed hourly series whose metadata identifies JPL DE421, lunar libration/frame handling, the 400 m LOLA grid, and the DSN stations used. The file covers 783 days; rankings beyond that interval require updated series data.

### Mission model and rankings

The Comparison and Report pages apply explicit planning assumptions to the precomputed hourly series:

- The Sun series encodes the visible solar-disk fraction in 16 levels (`0` to `15`). For power simulation, the fraction is `level / 15`; the simulated solar array produces **2 times** the continuous load at full Sun.
- Battery capacity is **24 hours** of continuous load. Each hourly step updates state of charge as `min(capacity, previous charge + 2 * sunlight_fraction - 1)`, starting with a full battery. Power is unavailable after the simulated charge is depleted.
- Earth visibility is geometric. A direct-to-Earth (DTE) opportunity additionally requires at least one of Goldstone, Canberra, or Madrid to see the Moon above the configured **10°** station elevation threshold. This is not a radio link budget or guaranteed communications.
- Mission continuity is the share of hours that are powered and have had Earth contact within the prior **72 hours**. Power availability, DTE availability, simultaneous overlap, longest dark run, and longest communication gap are reported separately.
- Composite risk is a heuristic weighted sum: 30% normalized mean-slope risk, 30% longest-dark-period risk (saturating at 14 days), 20% DTE unavailability, and 20% longest-gap risk (saturating at 120 hours). The risk score is not a probability of mission failure.
- Overall ranking weights are **Power First** (0.60 power, 0.25 communications, 0.15 safety), **Comm First** (0.25, 0.60, 0.15), or **Balance** (0.40, 0.40, 0.20). The safety term is `100 - risk`.
- The best-window search evaluates daily start dates over the next 60 days for the selected duration and priority. The delay analysis evaluates delays up to 30 days. The heatmap presents a coarser date grid.
- Science/Engineering scores are configurable trade-offs: Science blends across-site normalized relief with power availability; Engineering blends `100 - risk` with communications availability. Consensus is based on overlap between each team's top-three sites. These scores are comparative heuristics, not standalone scientific or engineering suitability ratings.

### Report and validation caveat

The Report page reads the saved Comparison plan and the same precomputed hourly series. Its continuity, power, risk, ranking, and best-window metrics use the model above.

The current report's **Reference Validation** charts are not an independent validation against downloaded Horizons or PGDA observations: the report helper constructs simplified periodic reference curves and a deterministic sunlight offset. Treat those charts as illustrative diagnostics, not scientific validation. The live Overview's Horizons data is a separate, real API request.

## External sources and title notes

The titles below use the source pages' own names where available. Descriptive phrases supplied with the links explain their relevance, but are not always the official page title.

| Source | Role and use in this project |
| --- | --- |
| NASA GSFC PGDA, [A New View of the Lunar South Pole from LOLA](https://pgda.gsfc.nasa.gov/products/90) | Official page title. Provenance for LOLA south-polar DEM products; the project metadata identifies `LDEM_80S_80MPP_ADJ.tiff` as its terrain source. |
| NAIF, [LEAPSECONDS KERNEL FILE (`naif0012.tls`)](https://naif.jpl.nasa.gov/pub/naif/generic_kernels/lsk/naif0012.tls) | The file header calls it a “LEAPSECONDS KERNEL FILE”; it documents the UTC/TAI/ET relationship and leap-second table. The web app itself accepts UTC and delegates ephemeris/time handling to Horizons; it does not load this kernel at runtime. |
| NASA GSFC PGDA, [Lunar Polar Illumination](https://pgda.gsfc.nasa.gov/products/69) | Official page title. Reference material for long-term polar solar illumination, Earth visibility, and permanently shadowed regions. The current app does not directly ingest this product's long-term illumination rasters. |
| NAIF, [Generic Kernels directory](https://naif.jpl.nasa.gov/pub/naif/generic_kernels/) | A directory of SPICE kernels, not one specific dataset. `site_series.json` records DE421 and lunar-frame provenance for its precomputed series; the browser application reads that series rather than loading the directory's kernel files. |
| JPL, [Horizons System](https://ssd.jpl.nasa.gov/horizons/app.html#/) | JPL's ephemeris system. The live Overview uses its API endpoint, [`https://ssd.jpl.nasa.gov/api/horizons.api`](https://ssd.jpl.nasa.gov/api/horizons.api), for topocentric Sun/Earth azimuth and elevation. |

### Current limitations

- Candidate locations are representative points; some coordinates are approximate or secondary-source values. Check the per-site provenance in `public/data/sites.json`.
- The 400 m heightmap and finite DEM coverage limit small-scale slope, obstacle, and distant-horizon accuracy.
- The power model is a simplified battery/array proxy. There is no spacecraft-specific load profile, panel tracking, thermal model, dust model, or power-system design.
- DTE is line-of-sight geometry only. There is no RF link budget, station scheduling, antenna model, or confirmed contact.
- The Sun and Earth are treated as point sources for the live terrain-visibility calculation.
- Horizons requires network access and can be unavailable; the precomputed Comparison series remains a separate, date-limited dataset.

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The live Overview requires an internet connection to reach JPL Horizons.

Useful project checks:

```bash
npm run lint
npm run build
```

The app is built with Next.js, React, TypeScript, Three.js, and React Three Fiber.
