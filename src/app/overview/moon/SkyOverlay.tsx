"use client";

import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import {
  localDirection,
  sampleBody,
  type BodyTrack,
  type EphemerisData,
} from "../../../lib/ephemeris";

/**
 * Ephemeris-driven Sun light + sky dome (Sun & Earth markers, tracks, horizon graticule).
 * Used inside SiteScene's <Canvas>. All directions come from real JPL Horizons Az/El.
 */

const SUN_COLOR = "#ffc857";
const EARTH_COLOR = "#4da3ff";

function makeLabelTexture(text: string, color: string, fontSize: number) {
  const font = `600 ${fontSize}px system-ui, sans-serif`;
  const padding = 4;
  const pixelRatio = 2;
  const canvas = document.createElement("canvas");
  const measureContext = canvas.getContext("2d");
  if (!measureContext) throw new Error("Could not create sky label canvas context.");

  measureContext.font = font;
  const width = Math.ceil(measureContext.measureText(text).width + padding * 2);
  const height = fontSize + padding * 2;
  canvas.width = width * pixelRatio;
  canvas.height = height * pixelRatio;

  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not create sky label canvas context.");
  context.scale(pixelRatio, pixelRatio);
  context.font = font;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.shadowColor = "#000";
  context.shadowBlur = 4;
  context.fillStyle = color;
  context.fillText(text, width / 2, height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return { texture, aspect: width / height };
}

function SkyLabel({
  text,
  color,
  fontSize,
  position,
}: {
  text: string;
  color: string;
  fontSize: number;
  position: [number, number, number];
}) {
  const camera = useThree((state) => state.camera);
  const viewport = useThree((state) => state.size);
  const sprite = useRef<THREE.Sprite>(null);
  const cameraPosition = useMemo(() => new THREE.Vector3(), []);
  const labelPosition = useMemo(() => new THREE.Vector3(), []);
  const { texture, aspect } = useMemo(
    () => makeLabelTexture(text, color, fontSize),
    [text, color, fontSize],
  );

  useEffect(() => () => texture.dispose(), [texture]);

  useFrame(() => {
    if (!sprite.current || viewport.height === 0) return;

    sprite.current.getWorldPosition(labelPosition);
    camera.getWorldPosition(cameraPosition);
    const distance = labelPosition.distanceTo(cameraPosition);
    const viewHeight =
      camera instanceof THREE.PerspectiveCamera
        ? 2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.getEffectiveFOV() / 2))
        : camera instanceof THREE.OrthographicCamera
          ? (camera.top - camera.bottom) / camera.zoom
          : distance;
    const worldHeight = (fontSize * viewHeight) / viewport.height;
    sprite.current.scale.set(worldHeight * aspect, worldHeight, 1);
  });

  return (
    <sprite ref={sprite} position={position} renderOrder={8}>
      <spriteMaterial map={texture} transparent depthTest={false} depthWrite={false} />
    </sprite>
  );
}

// ---------------------------------------------------------------------------------------------
// Sunlight driven by the ephemeris
// ---------------------------------------------------------------------------------------------

export function EphemerisSun({
  eph,
  tRef,
  lonDeg,
  windowKm,
  shadows,
  geometryKey,
  exaggeration,
}: {
  eph: EphemerisData | null;
  tRef: MutableRefObject<number>;
  lonDeg: number;
  windowKm: number;
  shadows: boolean;
  geometryKey: unknown;
  exaggeration: number;
}) {
  const gl = useThree((s) => s.gl);
  const light = useRef<THREE.DirectionalLight>(null);
  const lastDir = useRef(new THREE.Vector3(0, 1, 0));
  const dir = useMemo(() => new THREE.Vector3(), []);
  const dist = windowKm * 3;

  // The terrain is static: only re-render the shadow map when the sun moved or geometry changed.
  useEffect(() => {
    gl.shadowMap.autoUpdate = false;
    gl.shadowMap.needsUpdate = true;
    lastDir.current.set(0, -1, 0);
  }, [gl, geometryKey, exaggeration, shadows, eph]);

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
    gl.shadowMap.needsUpdate = true;
  }, [gl, windowKm, dist]);

  useFrame(() => {
    const l = light.current;
    if (!l) return;
    if (!eph) {
      l.intensity = 0;
      return;
    }
    const s = sampleBody(eph, "sun", tRef.current);
    const [x, y, z] = localDirection(s.az, s.el, lonDeg);
    dir.set(x, y, z);
    l.position.copy(dir).multiplyScalar(dist);

    // Fade over the solar disc's angular radius (~0.27 deg) instead of a hard on/off.
    l.intensity = 3.6 * THREE.MathUtils.clamp((s.el + 0.27) / 0.54, 0, 1);

    if (dir.angleTo(lastDir.current) > 3.5e-4) {
      lastDir.current.copy(dir);
      gl.shadowMap.needsUpdate = true;
    }
  });

  return (
    <directionalLight
      ref={light}
      intensity={0}
      color="#fff4e2"
      castShadow={shadows}
      shadow-mapSize={[2048, 2048]}
      shadow-bias={-0.0004}
      shadow-normalBias={0.05}
    />
  );
}

