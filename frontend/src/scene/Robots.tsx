import { useMemo, useRef } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { Html, Line } from '@react-three/drei';
import * as THREE from 'three';
import type { SimulationEngine } from '../simulation/core/SimulationEngine';
import type { RobotState } from '../simulation/robots/RobotState';
import { cellToWorld, COLORS, glowTexture, hexTexture, robotRenderPosition, type QualityProfile } from './common';
import { useSim } from '../store/simStore';
import { batteryFillStyle, batteryPct } from '../app/format';

const pos = new THREE.Vector3();

/** 800 rpm in radians per second. */
const ROTOR_SPEED = (800 / 60) * Math.PI * 2;

function batteryColor(r: RobotState): string {
  if (!r.alive) return '#333';
  const f = r.battery / r.maxBattery;
  return f > 0.5 ? '#3dff8a' : f > 0.2 ? '#ffd23f' : '#ff3b4a';
}

/** Shared per-robot motion: interpolated position, smoothed heading, travel distance. */
function useRobotMotion(engine: SimulationEngine, robot: RobotState, group: React.RefObject<THREE.Group>, height: (t: number) => number) {
  const state = useRef({ yaw: robot.heading, travelled: 0, last: new THREE.Vector3(NaN, 0, 0) });
  useFrame(({ clock }, dt) => {
    const g = group.current;
    if (!g) return;
    robotRenderPosition(engine, robot.id, pos);
    const s = state.current;
    if (!Number.isNaN(s.last.x)) s.travelled += pos.distanceTo(s.last);
    s.last.copy(pos);
    g.position.set(pos.x, height(clock.elapsedTime), pos.z);
    // Shortest-arc yaw smoothing towards the robot's latest heading.
    let diff = robot.heading - s.yaw;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    s.yaw += diff * Math.min(1, dt * 8);
    g.rotation.y = s.yaw;
  });
  return state;
}

/** Glowing hexagon under the selected robot, pulsing 1.0 → 1.12 → 1.0 twice a second. */
function SelectionHex({ selected, color, floorOffset = 0 }: { selected: boolean; color: string; floorOffset?: number }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const m = ref.current;
    if (!m) return;
    const s = 1 + 0.06 * (1 - Math.cos(clock.elapsedTime * Math.PI * 4));
    m.scale.set(s, s, s);
    // Drones hover; keep their marker on the floor.
    if (floorOffset && m.parent) m.position.y = -m.parent.position.y + 0.04;
  });
  if (!selected) return null;
  return (
    <mesh ref={ref} rotation-x={-Math.PI / 2} position={[0, 0.04, 0]}>
      <planeGeometry args={[1.7, 1.7]} />
      <meshBasicMaterial map={hexTexture()} color={color} transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
    </mesh>
  );
}

/**
 * Sonar-style sensor sweep: a thick ring expands to the vision radius while a
 * second ring trails at 60% of its size, giving a double pulse.
 */
function ScanSweep({ radius, color, period, y = 0.04 }: { radius: number; color: string; period: number; y?: number }) {
  const lead = useRef<THREE.Mesh>(null);
  const trail = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const t = (clock.elapsedTime % period) / period;
    const s = 0.3 + t * radius;
    const opacity = 0.8 * (1 - t);
    if (lead.current) {
      lead.current.scale.setScalar(s);
      (lead.current.material as THREE.MeshBasicMaterial).opacity = opacity;
    }
    if (trail.current) {
      trail.current.scale.setScalar(s * 0.6);
      (trail.current.material as THREE.MeshBasicMaterial).opacity = opacity * 0.7;
    }
  });
  return (
    <group position={[0, y, 0]} rotation-x={-Math.PI / 2}>
      <mesh ref={lead}>
        <ringGeometry args={[0.6, 1, 48]} />
        <meshBasicMaterial color={color} transparent depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh ref={trail}>
        <ringGeometry args={[0.6, 1, 48]} />
        <meshBasicMaterial color={color} transparent depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  );
}

/** Mac-style tooltip: type icon, name and a slim battery bar. */
function RobotLabel({ robot, manual }: { robot: RobotState; manual: boolean }) {
  const show = useSim((s) => s.overlays.labels);
  if (!show) return null;
  const p = robot.alive ? batteryPct(robot) : 0;
  return (
    <Html position={[0, robot.type === 'drone' ? 0.6 : 1.15, 0]} center zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
      <div className={`robot-tag ${robot.type} ${robot.alive ? '' : 'dead'}`}>
        <span className="tag-icon" aria-hidden />
        {manual && <span className="tag-manual">MANUAL</span>}
        {robot.label}
        <span className="tag-battery" title={`${p}% battery`}>
          <span style={batteryFillStyle(p)} />
        </span>
      </div>
    </Html>
  );
}

