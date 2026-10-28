import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import type { SimulationEngine } from '../simulation/core/SimulationEngine';
import { evidencePosition, maxThermal } from '../simulation/sensing/SensorModel';
import { UNKNOWN } from '../simulation/world/GridMap';
import { cellToWorld, COLORS, glowTexture, makeScanlineTexture, type QualityProfile } from './common';
import { RobotAnchor } from './Network';
import { useSim } from '../store/simStore';

/**
 * Darkens space no robot has sensed yet. With a robot selected it shows that
 * robot's private belief instead, so the operator sees what *it* knows.
 */
export function CoverageFog({ engine, robot }: { engine: SimulationEngine; robot: string | null }) {
  const version = useSim((s) => s.version);
  const { width, height } = engine.scenario;
  const texture = useMemo(() => {
    const t = new THREE.DataTexture(new Uint8Array(width * height * 4), width, height, THREE.RGBAFormat);
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearFilter;
    t.flipY = false;
    return t;
  }, [width, height]);
  useEffect(() => () => texture.dispose(), [texture]);
  // Faint scanlines (two per cell) multiplied into the fog's alpha for a "sensor mode" feel.
  const scanlines = useMemo(() => {
    const t = makeScanlineTexture();
    t.repeat.set(1, height * 2);
    return t;
  }, [height]);
  useEffect(() => () => scanlines.dispose(), [scanlines]);

  useEffect(() => {
    const data = texture.image.data as Uint8Array;
    const only = robot ? engine.robots.find((r) => r.name === robot) : null;
    const sources = only ? [only] : engine.robots;
    for (let i = 0; i < width * height; i++) {
      let known = false;
      for (const r of sources)
        if (r.belief.cells[i] !== UNKNOWN) {
          known = true;
          break;
        }
      // Rows map to world +z; the plane is rotated so v runs along -z.
      const x = i % width;
      const y = Math.floor(i / width);
      const o = ((height - 1 - y) * width + x) * 4;
      data[o] = only ? 6 : 3;
      data[o + 1] = only ? 10 : 5;
      data[o + 2] = only ? 26 : 10;
      // Strong enough to dim the bright sand tiles so explored ground clearly stands out.
      data[o + 3] = known ? 0 : only ? 215 : 185;
    }
    texture.needsUpdate = true;
  }, [engine, robot, texture, version, width, height]);

  return (
    <mesh rotation-x={-Math.PI / 2} position={[0, 2.85, 0]} renderOrder={5}>
      <planeGeometry args={[width, height]} />
      <meshBasicMaterial map={texture} alphaMap={scanlines} transparent depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

/**
 * SOS beacon for a confirmed survivor: a thin pulsing light beam that grows
 * out of the floor, topped with a spinning star-of-life cross.
 */
function SurvivorBeacon({ position, quality, index }: { position: THREE.Vector3; quality: QualityProfile; index: number }) {
  const beam = useRef<THREE.Mesh>(null);
  const cross = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const born = useRef<number | null>(null);
  useFrame(({ clock }) => {
    if (born.current === null) born.current = clock.elapsedTime;
    const age = clock.elapsedTime - born.current;
    const t = clock.elapsedTime + index;
    const grow = Math.min(1, age / 0.8);
    if (beam.current) {
      beam.current.scale.set(1, grow, 1);
      beam.current.position.y = 2 * grow;
      (beam.current.material as THREE.MeshBasicMaterial).opacity = 0.65 + 0.35 * Math.sin(t * 4);
    }
    if (cross.current) {
      cross.current.position.y = 4 * grow + 0.35;
      cross.current.rotation.y = clock.elapsedTime * 1.8;
      cross.current.scale.setScalar(grow * (1 + 0.08 * Math.sin(t * 4)));
    }
    if (ring.current) {
      const p = (t % 1.6) / 1.6;
      ring.current.scale.setScalar(0.4 + p * 2.2);
      (ring.current.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - p);
    }
  });
  return (
    <group position={position}>
      {/* Casualty lying on the floor */}
      <mesh position={[0, 0.16, 0]} rotation-z={Math.PI / 2} rotation-y={index * 1.3} castShadow>
        <capsuleGeometry args={[0.13, 0.5, 4, 8]} />
        <meshStandardMaterial color="#c9a27e" roughness={0.8} emissive="#ff6a2b" emissiveIntensity={0.25} />
      </mesh>
      <mesh ref={beam}>
        <cylinderGeometry args={[0.05, 0.05, 4, 10]} />
        <meshBasicMaterial color={COLORS.survivor} transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>
      <group ref={cross}>
        <mesh>
          <boxGeometry args={[0.6, 0.18, 0.06]} />
          <meshBasicMaterial color={COLORS.survivor} toneMapped={false} />
        </mesh>
        <mesh>
          <boxGeometry args={[0.18, 0.6, 0.06]} />
          <meshBasicMaterial color={COLORS.survivor} toneMapped={false} />
        </mesh>
      </group>

      <mesh ref={ring} rotation-x={-Math.PI / 2} position={[0, 0.05, 0]}>
        <ringGeometry args={[0.85, 1, 40]} />
        <meshBasicMaterial color={COLORS.survivor} transparent depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.03, 0]}>
        <planeGeometry args={[2.4, 2.4]} />
        <meshBasicMaterial map={glowTexture()} color={COLORS.survivor} transparent opacity={0.5} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>
      {quality.emergencyLights > 2 && <pointLight position={[0, 1.2, 0]} color={COLORS.survivor} intensity={3} distance={5} />}
      <Html position={[0, 1.4, 0]} center style={{ pointerEvents: 'none' }} zIndexRange={[15, 0]}>
        <div className="survivor-tag">SURVIVOR</div>
      </Html>
    </group>
  );
}