// ---------------------------------------------------------------------------------------------
// Sky dome (centred on the site)
// ---------------------------------------------------------------------------------------------

function ringPoints(elDeg: number, r: number, n = 128): THREE.Vector3[] {
  const e = (elDeg * Math.PI) / 180;
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push(new THREE.Vector3(r * Math.cos(e) * Math.cos(a), r * Math.sin(e), r * Math.cos(e) * Math.sin(a)));
  }
  return pts;
}

function lineFrom(points: THREE.Vector3[], color: string, opacity: number): THREE.Line {
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: false }),
  );
  line.renderOrder = 4;
  line.frustumCulled = false;
  return line;
}

/** Real track of a body over the loaded window; bright above the horizon, dim below. */
function buildTrail(
  track: BodyTrack,
  count: number,
  lonDeg: number,
  r: number,
  color: string,
): THREE.LineSegments {
  const stride = Math.max(1, Math.ceil(count / 1500));
  const base = new THREE.Color(color);
  const dim = base.clone().multiplyScalar(0.3);
  const pos: number[] = [];
  const col: number[] = [];

  for (let i = 0; i < count - 1; i += stride) {
    const j = Math.min(i + stride, count - 1);
    const a = localDirection(track.az[i], track.el[i], lonDeg);
    const b = localDirection(track.az[j], track.el[j], lonDeg);
    const c = (track.el[i] + track.el[j]) / 2 > 0 ? base : dim;
    pos.push(a[0] * r, a[1] * r, a[2] * r, b[0] * r, b[1] * r, b[2] * r);
    col.push(c.r, c.g, c.b, c.r, c.g, c.b);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  const lines = new THREE.LineSegments(
    g,
    new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95, depthTest: false }),
  );
  lines.renderOrder = 5;
  lines.frustumCulled = false;
  return lines;
}

