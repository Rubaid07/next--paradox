"use client";

import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import TerrainMesh from "./moon/TerrainMesh";
import LandingSiteMarkers from "./moon/LandingSiteMarkers";
import { createHeightSampler } from "../../lib/terrain";
import type { ColorMode, PlacedSite } from "../../lib/types";
import type { EphemerisData } from "../../lib/ephemeris";
import { EphemerisSun, SkyDome } from "./moon/SkyOverlay";

interface ControlsLike {
  target: THREE.Vector3;
  update: () => void;
}

export interface SiteSceneProps {
  /** Cropped heights around the site (metres, row 0 = north). */
  heights: Float32Array;
  size: number;
  windowKm: number;
  /** The site, already expressed in window coordinates (centre of window = 0,0). */
  site: PlacedSite;
  exaggeration: number;
  sunAzimuth: number;
  sunElevation: number;
  shadows: boolean;
  colorMode: ColorMode;
  colorRange: readonly [number, number];
  /** Bump to re-frame the camera on the site. */
  resetNonce: number;
  /** Real JPL Horizons Sun/Earth data. When set, it drives the sunlight and the sky dome
   *  instead of the manual sunAzimuth / sunElevation. */
  eph?: EphemerisData | null;
  /** Current UTC time (ms), read every frame. */
  tRef?: MutableRefObject<number>;
  lonDeg?: number;
  showTrails?: boolean;
}

/** Places the camera above the site whenever the site / window changes or reset is pressed. */
function CameraFit({
  targetY,
  windowKm,
  siteKey,
  resetNonce,
  siteWorld,
  distanceFactor = 0.85,
}: {
  distanceFactor?: number;
  targetY: number;
  windowKm: number;
  siteKey: string;
  resetNonce: number;
  siteWorld: { x_km: number; z_km: number };
}) {
  const camera = useThree((s) => s.camera);
  const controls = useThree(
    (s) => s.controls,
  ) as unknown as ControlsLike | null;
  const yRef = useRef(targetY);
  const worldRef = useRef(siteWorld);

  useEffect(() => {
    yRef.current = targetY;
    worldRef.current = siteWorld;
  }, [targetY, siteWorld]);

  useEffect(() => {
    if (!controls) return;
    const target = new THREE.Vector3(
      worldRef.current.x_km,
      yRef.current,
      worldRef.current.z_km,
    );
    const dir = new THREE.Vector3(0, 0.62, 0.78).normalize();
    camera.position
      .copy(target)
      .addScaledVector(dir, windowKm * distanceFactor);
    controls.target.copy(target);
    controls.update();
  }, [camera, controls, windowKm, siteKey, resetNonce, distanceFactor]);

  return null;
}

function Sun({
  azimuth,
  elevation,
  shadows,
  windowKm,
  geometryKey,
  exaggeration,
}: {
  azimuth: number;
  elevation: number;
  shadows: boolean;
  windowKm: number;
  geometryKey: unknown;
  exaggeration: number;
}) {
  const gl = useThree((s) => s.gl);
  const light = useRef<THREE.DirectionalLight>(null);
  const dist = windowKm * 3;

  // Azimuth is measured clockwise from map-north (-Z) towards east (+X).
  const position = useMemo<[number, number, number]>(() => {
    const az = THREE.MathUtils.degToRad(azimuth);
    const el = THREE.MathUtils.degToRad(elevation);
    return [
      dist * Math.cos(el) * Math.sin(az),
      dist * Math.sin(el),
      -dist * Math.cos(el) * Math.cos(az),
    ];
  }, [azimuth, elevation, dist]);

  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);

  // The terrain is static: re-render the shadow map only when something that shapes it changes.
  useEffect(() => {
    rendererRef.current = gl;
    rendererRef.current.shadowMap.autoUpdate = false;
    rendererRef.current.shadowMap.needsUpdate = true;
  }, [gl, position, shadows, geometryKey, exaggeration]);

  useEffect(() => {
    const cam = light.current?.shadow.camera;
    if (!cam) return;
    const r = windowKm * 0.75;
    cam.left = -r;
    cam.right = r;
    cam.top = r;
    cam.bottom = -r;
    cam.near = 0.5;
    cam.far = dist * 2 + 200;
    cam.updateProjectionMatrix();
    if (rendererRef.current) rendererRef.current.shadowMap.needsUpdate = true;
  }, [windowKm, dist]);

  return (
    <directionalLight
      ref={light}
      position={position}
      intensity={3.6}
      color="#fff4e2"
      castShadow={shadows}
      shadow-mapSize={[4096, 4096]}
      shadow-bias={-0.0004}
      shadow-normalBias={0.05}
    />
  );
}

