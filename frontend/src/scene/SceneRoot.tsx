import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Bloom, EffectComposer, SMAA, ToneMapping, Vignette } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import * as THREE from 'three';
import { simClock, TICKS_PER_SECOND, useSim } from '../store/simStore';
import type { SimulationEngine } from '../simulation/core/SimulationEngine';
import { COLORS, QUALITY, cellToWorld, makeSkyTexture, worldToCell, type QualityProfile } from './common';
import { World } from './World';
import { RobotPaths, Robots } from './Robots';
import { CommEvents, CommRanges, MapMergeFlash, NetworkLinks, PacketPulses, PartitionAndReconnect } from './Network';
import { CoverageFog, Dust, EvidenceMarkers, Survivors, TruthDebug } from './Overlays';

/** Fixed-tick simulation driver. Rendering only reads the interpolation alpha. */
function SimDriver() {
  const acc = useRef(0);
  useFrame((_, dt) => {
    const { status, settings, advance } = useSim.getState();
    if (status !== 'running') {
      simClock.alpha = 1;
      acc.current = 0;
      return;
    }
    const interval = 1 / TICKS_PER_SECOND;
    acc.current += Math.min(dt, 0.1) * settings.speed;
    let ticks = 0;
    while (acc.current >= interval && ticks < 8) {
      acc.current -= interval;
      ticks++;
    }
    if (ticks) advance(ticks);
    simClock.alpha = Math.min(1, acc.current / interval);
  });
  return null;
}

function CameraRig({ engine }: { engine: SimulationEngine }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; update: () => void } | null;
  useEffect(() => {
    const { width, height } = engine.scenario;
    // Isometric-style framing: 55° above the floor, rotated 35° around it.
    const distance = Math.max(width, height) * 1.05;
    const elevation = THREE.MathUtils.degToRad(55);
    const azimuth = THREE.MathUtils.degToRad(35);
    camera.position.set(
      distance * Math.cos(elevation) * Math.sin(azimuth),
      distance * Math.sin(elevation),
      distance * Math.cos(elevation) * Math.cos(azimuth),
    );
    camera.lookAt(0, 0, 0);
    if (controls) {
      controls.target.set(0, 0, 0);
      controls.update();
    }
  }, [engine, camera, controls]);

  // Glide the orbit target to a robot on request, keeping a close chase view.
  const focus = useSim((s) => s.focus);
  const glide = useRef<{ target: THREE.Vector3; position: THREE.Vector3; t: number } | null>(null);
  useEffect(() => {
    if (!focus) return;
    const r = engine.robots.find((x) => x.name === focus.robot);
    if (!r) return;
    const target = cellToWorld(engine, r.x, r.y);
    glide.current = { target, position: target.clone().add(new THREE.Vector3(-3, 7, 7)), t: 0 };
  }, [focus, engine]);
  useFrame((_, dt) => {
    const g = glide.current;
    if (!g || !controls) return;
    g.t = Math.min(1, g.t + dt * 1.8);
    const k = Math.min(1, dt * 6);
    controls.target.lerp(g.target, k);
    camera.position.lerp(g.position, k);
    controls.update();
    if (g.t >= 1) glide.current = null;
  });
  return null;
}

function Lighting({ engine, quality }: { engine: SimulationEngine; quality: QualityProfile }) {
  const { width, height } = engine.scenario;
  const span = Math.max(width, height);
  // Warm sun at 45° azimuth and ~50° elevation; it casts the soft shadows.
  const sun = useMemo(() => {
    const az = THREE.MathUtils.degToRad(45);
    const el = THREE.MathUtils.degToRad(50);
    const d = span * 1.2;
    return [d * Math.cos(el) * Math.sin(az), d * Math.sin(el), d * Math.cos(el) * Math.cos(az)] as const;
  }, [span]);
  return (
    <>
      <ambientLight intensity={0.6} color={COLORS.sky} />
      {/* Sky/earth bounce keeps shadowed faces readable without flattening them. */}
      <hemisphereLight args={[COLORS.sky, '#8b6a45', 0.45]} />
      <directionalLight
        position={sun}
        intensity={1.8}
        color={COLORS.sun}
        castShadow={quality.shadows}
        shadow-mapSize-width={quality.shadowMapSize}
        shadow-mapSize-height={quality.shadowMapSize}
        shadow-camera-left={-span / 1.4}
        shadow-camera-right={span / 1.4}
        shadow-camera-top={span / 1.4}
        shadow-camera-bottom={-span / 1.4}
        shadow-camera-far={span * 3}
        shadow-bias={-0.0006}
        shadow-radius={4}
      />
      {/* Warm fire-glow fill from the far side of the collapse */}
      <directionalLight position={[-width * 0.5, 8, -height * 0.5]} intensity={0.35} color="#ff8a4a" />
    </>
  );
}