/** Soft coloured point light that follows a robot; mounted permanently so light count never changes. */
function GlowLight({ on, color, intensity, y }: { on: boolean; color: string; intensity: number; y: number }) {
  return <pointLight position={[0, y, 0]} color={color} intensity={on ? intensity : 0} distance={2.5} decay={1.5} />;
}

export function Rover({ engine, robot, quality, selected, onSelect }: RobotProps) {
  const group = useRef<THREE.Group>(null);
  const wheels = useRef<Array<THREE.Mesh | null>>([]);
  const lidar = useRef<THREE.Mesh>(null);
  const led = useRef<THREE.MeshBasicMaterial>(null);
  const motion = useRobotMotion(engine, robot, group, () => 0);
  useFrame(({ clock }) => {
    const roll = motion.current.travelled / 0.18;
    for (const w of wheels.current) if (w) w.rotation.x = roll;
    if (lidar.current && robot.alive) lidar.current.rotation.y = clock.elapsedTime * 6;
    if (led.current) {
      led.current.color.set(batteryColor(robot));
      if (robot.alive && robot.battery / robot.maxBattery < 0.2) led.current.color.multiplyScalar(0.5 + 0.5 * Math.abs(Math.sin(clock.elapsedTime * 6)));
    }
  });
  const body = robot.alive ? COLORS.rover : '#555';
  // Chunky body, longest along the direction of travel (+z).
  const bodyGeometry = useMemo(() => new THREE.BoxGeometry(0.55, 0.45, 0.7), []);
  const edges = useMemo(() => new THREE.EdgesGeometry(bodyGeometry), [bodyGeometry]);
  const wheelPositions: Array<[number, number, number]> = [
    [0.33, 0.18, 0.23],
    [-0.33, 0.18, 0.23],
    [0.33, 0.18, -0.23],
    [-0.33, 0.18, -0.23],
  ];
  return (
    <group ref={group} onClick={onSelect}>
      <mesh geometry={bodyGeometry} position={[0, 0.37, 0]} castShadow>
        <meshStandardMaterial color={body} roughness={0.45} metalness={0.2} />
      </mesh>
      {/* Edge highlight fakes a bevel on the low-poly body. */}
      <lineSegments geometry={edges} position={[0, 0.37, 0]}>
        <lineBasicMaterial color={robot.alive ? '#ffd9b0' : '#777'} transparent opacity={0.7} />
      </lineSegments>
      <mesh position={[0, 0.615, -0.04]} castShadow>
        <boxGeometry args={[0.44, 0.05, 0.5]} />
        <meshStandardMaterial color="#2a2d33" roughness={0.6} metalness={0.5} />
      </mesh>
      {/* Bumper */}
      <mesh position={[0, 0.24, 0.37]}>
        <boxGeometry args={[0.58, 0.09, 0.05]} />
        <meshStandardMaterial color="#1c1c1f" metalness={0.7} roughness={0.4} />
      </mesh>
      {wheelPositions.map((p, i) => (
        <mesh key={i} ref={(el) => (wheels.current[i] = el)} position={p} rotation-z={Math.PI / 2} castShadow>
          <cylinderGeometry args={[0.18, 0.18, 0.12, 14]} />
          <meshStandardMaterial color="#2b2b2e" roughness={0.95} />
        </mesh>
      ))}
      {/* Antenna stub */}
      <mesh position={[0.18, 0.79, -0.24]}>
        <cylinderGeometry args={[0.04, 0.04, 0.3, 8]} />
        <meshStandardMaterial color="#b0bec5" metalness={0.8} roughness={0.3} />
      </mesh>
      {/* Sensor mast with spinning lidar head */}
      <mesh position={[0, 0.74, -0.12]}>
        <cylinderGeometry args={[0.025, 0.025, 0.22, 8]} />
        <meshStandardMaterial color="#888" metalness={0.8} roughness={0.3} />
      </mesh>
      <mesh ref={lidar} position={[0, 0.88, -0.12]}>
        <cylinderGeometry args={[0.08, 0.08, 0.07, 16]} />
        <meshStandardMaterial color="#1b1f26" emissive={robot.alive ? COLORS.drone : '#000'} emissiveIntensity={0.8} metalness={0.6} />
      </mesh>
      {/* Headlights */}
      {[-0.15, 0.15].map((x) => (
        <mesh key={x} position={[x, 0.44, 0.355]}>
          <boxGeometry args={[0.09, 0.06, 0.02]} />
          <meshBasicMaterial color={robot.alive ? '#fff6d8' : '#222'} toneMapped={false} />
        </mesh>
      ))}
      {robot.alive && quality.robotSpotlights && <Headlight />}
      {robot.alive && (
        <mesh position={[0, 0.03, 1.0]} rotation-x={-Math.PI / 2}>
          <planeGeometry args={[1.0, 1.6]} />
          <meshBasicMaterial map={glowTexture()} color="#fff1c4" transparent opacity={0.28} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
        </mesh>
      )}
      <mesh position={[-0.17, 0.66, -0.26]}>
        <sphereGeometry args={[0.035, 10, 10]} />
        <meshBasicMaterial ref={led} toneMapped={false} />
      </mesh>
      {/* Dashboard glow */}
      {quality.robotGlow && <GlowLight on={robot.alive} color={COLORS.rover} intensity={0.4} y={0.55} />}
      {robot.alive && <ScanSweep radius={robot.config.visionRadius} color={COLORS.rover} period={1.6} />}
      <SelectionHex selected={selected} color={COLORS.rover} />
      <RobotLabel robot={robot} manual={robot.manual} />
    </group>
  );
}