export default function SiteScene({
  heights,
  size,
  windowKm,
  site,
  exaggeration,
  sunAzimuth,
  sunElevation,
  shadows,
  colorMode,
  colorRange,
  resetNonce,
  eph = null,
  tRef,
  lonDeg = 0,
  showTrails = true,
}: SiteSceneProps) {
  const sampler = useMemo(
    () => createHeightSampler(heights, size, windowKm),
    [heights, size, windowKm],
  );
  const siteGroundY = sampler(site.world.x_km, site.world.z_km) * exaggeration;
  const sites = useMemo(() => [site], [site]);
  // The sky dome is centred on the terrain patch at the site's altitude and is larger than the
  // patch's corners, so the Sun and Earth sit OUTSIDE the surface and the terrain stays clean.
  // Sun/Earth are effectively at infinity, so their direction from here is the site's true Az/El.
  const domeRadius = windowKm * 0.5 * Math.SQRT2 * 1.12;
  const origin = useMemo(
    () => new THREE.Vector3(0, siteGroundY, 0),
    [siteGroundY],
  );
  const live = !!(eph && tRef);

  return (
    <Canvas
      shadows="soft"
      flat
      dpr={[1, 2]}
      camera={{
        position: [0, windowKm * 0.5, windowKm * 0.7],
        fov: 40,
        near: 0.1,
        far: windowKm * 60,
      }}
      gl={{ antialias: true, powerPreference: "high-performance" }}
    >
      <color attach="background" args={["#050a17"]} />
      <ambientLight intensity={0.8} color="#9db7ff" />
      {live ? (
        <EphemerisSun
          eph={eph}
          tRef={tRef!}
          lonDeg={lonDeg}
          windowKm={windowKm}
          shadows={shadows}
          geometryKey={heights}
          exaggeration={exaggeration}
        />
      ) : (
        <Sun
          azimuth={sunAzimuth}
          elevation={sunElevation}
          shadows={shadows}
          windowKm={windowKm}
          geometryKey={heights}
          exaggeration={exaggeration}
        />
      )}

      <TerrainMesh
        heights={heights}
        size={size}
        extentKm={windowKm}
        exaggeration={exaggeration}
        colorMode={colorMode}
        shadows={shadows}
        colorRange={colorRange}
      />
      <LandingSiteMarkers
        sites={sites}
        selectedId={site.id}
        sampler={sampler}
        exaggeration={exaggeration}
        showLabels
        onSelect={() => {}}
      />

      {live && (
        <SkyDome
          origin={origin}
          radius={domeRadius}
          lonDeg={lonDeg}
          eph={eph}
          tRef={tRef!}
          showTrails={showTrails}
        />
      )}

      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.08}
        screenSpacePanning
        zoomToCursor // ← মাউসের দিকে zoom
        minDistance={1.5}
        maxDistance={windowKm * 4}
        maxPolarAngle={Math.PI * 0.495}
        rotateSpeed={0.6}
        panSpeed={0.8} // ঐচ্ছিক
        zoomSpeed={0.9} // ঐচ্ছিক
      />
      <CameraFit
        targetY={siteGroundY}
        windowKm={windowKm}
        siteKey={site.id}
        resetNonce={resetNonce}
        siteWorld={site.world}
        distanceFactor={live ? 1.5 : 0.85}
      />
    </Canvas>
  );
}