export function SkyDome({
  origin,
  radius,
  lonDeg,
  eph,
  tRef,
  showTrails,
}: {
  /** Centre of the sky dome: the terrain patch centre, at the landing site's altitude. */
  origin: THREE.Vector3;
  /** Larger than the terrain patch's corners, so nothing is drawn over the surface. */
  radius: number;
  lonDeg: number;
  eph: EphemerisData | null;
  tRef: MutableRefObject<number>;
  showTrails: boolean;
}) {
  const sunGroup = useRef<THREE.Group>(null);
  const earthGroup = useRef<THREE.Group>(null);
  const sunCore = useRef<THREE.MeshBasicMaterial>(null);
  const sunGlow = useRef<THREE.SpriteMaterial>(null);
  const earthCore = useRef<THREE.MeshStandardMaterial>(null);
  const earthAir = useRef<THREE.MeshBasicMaterial>(null);

  // Only the horizon ring, drawn outside the terrain patch.
  const horizon = useMemo(() => {
    const g = new THREE.Group();
    g.add(lineFrom(ringPoints(0, radius), "#8fb4ff", 0.6));
    return g;
  }, [radius]);

  const cardinals = useMemo(
    () =>
      (
        [
          ["N", 0],
          ["E", 90],
          ["S", 180],
          ["W", 270],
        ] as const
      ).map(([label, az]) => {
        const d = localDirection(az, 0, lonDeg);
        return { label, pos: [d[0] * radius * 1.07, 0, d[2] * radius * 1.07] as [number, number, number] };
      }),
    [radius, lonDeg],
  );

  const trails = useMemo(() => {
    if (!eph) return null;
    const g = new THREE.Group();
    g.add(buildTrail(eph.sun, eph.count, lonDeg, radius, SUN_COLOR));
    g.add(buildTrail(eph.earth, eph.count, lonDeg, radius, EARTH_COLOR));
    return g;
  }, [eph, lonDeg, radius]);

  const glowTexture = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const ctx = c.getContext("2d")!;
    const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, "rgba(255,226,140,1)");
    grad.addColorStop(0.25, "rgba(255,196,90,0.55)");
    grad.addColorStop(1, "rgba(255,170,40,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  }, []);

  useEffect(
    () => () => {
      for (const root of [horizon, trails]) {
        root?.traverse((o) => {
          const m = o as THREE.Mesh;
          m.geometry?.dispose();
          (m.material as THREE.Material | undefined)?.dispose();
        });
      }
    },
    [horizon, trails],
  );
  useEffect(() => () => glowTexture.dispose(), [glowTexture]);

  useFrame(() => {
    if (!eph) return;
    const t = tRef.current;
    const place = (name: "sun" | "earth", group: THREE.Group | null) => {
      if (!group) return 0;
      const s = sampleBody(eph, name, t);
      const d = localDirection(s.az, s.el, lonDeg);
      group.position.set(d[0] * radius, d[1] * radius, d[2] * radius);
      return s.el;
    };
    const sunEl = place("sun", sunGroup.current);
    const earthEl = place("earth", earthGroup.current);

    // Bodies below the site's geometric horizon stay visible but dimmed.
    const sunUp = sunEl >= 0;
    const earthUp = earthEl >= 0;
    if (sunCore.current) sunCore.current.opacity = sunUp ? 1 : 0.6;
    if (sunGlow.current) sunGlow.current.opacity = sunUp ? 1 : 0.25;
    if (earthCore.current) earthCore.current.opacity = earthUp ? 1 : 0.65;
    if (earthAir.current) earthAir.current.opacity = earthUp ? 0.22 : 0.1;
  });

  return (
    <group position={origin}>
      <primitive object={horizon} />
      {cardinals.map((c) => (
        <SkyLabel
          key={c.label}
          text={c.label}
          color={c.label === "N" ? "#ff8a7a" : "#9db7ff"}
          fontSize={12}
          position={c.pos}
        />
      ))}

      {showTrails && trails && <primitive object={trails} />}

      {eph && (
        <>
          {/* Sun: bright disc + soft corona */}
          <group ref={sunGroup} renderOrder={7}>
            <mesh renderOrder={7}>
              <sphereGeometry args={[radius * 0.035, 32, 20]} />
              <meshBasicMaterial ref={sunCore} color="#ffd36b" transparent depthTest={false} />
            </mesh>
            <sprite scale={[radius * 0.2, radius * 0.2, 1]} renderOrder={6}>
              <spriteMaterial
                ref={sunGlow}
                map={glowTexture}
                transparent
                depthTest={false}
                depthWrite={false}
                blending={THREE.AdditiveBlending}
              />
            </sprite>
            <SkyLabel
              text="Sun"
              color={SUN_COLOR}
              fontSize={11}
              position={[0, radius * 0.075, 0]}
            />
          </group>

          {/* Earth: lit globe (day side faces the Sun) + thin atmosphere */}
          <group ref={earthGroup} renderOrder={7}>
            <mesh renderOrder={7}>
              <sphereGeometry args={[radius * 0.03, 32, 20]} />
              <meshStandardMaterial
                ref={earthCore}
                color="#3f86e8"
                emissive="#0a2a5a"
                emissiveIntensity={0.9}
                roughness={0.85}
                metalness={0}
                transparent
                depthTest={false}
              />
            </mesh>
            <mesh renderOrder={7}>
              <sphereGeometry args={[radius * 0.034, 32, 20]} />
              <meshBasicMaterial
                ref={earthAir}
                color="#8cc8ff"
                transparent
                opacity={0.22}
                depthTest={false}
                depthWrite={false}
              />
            </mesh>
            <SkyLabel
              text="Earth"
              color={EARTH_COLOR}
              fontSize={11}
              position={[0, radius * 0.07, 0]}
            />
          </group>
        </>
      )}
    </group>
  );
}