function Headlight() {
  const light = useRef<THREE.SpotLight>(null);
  const target = useMemo(() => new THREE.Object3D(), []);
  return (
    <>
      <primitive object={target} position={[0, 0, 3]} />
      <spotLight ref={light} position={[0, 0.45, 0.36]} target={target} angle={0.6} penumbra={0.6} intensity={8} distance={7} color="#fff1c4" />
    </>
  );
}

const ARM_ANGLES = [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4];
const ROTOR_DISTANCE = 0.62;

export function Drone({ engine, robot, quality, selected, onSelect }: RobotProps) {
  const group = useRef<THREE.Group>(null);
  const rotors = useRef<Array<THREE.Group | null>>([]);
  const shadow = useRef<THREE.Mesh>(null);
  // ~1 Hz hover bob of ±0.08, phase-shifted per drone so the fleet never bobs in sync.
  const altitude = (t: number) => (robot.alive ? 1.55 + Math.sin(t * Math.PI * 2 + robot.id) * 0.08 : 0.12);
  useRobotMotion(engine, robot, group, altitude);
  const led = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({ clock }, dt) => {
    if (robot.alive) for (const r of rotors.current) if (r) r.rotation.y += dt * ROTOR_SPEED;
    if (shadow.current && group.current) {
      // Ground shadow stays on the floor to give an altitude cue.
      shadow.current.position.y = -group.current.position.y + 0.02;
    }
    if (led.current) led.current.color.set(batteryColor(robot));
    if (group.current && robot.alive) group.current.rotation.z = Math.sin(clock.elapsedTime * 1.3 + robot.id) * 0.04;
  });
  return (
    <group ref={group} onClick={onSelect}>
      {/* Central hub with a dark sensor dome */}
      <mesh castShadow>
        <cylinderGeometry args={[0.25, 0.25, 0.09, 24]} />
        <meshStandardMaterial color={robot.alive ? COLORS.drone : '#555'} roughness={0.35} metalness={0.3} />
      </mesh>
      <mesh position={[0, 0.05, 0]}>
        <sphereGeometry args={[0.13, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#1d2a33" metalness={0.6} roughness={0.2} emissive={COLORS.drone} emissiveIntensity={robot.alive ? 0.35 : 0} />
      </mesh>
      {ARM_ANGLES.map((a, i) => (
        <group key={a} rotation-y={a}>
          {/* Arm from the hub edge out to the motor pod */}
          <mesh position={[0, 0, 0.2 + 0.275]} castShadow>
            <boxGeometry args={[0.12, 0.06, 0.55]} />
            <meshStandardMaterial color="#2b3138" metalness={0.5} roughness={0.5} />
          </mesh>
          <group position={[0, 0.06, ROTOR_DISTANCE]}>
            <mesh position={[0, -0.03, 0]}>
              <cylinderGeometry args={[0.06, 0.06, 0.08, 12]} />
              <meshStandardMaterial color="#1a1d22" metalness={0.6} roughness={0.4} />
            </mesh>
            <group ref={(el) => (rotors.current[i] = el)}>
              {/* Rotor disc: a translucent blur ring plus one visible blade. */}
              <mesh rotation-x={-Math.PI / 2}>
                <ringGeometry args={[0.04, 0.22, 28]} />
                <meshBasicMaterial color="#cfe9ff" transparent opacity={robot.alive ? 0.22 : 0.06} depthWrite={false} side={THREE.DoubleSide} />
              </mesh>
              <mesh>
                <boxGeometry args={[0.42, 0.008, 0.035]} />
                <meshStandardMaterial color="#111" transparent opacity={0.75} />
              </mesh>
            </group>
          </group>
        </group>
      ))}
      <mesh position={[0, -0.05, 0.26]}>
        <sphereGeometry args={[0.03, 8, 8]} />
        <meshBasicMaterial ref={led} toneMapped={false} />
      </mesh>
      {robot.alive && (
        <>
          {/* Searchlight cone */}
          <mesh position={[0, -0.8, 0]}>
            <coneGeometry args={[1.25, 1.55, 24, 1, true]} />
            <meshBasicMaterial color={COLORS.drone} transparent opacity={0.07} depthWrite={false} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} toneMapped={false} />
          </mesh>
          {quality.robotSpotlights && <DroneSpot />}
        </>
      )}
      {quality.robotGlow && <GlowLight on={robot.alive} color={COLORS.drone} intensity={0.3} y={-0.2} />}
      <group>
        <mesh ref={shadow} rotation-x={-Math.PI / 2}>
          <planeGeometry args={[2.6, 2.6]} />
          <meshBasicMaterial map={glowTexture()} color={robot.alive ? '#9fe8ff' : '#000'} transparent opacity={robot.alive ? 0.32 : 0.4} depthWrite={false} blending={robot.alive ? THREE.AdditiveBlending : THREE.NormalBlending} toneMapped={false} />
        </mesh>
      </group>
      {robot.alive && <DroneSweep radius={robot.config.visionRadius} />}
      <SelectionHex selected={selected} color={COLORS.drone} floorOffset={1} />
      <RobotLabel robot={robot} manual={robot.manual} />
    </group>
  );
}