/** Only survivors already confirmed by a robot are rendered. */
export function Survivors({ engine, quality }: { engine: SimulationEngine; quality: QualityProfile }) {
  useSim((s) => s.version);
  return (
    <>
      {engine.discoveredSurvivors().map((v) => (
        <SurvivorBeacon key={v.id} index={v.id} quality={quality} position={cellToWorld(engine, v.x, v.y)} />
      ))}
    </>
  );
}

/** DEBUG ONLY: ground-truth survivor positions, never shown in the normal operator view. */
export function TruthDebug({ engine }: { engine: SimulationEngine }) {
  useSim((s) => s.version);
  return (
    <>
      {engine.scenario.victims
        .filter((v) => !v.found)
        .map((v) => {
          const p = cellToWorld(engine, v.x, v.y);
          return (
            <group key={v.id} position={p}>
              <mesh position={[0, 0.25, 0]}>
                <sphereGeometry args={[0.25, 12, 10]} />
                <meshBasicMaterial color="#ff2bd6" transparent opacity={0.65} toneMapped={false} />
              </mesh>
              <mesh position={[0, 1.6, 0]}>
                <cylinderGeometry args={[0.02, 0.02, 3, 6]} />
                <meshBasicMaterial color="#ff2bd6" toneMapped={false} />
              </mesh>
              <Html position={[0, 3.2, 0]} center style={{ pointerEvents: 'none' }}>
                <div className="debug-tag">DEBUG · truth</div>
              </Html>
            </group>
          );
        })}
    </>
  );
}

/**
 * Sensor evidence derived from each robot's *own* readings: heat-source
 * estimates (from odometry + strongest sector) and acoustic pings.
 */
export function EvidenceMarkers({ engine }: { engine: SimulationEngine }) {
  useSim((s) => s.version);
  return (
    <>
      {engine.robots.map((r) => {
        if (!r.alive) return null;
        const thermal = maxThermal(r.thermal);
        const est = thermal >= 0.16 ? evidencePosition(r) : null;
        const sound = r.acoustic >= 0.2;
        return (
          <group key={r.name}>
            {est && <HeatMarker position={cellToWorld(engine, est.x, est.y)} strength={thermal} />}
            {sound && (
              <RobotAnchor engine={engine} id={r.id}>
                <SoundPing strength={r.acoustic} />
              </RobotAnchor>
            )}
          </group>
        );
      })}
    </>
  );
}

function HeatMarker({ position, strength }: { position: THREE.Vector3; strength: number }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (ref.current) ref.current.scale.setScalar(1 + 0.15 * Math.sin(clock.elapsedTime * 7));
  });
  const size = 1.2 + Math.min(1, strength) * 2.2;
  return (
    <mesh ref={ref} position={[position.x, 0.06, position.z]} rotation-x={-Math.PI / 2}>
      <planeGeometry args={[size, size]} />
      <meshBasicMaterial map={glowTexture()} color={COLORS.heat} transparent opacity={0.4 + Math.min(0.5, strength)} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
    </mesh>
  );
}

function SoundPing({ strength }: { strength: number }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const m = ref.current;
    if (!m) return;
    const p = (clock.elapsedTime % 1.1) / 1.1;
    m.scale.setScalar(0.5 + p * (2 + strength * 3));
    (m.material as THREE.MeshBasicMaterial).opacity = 0.7 * (1 - p);
  });
  return (
    <mesh ref={ref} rotation-x={-Math.PI / 2} position={[0, 0.07, 0]}>
      <ringGeometry args={[0.9, 1, 40]} />
      <meshBasicMaterial color={COLORS.sound} transparent depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

/** Floating dust/smoke particles. */
export function Dust({ engine, count, fog }: { engine: SimulationEngine; count: number; fog: number }) {
  const ref = useRef<THREE.Points>(null);
  const { width, height } = engine.scenario;
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const p = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      p[i * 3] = (Math.random() - 0.5) * width;
      p[i * 3 + 1] = Math.random() * 3;
      p[i * 3 + 2] = (Math.random() - 0.5) * height;
    }
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    return g;
  }, [count, width, height]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useFrame((_, dt) => {
    const arr = geometry.attributes.position.array as Float32Array;
    for (let i = 0; i < count; i++) {
      arr[i * 3] += Math.sin(i + arr[i * 3 + 1]) * dt * 0.05;
      arr[i * 3 + 1] += dt * (0.03 + (i % 7) * 0.006);
      if (arr[i * 3 + 1] > 3) arr[i * 3 + 1] = 0;
    }
    geometry.attributes.position.needsUpdate = true;
  });
  return (
    <points ref={ref} geometry={geometry} frustumCulled={false}>
      <pointsMaterial map={glowTexture()} size={0.12} sizeAttenuation color="#d8c9b0" transparent opacity={0.25 + fog * 0.35} depthWrite={false} toneMapped={false} />
    </points>
  );
}
