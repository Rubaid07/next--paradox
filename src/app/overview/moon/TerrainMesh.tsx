"use client";

import { useEffect, useMemo } from "react";
import { buildTerrainGeometry } from "../../../lib/terrain";
import { applyVertexColors } from "../../../lib/colormap";
import type { ColorMode } from "../../../lib/types";

interface TerrainMeshProps {
  /** Heights in metres, row-major, size x size, row 0 = north. */
  heights: Float32Array;
  size: number;
  extentKm: number;
  exaggeration: number;
  colorMode: ColorMode;
  shadows: boolean;
  /** Optional [min, max] metres to stretch the colour palette over (used for local views). */
  colorRange?: readonly [number, number];
}

// Raycasting 2-4 million triangles on every pointer move would stall the UI, and the terrain
// itself is not interactive (only the markers are), so the mesh opts out of picking.
const noRaycast = () => {};

export default function TerrainMesh({
  heights,
  size,
  extentKm,
  exaggeration,
  colorMode,
  shadows,
  colorRange,
}: TerrainMeshProps) {
  // Built once per heightmap. Vertical exaggeration is applied through mesh.scale.y, so dragging
  // the slider never rebuilds geometry (three.js corrects normals for non-uniform scale).
  const geometry = useMemo(() => {
    return buildTerrainGeometry(heights, size, extentKm);
  }, [heights, size, extentKm]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  useEffect(() => {
    applyVertexColors(geometry, heights, colorMode, colorRange);
  }, [geometry, heights, colorMode, colorRange]);

  return (
    <mesh
      geometry={geometry}
      scale={[1, exaggeration, 1]}
      castShadow={shadows}
      receiveShadow={shadows}
      raycast={noRaycast}
    >
      <meshLambertMaterial vertexColors />
    </mesh>
  );
}
