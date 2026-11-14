"use client";

import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Stars } from "@react-three/drei";
import * as THREE from "three";
import TerrainMesh from "./TerrainMesh";
import LandingSiteMarkers from "./LandingSiteMarkers";
import type { PlacedSite, ViewRequest, ViewSettings } from "../../../lib/types";
import type { HeightSampler } from "../../../lib/terrain";
import { HOME_DIRECTION, HOME_DISTANCE } from "../../../lib/camera";

interface ControlsLike {
  target: THREE.Vector3;
  update: () => void;
}

/** Smoothly moves the orbit target and camera when a ViewRequest arrives. */
function CameraRig({ request }: { request: ViewRequest | null }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree(
    (s) => s.controls,
  ) as unknown as ControlsLike | null;
  const anim = useRef<{
    t: number;
    fromT: THREE.Vector3;
    toT: THREE.Vector3;
    fromP: THREE.Vector3;
    toP: THREE.Vector3;
  } | null>(null);

  useEffect(() => {
    if (!request || !controls) return;
    const toT = new THREE.Vector3(...request.target);
    const dir = request.direction
      ? new THREE.Vector3(...request.direction).normalize()
      : camera.position.clone().sub(controls.target).normalize();
    if (!request.direction && dir.y < 0.35) {
      dir.y = 0.35; // never fly in below a comfortable viewing angle
      dir.normalize();
    }
    anim.current = {
      t: 0,
      fromT: controls.target.clone(),
      toT,
      fromP: camera.position.clone(),
      toP: toT.clone().addScaledVector(dir, request.distance),
    };
  }, [request, camera, controls]);

  useFrame((_, delta) => {
    const a = anim.current;
    if (!a || !controls) return;
    a.t = Math.min(1, a.t + delta / 1.1);
    const e = 1 - Math.pow(1 - a.t, 3);
    controls.target.lerpVectors(a.fromT, a.toT, e);
    camera.position.lerpVectors(a.fromP, a.toP, e);
    controls.update();
    if (a.t >= 1) anim.current = null;
  });

  return null;
}

interface SunProps {
  azimuth: number;
  elevation: number;
  shadows: boolean;
  /** Anything that changes the shadow-casting geometry. */
  geometryKey: unknown;
  exaggeration: number;
}

function Sun({
  azimuth,
  elevation,
  shadows,
  geometryKey,
  exaggeration,
}: SunProps) {
  const gl = useThree((s) => s.gl);
  const light = useRef<THREE.DirectionalLight>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);

  // Azimuth is measured clockwise from map-north (-Z) towards east (+X).
  const position = useMemo<[number, number, number]>(() => {
    const az = THREE.MathUtils.degToRad(azimuth);
    const el = THREE.MathUtils.degToRad(elevation);
    const d = 900;
    return [
      d * Math.cos(el) * Math.sin(az),
      d * Math.sin(el),
      -d * Math.cos(el) * Math.cos(az),
    ];
  }, [azimuth, elevation]);

  // The terrain is static, so the shadow map only needs re-rendering when the sun,
  // exaggeration or mesh changes, not on every camera move.
  useEffect(() => {
    rendererRef.current = gl;
    rendererRef.current.shadowMap.autoUpdate = false;
    rendererRef.current.shadowMap.needsUpdate = true;
  }, [gl, position, shadows, geometryKey, exaggeration]);

  useEffect(() => {
    const cam = light.current?.shadow.camera;
    if (!cam) return;
    cam.left = -440;
    cam.right = 440;
    cam.top = 440;
    cam.bottom = -440;
    cam.near = 1;
    cam.far = 2200;
    cam.updateProjectionMatrix();
  }, []);

  return (
    <directionalLight
      ref={light}
      position={position}
      intensity={3.6}
      color="#fff4e2"
      castShadow={shadows}
      shadow-mapSize={[4096, 4096]}
      shadow-bias={-0.0004}
      shadow-normalBias={0.25}
    />
  );
}

export interface LunarSceneProps {
  heights: Float32Array;
  size: number;
  extentKm: number;
  settings: ViewSettings;
  sites: PlacedSite[];
  selectedId: string | null;
  sampler: HeightSampler;
  viewRequest: ViewRequest | null;
  onSelect: (id: string) => void;
}

export default function LunarScene({
  heights,
  size,
  extentKm,
  settings,
  sites,
  selectedId,
  sampler,
  viewRequest,
  onSelect,
}: LunarSceneProps) {
  const initialCamera = useMemo(() => {
    const d = new THREE.Vector3(...HOME_DIRECTION)
      .normalize()
      .multiplyScalar(HOME_DISTANCE);
    return d.toArray() as [number, number, number];
  }, []);

  return (
    <Canvas
      shadows="soft"
      flat
      dpr={[1, 2]}
      camera={{ position: initialCamera, fov: 40, near: 0.5, far: 9000 }}
      gl={{ antialias: true, powerPreference: "high-performance" }}
    >
      <color attach="background" args={["#050a17"]} />
      <Stars
        radius={3200}
        depth={300}
        count={3500}
        factor={7}
        saturation={0}
        fade
        speed={0}
      />

      <ambientLight intensity={0.8} color="#9db7ff" />
      <Sun
        azimuth={settings.sunAzimuth}
        elevation={settings.sunElevation}
        shadows={settings.shadows}
        geometryKey={heights}
        exaggeration={settings.exaggeration}
      />

      <TerrainMesh
        heights={heights}
        size={size}
        extentKm={extentKm}
        exaggeration={settings.exaggeration}
        colorMode={settings.colorMode}
        shadows={settings.shadows}
      />
      <LandingSiteMarkers
        sites={sites}
        selectedId={selectedId}
        sampler={sampler}
        exaggeration={settings.exaggeration}
        showLabels={settings.showLabels}
        onSelect={onSelect}
      />

      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.08}
        screenSpacePanning
        zoomToCursor
        minDistance={6}
        maxDistance={1700}
        maxPolarAngle={Math.PI * 0.495}
        rotateSpeed={0.6}
      />
      <CameraRig request={viewRequest} />
    </Canvas>
  );
}
