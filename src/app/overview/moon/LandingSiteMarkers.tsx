"use client";

import { useMemo, useRef, useState } from "react";
import { Html } from "@react-three/drei";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import type { PlacedSite } from "../../../lib/types";
import type { HeightSampler } from "../../../lib/terrain";

import { MARKER_COLORS } from "../../../lib/camera";

interface MarkerProps {
  site: PlacedSite;
  y: number;
  selected: boolean;
  showLabel: boolean;
  reduceMotion: boolean;
  onSelect: (id: string) => void;
}

function Marker({
  site,
  y,
  selected,
  showLabel,
  reduceMotion,
  onSelect,
}: MarkerProps) {
  const root = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const [hover, setHover] = useState(false);
  const [isReady, setIsReady] = useState(false);

  const baseColor =
    site.positionKind === "feature_center"
      ? MARKER_COLORS.feature_center
      : MARKER_COLORS.candidate_landing_site;
  const color = selected
    ? MARKER_COLORS.selected
    : hover
      ? "#a5f3fc"
      : baseColor;

  // Keep markers a readable size from orbit-scale down to a few kilometres.
    useFrame(({ camera, clock }) => {
    const g = root.current;
    if (!g) return;
    const d = camera.position.distanceTo(g.position);
    g.scale.setScalar(THREE.MathUtils.clamp(d * 0.014, 0.35, 12));
    
    if (!isReady && d > 0) {
      setIsReady(true);
    }

    if (ring.current && !reduceMotion) {
      const s = 1 + 0.16 * Math.sin(clock.elapsedTime * 3);
      ring.current.scale.set(s, s, 1);
    }
  });

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    onSelect(site.id);
  };
  const handleOver = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setHover(true);
    document.body.style.cursor = "pointer";
  };
  const handleOut = () => {
    setHover(false);
    document.body.style.cursor = "";
  };

  // Determine whether the label should be visible
  const isVisible = showLabel || selected || hover;

  return (
    <group ref={root} position={[site.world.x_km, y, site.world.z_km]}>
      <mesh position={[0, 1.7, 0]}>
        <cylinderGeometry args={[0.07, 0.07, 3.4, 8]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
      <mesh position={[0, 3.6, 0]}>
        <sphereGeometry args={[selected ? 0.95 : 0.75, 24, 24]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>

      {/* Generous invisible hit area so small markers stay easy to click. */}
      <mesh
        position={[0, 2.6, 0]}
        onClick={handleClick}
        onPointerOver={handleOver}
        onPointerOut={handleOut}
      >
        <sphereGeometry args={[2.2, 12, 12]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {selected && (
        <mesh
          ref={ring}
          visible={selected}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0.15, 0]}
        >
          <ringGeometry args={[1.7, 2.1, 48]} />
          <meshBasicMaterial
            color="#ffffff"
            side={THREE.DoubleSide}
            transparent
            opacity={0.9}
            toneMapped={false}
          />
        </mesh>
      )}

      {/* Always render <Html> to prevent synchronous unmount/mount race condition, control visibility via CSS */}
      {isReady && (
        <Html
          position={[0, 5.6, 0]}
          center
          zIndexRange={[20, 0]}
          style={{
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              opacity: isVisible ? 1 : 0,
              visibility: isVisible ? "visible" : "hidden",
              transition: "opacity 0.15s ease-in-out",
              pointerEvents: "none",
            }}
            className={
              "whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium leading-tight backdrop-blur-sm " +
              (selected
                ? "bg-white text-black shadow-lg"
                : "bg-white/90 text-black border border-gray-300")
            }
          >
            {site.name}
          </div>
        </Html>
      )}
    </group>
  );
}

interface LandingSiteMarkersProps {
  sites: PlacedSite[];
  selectedId: string | null;
  sampler: HeightSampler;
  exaggeration: number;
  showLabels: boolean;
  onSelect: (id: string) => void;
}

export default function LandingSiteMarkers({
  sites,
  selectedId,
  sampler,
  exaggeration,
  showLabels,
  onSelect,
}: LandingSiteMarkersProps) {
  const reduceMotion = useMemo(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );

  return (
    <group>
      {sites.map((site) => (
        <Marker
          key={site.id}
          site={site}
          y={sampler(site.world.x_km, site.world.z_km) * exaggeration}
          selected={site.id === selectedId}
          showLabel={showLabels}
          reduceMotion={reduceMotion}
          onSelect={onSelect}
        />
      ))}
    </group>
  );
}