/** Drone sensor pulse rendered on the floor beneath the aircraft. */
function DroneSweep({ radius }: { radius: number }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    const g = ref.current;
    if (g && g.parent) g.position.y = -g.parent.position.y;
  });
  return (
    <group ref={ref}>
      <ScanSweep radius={radius} color={COLORS.drone} period={2.2} y={0.05} />
    </group>
  );
}

function DroneSpot() {
  const target = useMemo(() => new THREE.Object3D(), []);
  return (
    <>
      <primitive object={target} position={[0, -3, 0.2]} />
      <spotLight position={[0, -0.05, 0]} target={target} angle={0.7} penumbra={0.7} intensity={10} distance={6} color="#bfefff" />
    </>
  );
}

interface RobotProps {
  engine: SimulationEngine;
  robot: RobotState;
  quality: QualityProfile;
  selected: boolean;
  onSelect: (e: ThreeEvent<MouseEvent>) => void;
}

export function Robots({ engine, quality }: { engine: SimulationEngine; quality: QualityProfile }) {
  const selected = useSim((s) => s.selected);
  const select = useSim((s) => s.select);
  useSim((s) => s.version);
  return (
    <>
      {engine.robots.map((r) => {
        const Comp = r.type === 'rover' ? Rover : Drone;
        return (
          <Comp
            key={r.name}
            engine={engine}
            robot={r}
            quality={quality}
            selected={selected === r.name}
            onSelect={(e) => {
              e.stopPropagation();
              select(selected === r.name ? null : r.name);
            }}
          />
        );
      })}
    </>
  );
}

/** Planned path of each robot, from its own local A* plan. */
export function RobotPaths({ engine }: { engine: SimulationEngine }) {
  useSim((s) => s.version);
  const selected = useSim((s) => s.selected);
  return (
    <>
      {engine.robots.map((r) => {
        if (!r.alive || r.path.length < 2) return null;
        const pts = r.path.slice(0, 40).map((p) => {
          const w = cellToWorld(engine, p.x, p.y);
          return [w.x, 0.06, w.z] as [number, number, number];
        });
        const color = r.manual ? COLORS.manual : r.type === 'rover' ? COLORS.rover : COLORS.drone;
        const goal = pts[pts.length - 1];
        const emphasis = !selected || selected === r.name;
        return (
          <group key={r.name}>
            <Line points={pts} color={color} lineWidth={emphasis ? 2.2 : 1.2} dashed dashSize={0.35} gapSize={0.2} transparent opacity={emphasis ? 0.85 : 0.35} />
            <mesh position={goal} rotation-x={-Math.PI / 2}>
              <ringGeometry args={[0.22, 0.3, 4]} />
              <meshBasicMaterial color={color} transparent opacity={emphasis ? 0.9 : 0.4} toneMapped={false} />
            </mesh>
          </group>
        );
      })}
    </>
  );
}