/**
 * Medium/High only. The renderer skips tone mapping when drawing into the
 * composer's buffers, so ToneMapping runs first; Bloom then sees display-range
 * values and only emissive lights and beams cross its 0.7 threshold.
 */
function PostFx({ smaa }: { smaa: boolean }) {
  const tone = <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />;
  const bloom = <Bloom luminanceThreshold={0.7} luminanceSmoothing={0.15} intensity={0.6} mipmapBlur />;
  const vignette = <Vignette offset={0.5} darkness={0.5} />;
  // EffectComposer only accepts effect elements as children, so branch rather than render `false`.
  return smaa ? (
    <EffectComposer multisampling={0}>
      {tone}
      {bloom}
      {vignette}
      <SMAA />
    </EffectComposer>
  ) : (
    <EffectComposer multisampling={0}>
      {tone}
      {bloom}
      {vignette}
    </EffectComposer>
  );
}

function Scene() {
  const engine = useSim((s) => s.engine);
  const overlays = useSim((s) => s.overlays);
  const selected = useSim((s) => s.selected);
  const qualityName = useSim((s) => s.settings.quality);
  const fog = useSim((s) => s.settings.fog);
  const quality = QUALITY[qualityName];
  const scene = useThree((s) => s.scene);

  // The smoke slider scales atmospheric depth; its 50% default gives density 0.018.
  useEffect(() => {
    scene.fog = new THREE.FogExp2('#1a1f2e', fog * 0.036);
  }, [scene, fog]);
  useEffect(() => {
    const sky = makeSkyTexture();
    scene.background = sky;
    return () => sky.dispose();
  }, [scene]);

  const onFloorClick = (e: ThreeEvent<MouseEvent>) => {
    const { selected: sel, engine: eng, settings, issue, select } = useSim.getState();
    const robot = sel ? eng.robots.find((r) => r.name === sel) : null;
    if (robot && settings.mode !== 'autonomous' && robot.manual) {
      e.stopPropagation();
      const cell = worldToCell(eng, e.point);
      if (eng.scenario.grid.inBounds(cell.x, cell.y)) issue({ kind: 'manualWaypoint', robot: robot.name, target: cell });
      return;
    }
    if (e.delta < 4) select(null);
  };

  return (
    <>
      <SimDriver />
      <CameraRig engine={engine} />
      <Lighting engine={engine} quality={quality} />
      <group key={`${engine.scenario.preset}-${engine.scenario.seed}-${engine.robots.length}`}>
        <World engine={engine} quality={quality} onFloorClick={onFloorClick} />
        <Robots engine={engine} quality={quality} />
        {overlays.paths && <RobotPaths engine={engine} />}
        {overlays.links && <NetworkLinks engine={engine} />}
        {overlays.packets && <PacketPulses engine={engine} arcs={quality.commFx} />}
        {overlays.packets && quality.commFx && <CommEvents engine={engine} />}
        {quality.commFx && <MapMergeFlash engine={engine} />}
        <PartitionAndReconnect engine={engine} />
        {(overlays.ranges || selected) && <CommRanges engine={engine} only={overlays.ranges ? null : selected} />}
        {overlays.evidence && <EvidenceMarkers engine={engine} />}
        <Survivors engine={engine} quality={quality} />
        {overlays.truth && <TruthDebug engine={engine} />}
        {overlays.coverage && <CoverageFog engine={engine} robot={selected} />}
        <Dust engine={engine} count={quality.dust} fog={fog} />
      </group>
      <OrbitControls makeDefault enableDamping dampingFactor={0.08} maxPolarAngle={1.32} minDistance={6} maxDistance={110} />
      {quality.postFx && <PostFx smaa={quality.antialias} />}
    </>
  );
}

export function SceneRoot() {
  const qualityName = useSim((s) => s.settings.quality);
  const quality = QUALITY[qualityName];
  return (
    <Canvas
      key={qualityName}
      shadows={quality.shadows}
      dpr={quality.dpr}
      // With the composer active, SMAA replaces the canvas's own MSAA.
      gl={{ antialias: quality.antialias && !quality.postFx, powerPreference: 'high-performance' }}

      camera={{ fov: 42, near: 0.1, far: 400, position: [0, 40, 30] }}
    >
      <Scene />
    </Canvas>
  );
}
