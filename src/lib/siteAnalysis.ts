export interface SlopeCoverage {
  samples: number;
  below5Pct: number;
  below10Pct: number;
  below15Pct: number;
}

export interface TerrainRasterLayer {
  values: Float32Array;
  min: number;
  max: number;
}

export interface SiteTerrainRaster {
  size: number;
  windowKm: number;
  cellSizeM: number;
  centerXKm: number;
  centerZKm: number;
  elevation: TerrainRasterLayer;
  slope: TerrainRasterLayer;
  roughness: TerrainRasterLayer;
}

function rasterLayer(values: Float32Array): TerrainRasterLayer {
  let min = Infinity;
  let max = -Infinity;
  for (const value of values) {
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  return { values, min, max };
}

/**
 * Builds an elevation, slope and detrended local-RMS patch around one site.
 * Large windows aggregate source cells so the rendered patch stays at most 128 cells wide.
 */
export function buildSiteTerrainRaster(
  heights: Float32Array,
  size: number,
  extentKm: number,
  siteXKm: number,
  siteZKm: number,
  windowKm: number,
): SiteTerrainRaster {
  const cellKm = extentKm / size;
  const half = extentKm / 2;
  const requestedCells = Math.max(3, Math.round(windowKm / cellKm));
  const sampleStep = Math.max(1, Math.ceil(requestedCells / 128));
  const patchSize = Math.min(
    Math.ceil(requestedCells / sampleStep),
    Math.floor(size / sampleStep),
  );
  const sourceSpan = patchSize * sampleStep;
  const siteCol = (siteXKm + half) / cellKm - 0.5;
  const siteRow = (siteZKm + half) / cellKm - 0.5;
  const col0 = Math.max(
    0,
    Math.min(size - sourceSpan, Math.round(siteCol + 0.5 - sourceSpan / 2)),
  );
  const row0 = Math.max(
    0,
    Math.min(size - sourceSpan, Math.round(siteRow + 0.5 - sourceSpan / 2)),
  );
  const windowSizeKm = sourceSpan * cellKm;
  const outputCellKm = sampleStep * cellKm;
  const cellSizeM = outputCellKm * 1000;
  const centerXKm = -half + (col0 + sourceSpan / 2) * cellKm;
  const centerZKm = -half + (row0 + sourceSpan / 2) * cellKm;
  const elevations = new Float32Array(patchSize * patchSize);
  const slopes = new Float32Array(patchSize * patchSize);
  const roughness = new Float32Array(patchSize * patchSize);

  const blockMean = (startRow: number, startCol: number) => {
    let sum = 0;
    for (let row = 0; row < sampleStep; row++) {
      for (let col = 0; col < sampleStep; col++) {
        sum += heights[(startRow + row) * size + startCol + col];
      }
    }
    return sum / (sampleStep * sampleStep);
  };

  for (let row = 0; row < patchSize; row++) {
    const globalRow = row0 + row * sampleStep;
    for (let col = 0; col < patchSize; col++) {
      const globalCol = col0 + col * sampleStep;
      const index = row * patchSize + col;
      elevations[index] = blockMean(globalRow, globalCol);

      const left = Math.max(globalCol - sampleStep, 0);
      const right = Math.min(globalCol + sampleStep, size - sampleStep);
      const north = Math.max(globalRow - sampleStep, 0);
      const south = Math.min(globalRow + sampleStep, size - sampleStep);
      const dhdx =
        (blockMean(globalRow, right) - blockMean(globalRow, left)) /
        (1000 * (right - left) * cellKm);
      const dhdz =
        (blockMean(south, globalCol) - blockMean(north, globalCol)) /
        (1000 * (south - north) * cellKm);
      slopes[index] = (Math.atan(Math.hypot(dhdx, dhdz)) * 180) / Math.PI;
    }
  }

  for (let row = 0; row < patchSize; row++) {
    for (let col = 0; col < patchSize; col++) {
      const index = row * patchSize + col;
      let sum = 0;
      let sumDxHeight = 0;
      let sumDyHeight = 0;
      const neighborhood = new Float64Array(9);
      let neighborIndex = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const neighbor =
            elevations[
              Math.min(Math.max(row + dy, 0), patchSize - 1) * patchSize +
                Math.min(Math.max(col + dx, 0), patchSize - 1)
            ];
          neighborhood[neighborIndex++] = neighbor;
          sum += neighbor;
          sumDxHeight += dx * neighbor;
          sumDyHeight += dy * neighbor;
        }
      }

      const mean = sum / 9;
      const gradientX = sumDxHeight / 6;
      const gradientY = sumDyHeight / 6;
      let residualSquared = 0;
      neighborIndex = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const residual = neighborhood[neighborIndex++] - mean - gradientX * dx - gradientY * dy;
          residualSquared += residual * residual;
        }
      }
      roughness[index] = Math.sqrt(residualSquared / 9);
    }
  }

  return {
    size: patchSize,
    windowKm: windowSizeKm,
    cellSizeM,
    centerXKm,
    centerZKm,
    elevation: rasterLayer(elevations),
    slope: rasterLayer(slopes),
    roughness: rasterLayer(roughness),
  };
}

/**
 * Calculates the fraction of DEM cells below selected slope limits inside a site radius.
 * Elevations are metres; the grid uses the terrain viewer's x/z kilometre coordinates.
 */
export function analyzeSlopeCoverage(
  heights: Float32Array,
  size: number,
  extentKm: number,
  centerXKm: number,
  centerZKm: number,
  radiusKm: number,
): SlopeCoverage {
  const cellKm = extentKm / size;
  const half = extentKm / 2;
  const centerCol = (centerXKm + half) / cellKm - 0.5;
  const centerRow = (centerZKm + half) / cellKm - 0.5;
  const radiusCells = radiusKm / cellKm;
  const minCol = Math.max(0, Math.floor(centerCol - radiusCells));
  const maxCol = Math.min(size - 1, Math.ceil(centerCol + radiusCells));
  const minRow = Math.max(0, Math.floor(centerRow - radiusCells));
  const maxRow = Math.min(size - 1, Math.ceil(centerRow + radiusCells));
  const radiusSquared = radiusKm * radiusKm;

  let samples = 0;
  let below5 = 0;
  let below10 = 0;
  let below15 = 0;

  for (let row = minRow; row <= maxRow; row++) {
    const z = -half + (row + 0.5) * cellKm;
    const dz = z - centerZKm;
    for (let col = minCol; col <= maxCol; col++) {
      const x = -half + (col + 0.5) * cellKm;
      const dx = x - centerXKm;
      if (dx * dx + dz * dz > radiusSquared) continue;

      const left = Math.max(col - 1, 0);
      const right = Math.min(col + 1, size - 1);
      const north = Math.max(row - 1, 0);
      const south = Math.min(row + 1, size - 1);
      const dhdx =
        (heights[row * size + right] - heights[row * size + left]) /
        (1000 * (right - left) * cellKm);
      const dhdz =
        (heights[south * size + col] - heights[north * size + col]) /
        (1000 * (south - north) * cellKm);
      const slopeDeg = (Math.atan(Math.hypot(dhdx, dhdz)) * 180) / Math.PI;

      samples++;
      if (slopeDeg < 5) below5++;
      if (slopeDeg < 10) below10++;
      if (slopeDeg < 15) below15++;
    }
  }

  const percentage = (count: number) => (samples ? (count / samples) * 100 : 0);
  return {
    samples,
    below5Pct: percentage(below5),
    below10Pct: percentage(below10),
    below15Pct: percentage(below15),
  };
}
