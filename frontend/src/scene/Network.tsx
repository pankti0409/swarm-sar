import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import type { PacketVisual, SimulationEngine } from '../simulation/core/SimulationEngine';
import type { LinkInfo } from '../simulation/network/PeerNetwork';
import { UNKNOWN } from '../simulation/world/GridMap';
import { COLORS, glowTexture, robotRenderPosition, smoothstep } from './common';
import { simClock, useSim } from '../store/simStore';
import { robotConnection } from '../app/format';

const a = new THREE.Vector3();
const b = new THREE.Vector3();
const ctrl = new THREE.Vector3();
const c = new THREE.Color();
const c2 = new THREE.Color();

/** Height of each robot's antenna tip, where links and arcs attach. */
const antennaHeight = (engine: SimulationEngine, id: number) => (engine.robots[id].type === 'drone' ? 1.6 : 0.95);

const pairKey = (x: string, y: string) => (x < y ? `${x}|${y}` : `${y}|${x}`);

function linkIndex(engine: SimulationEngine): Map<string, LinkInfo> {
  const map = new Map<string, LinkInfo>();
  for (const l of engine.network.links.values()) map.set(pairKey(l.a, l.b), l);
  return map;
}

/** Dash speed in units/s: healthy links flow briskly, weak ones crawl, lost ones stand still. */
const FLOW = { healthy: 1.4, weak: 0.5, down: 0 } as const;

/**
 * Live links as flowing dashed lines: green healthy, amber weak/lossy, red
 * partitioned or just lost. Dashes travel in the direction of the most recent
 * packet on that pair, by sliding each segment's lineDistance values.
 */
export function NetworkLinks({ engine }: { engine: SimulationEngine }) {
  const maxPairs = (engine.robots.length * (engine.robots.length - 1)) / 2;
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(maxPairs * 6), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(maxPairs * 6), 3));
    g.setAttribute('lineDistance', new THREE.BufferAttribute(new Float32Array(maxPairs * 2), 1));
    return g;
  }, [maxPairs]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const lastUp = useRef(new Map<string, number>());
  const direction = useRef(new Map<string, string>());
  const offsets = useRef(new Map<string, number>());
  const seenStep = useRef(-1);
  const index = useMemo(() => new Map(engine.robots.map((r) => [r.name, r.id])), [engine]);

  useFrame(({ clock }, dt) => {
    const positions = geometry.attributes.position.array as Float32Array;
    const colors = geometry.attributes.color.array as Float32Array;
    const distances = geometry.attributes.lineDistance.array as Float32Array;
    const step = engine.step;
    if (step !== seenStep.current) {
      seenStep.current = step;
      // Remember who spoke last on each pair so the dashes flow from sender to receiver.
      for (const p of engine.packets) direction.current.set(pairKey(p.from, p.to), p.from);
    }
    let n = 0;
    for (const [key, link] of engine.network.links) {
      const ia = index.get(link.a);
      const ib = index.get(link.b);
      if (ia === undefined || ib === undefined) continue;
      const ra = engine.robots[ia];
      const rb = engine.robots[ib];
      if (!ra.alive || !rb.alive) continue;
      const current = link.step === step;
      if (current && link.health !== 'down') lastUp.current.set(key, step);
      let col: string | null = null;
      let fade = 1;
      let speed = 0;
      if (current && link.health === 'healthy') {
        col = COLORS.healthy;
        speed = FLOW.healthy;
      } else if (current && link.health === 'weak') {
        col = COLORS.weak;
        speed = FLOW.weak;
      } else if (current && link.reason === 'partition') {
        col = COLORS.down;
        fade = 0.55 + 0.45 * Math.sin(clock.elapsedTime * 6);
      } else {
        const since = step - (lastUp.current.get(key) ?? -999);
        if (since < 12) {
          col = COLORS.down;
          fade = 1 - since / 12;
        }
      }
      if (!col) continue;
      // Orient the segment from the last sender so increasing offset moves dashes towards the receiver.
      const fromA = (direction.current.get(pairKey(link.a, link.b)) ?? link.a) === link.a;
      robotRenderPosition(engine, fromA ? ia : ib, a);
      robotRenderPosition(engine, fromA ? ib : ia, b);
      a.y = antennaHeight(engine, fromA ? ia : ib);
      b.y = antennaHeight(engine, fromA ? ib : ia);
      const offset = (offsets.current.get(key) ?? 0) + dt * speed;
      offsets.current.set(key, offset % 100);
      positions.set([a.x, a.y, a.z, b.x, b.y, b.z], n * 6);
      distances[n * 2] = -offset;
      distances[n * 2 + 1] = a.distanceTo(b) - offset;
      c.set(col).multiplyScalar(fade);
      colors.set([c.r, c.g, c.b, c.r, c.g, c.b], n * 6);
      n++;
    }
    geometry.setDrawRange(0, n * 2);
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.color.needsUpdate = true;
    geometry.attributes.lineDistance.needsUpdate = true;
    geometry.computeBoundingSphere();
  });

  return (
    <>
      <lineSegments geometry={geometry} frustumCulled={false}>
        <lineDashedMaterial vertexColors dashSize={0.28} gapSize={0.16} transparent opacity={0.9} toneMapped={false} depthWrite={false} />
      </lineSegments>
      <AntennaGlows engine={engine} />
    </>
  );
}

const TONE_COLOR = { good: COLORS.healthy, warn: COLORS.weak, bad: COLORS.down, off: '#55606e' } as const;

/** Small glow sprite on each antenna tip, coloured by that robot's connection health. */
function AntennaGlows({ engine }: { engine: SimulationEngine }) {
  useSim((s) => s.version);
  return (
    <>
      {engine.robots.map((r) => (
        <RobotAnchor key={r.name} engine={engine} id={r.id}>
          <sprite position={[0, antennaHeight(engine, r.id), 0]} scale={[0.3, 0.3, 0.3]}>
            <spriteMaterial map={glowTexture()} color={TONE_COLOR[robotConnection(engine, r).tone]} transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
          </sprite>
        </RobotAnchor>
      ))}
    </>
  );
}

const MAX_PACKETS = 160;
const MAX_ARCS = 48;
const ARC_SEGMENTS = 20;
const ARC_SIDES = 6;
const ARC_RADIUS = 0.05;
const ARC_LIFT = 1.5;
const MAX_RIPPLES = 32;
const RIPPLE_TIME = 0.4;

/** Point on a quadratic Bézier, and its tangent. */
function bezier(p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3, u: number, out: THREE.Vector3): THREE.Vector3 {
  const k = 1 - u;
  return out.set(k * k * p0.x + 2 * k * u * p1.x + u * u * p2.x, k * k * p0.y + 2 * k * u * p1.y + u * u * p2.y, k * k * p0.z + 2 * k * u * p1.z + u * u * p2.z);
}
function bezierTangent(p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3, u: number, out: THREE.Vector3): THREE.Vector3 {
  const k = 1 - u;
  return out.set(2 * k * (p1.x - p0.x) + 2 * u * (p2.x - p1.x), 2 * k * (p1.y - p0.y) + 2 * u * (p2.y - p1.y), 2 * k * (p1.z - p0.z) + 2 * u * (p2.z - p1.z)).normalize();
}

/**
 * One merged tube mesh for every in-flight arc. Rebuilding THREE.TubeGeometry
 * per packet per frame would churn memory, so ring vertices are written into a
 * preallocated buffer instead (same tube, built by hand).
 */
function useArcBuffer() {
  return useMemo(() => {
    const ringVerts = (ARC_SEGMENTS + 1) * ARC_SIDES;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_ARCS * ringVerts * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(MAX_ARCS * ringVerts * 3), 3));
    const idx: number[] = [];
    for (let arc = 0; arc < MAX_ARCS; arc++) {
      const base = arc * ringVerts;
      for (let s = 0; s < ARC_SEGMENTS; s++)
        for (let k = 0; k < ARC_SIDES; k++) {
          const i0 = base + s * ARC_SIDES + k;
          const i1 = base + s * ARC_SIDES + ((k + 1) % ARC_SIDES);
          const i2 = i0 + ARC_SIDES;
          const i3 = i1 + ARC_SIDES;
          idx.push(i0, i2, i1, i1, i2, i3);
        }
    }
    g.setIndex(idx);
    return { geometry: g, ringVerts, indicesPerArc: ARC_SEGMENTS * ARC_SIDES * 6 };
  }, []);
}

const up = new THREE.Vector3(0, 1, 0);
const pt = new THREE.Vector3();
const tan = new THREE.Vector3();
const side = new THREE.Vector3();
const normal = new THREE.Vector3();

interface Ripple {
  x: number;
  z: number;
  born: number;
  color: string;
}

/**
 * Packets in transit. On Low they are small beads on a shallow hop. On
 * Medium/High (`arcs`) each becomes a glowing ballistic arc with a bright bead
 * riding it; the arc is brightest mid-flight and fades at both ends. Lost
 * packets stall and fade out red; delivered ones end in a ripple at the
 * receiver's feet.
 */
export function PacketPulses({ engine, arcs }: { engine: SimulationEngine; arcs: boolean }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const rippleMesh = useRef<THREE.InstancedMesh>(null);
  const active = useRef<PacketVisual[]>([]);
  const arrived = useRef(new Set<number>());
  const ripples = useRef<Ripple[]>([]);
  const seenStep = useRef(-1);
  const links = useRef(new Map<string, LinkInfo>());
  const index = useMemo(() => new Map(engine.robots.map((r) => [r.name, r.id])), [engine]);
  const tmp = useMemo(() => new THREE.Object3D(), []);
  const arcBuffer = useArcBuffer();
  useEffect(() => () => arcBuffer.geometry.dispose(), [arcBuffer]);

  useFrame(({ clock }) => {
    const m = mesh.current;
    if (!m) return;
    if (engine.step !== seenStep.current) {
      seenStep.current = engine.step;
      links.current = linkIndex(engine);
      // Keep loss/partition packets and anything carrying map data or evidence;
      // skip pure heartbeats when the team is large to avoid visual noise.
      const fresh = engine.packets.filter((p) => p.outcome !== 'in-flight' || p.mapCells > 0 || engine.robots.length <= 4);
      active.current = [...active.current, ...fresh].slice(-MAX_PACKETS);
    }
    const now = engine.step - 1 + simClock.alpha;
    const positions = arcBuffer.geometry.attributes.position.array as Float32Array;
    const colors = arcBuffer.geometry.attributes.color.array as Float32Array;
    let n = 0;
    let arcCount = 0;
    const keep: PacketVisual[] = [];
    for (const p of active.current) {
      const duration = Math.max(1, p.arriveStep - p.sentStep);
      const t = (now - (p.sentStep - 1)) / duration;
      const lost = p.outcome === 'lost' || p.outcome === 'partition' || p.outcome === 'stale';
      const end = lost ? (p.outcome === 'partition' ? 0.45 : 0.75) : 1;
      if (t > end + 0.15) {
        arrived.current.delete(p.id);
        continue;
      }
      keep.push(p);
      const ia = index.get(p.from);
      const ib = index.get(p.to);
      if (ia === undefined || ib === undefined) continue;
      robotRenderPosition(engine, ia, a);
      robotRenderPosition(engine, ib, b);
      a.y = antennaHeight(engine, ia);
      b.y = antennaHeight(engine, ib);
      const travel = lost ? Math.min(t, end * (p.outcome === 'partition' ? 0.5 : 0.6)) : smoothstep(t);
      const u = Math.max(0, Math.min(1, travel));
      const fade = lost ? Math.max(0, 1 - Math.max(0, t - end * 0.6) / (end * 0.4 + 0.15)) : 1;
      const health = links.current.get(pairKey(p.from, p.to))?.health;
      const base = lost ? COLORS.down : health === 'weak' ? COLORS.weak : p.mapCells > 0 || health === 'healthy' ? COLORS.healthy : '#bff7ff';

      if (arcs) {
        ctrl.addVectors(a, b).multiplyScalar(0.5);
        ctrl.y += ARC_LIFT;
        bezier(a, ctrl, b, u, tmp.position);
        if (arcCount < MAX_ARCS && t >= 0) {
          // Envelope: bright mid-flight, fading at both ends, plus a hot spot riding with the bead.
          const envelope = Math.sin(Math.PI * u) * fade;
          const offset = arcCount * arcBuffer.ringVerts * 3;
          for (let s = 0; s <= ARC_SEGMENTS; s++) {
            const v = s / ARC_SEGMENTS;
            bezier(a, ctrl, b, v, pt);
            bezierTangent(a, ctrl, b, v, tan);
            side.crossVectors(tan, up);
            if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
            side.normalize();
            normal.crossVectors(side, tan).normalize();
            const glow = envelope * (0.35 + 1.4 * Math.exp(-(((v - u) / 0.1) ** 2)));
            c.set(base).multiplyScalar(glow);
            for (let k = 0; k < ARC_SIDES; k++) {
              const theta = (k / ARC_SIDES) * Math.PI * 2;
              const cos = Math.cos(theta) * ARC_RADIUS;
              const sin = Math.sin(theta) * ARC_RADIUS;
              const o = offset + (s * ARC_SIDES + k) * 3;
              positions[o] = pt.x + normal.x * cos + side.x * sin;
              positions[o + 1] = pt.y + normal.y * cos + side.y * sin;
              positions[o + 2] = pt.z + normal.z * cos + side.z * sin;
              colors[o] = c.r;
              colors[o + 1] = c.g;
              colors[o + 2] = c.b;
            }
          }
          arcCount++;
        }
      } else {
        tmp.position.lerpVectors(a, b, u);
        tmp.position.y += Math.sin(u * Math.PI) * 0.35;
      }

      // Reception: the first frame a delivered packet reaches its receiver.
      if (!lost && p.outcome !== 'duplicate' && t >= 1 && !arrived.current.has(p.id)) {
        arrived.current.add(p.id);
        if (arcs) ripples.current.push({ x: b.x, z: b.z, born: clock.elapsedTime, color: engine.robots[ia].type === 'rover' ? COLORS.rover : COLORS.drone });
      }

      const size = arcs ? 0.1 : (p.mapCells > 0 ? 0.07 : 0.045) * (lost ? 0.6 + fade * 0.8 : 1);
      tmp.scale.setScalar(Math.max(0.001, size * (t < 0 ? 0 : 1) * (arcs && lost ? 0.4 + fade * 0.6 : 1)));
      tmp.updateMatrix();
      m.setMatrixAt(n, tmp.matrix);
      c.set(lost ? COLORS.down : arcs ? '#ffffff' : base).multiplyScalar(lost ? fade * 1.5 : 1.6);
      if (arcs && !lost) c.lerp(c2.set(base).multiplyScalar(1.6), 0.35);

      m.setColorAt(n, c);
      n++;
    }
    active.current = keep;
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;

    arcBuffer.geometry.setDrawRange(0, arcCount * arcBuffer.indicesPerArc);
    arcBuffer.geometry.attributes.position.needsUpdate = true;
    arcBuffer.geometry.attributes.color.needsUpdate = true;

    // Reception ripples: scale 0 → 2 and fade out over RIPPLE_TIME seconds.
    const r = rippleMesh.current;
    if (r) {
      ripples.current = ripples.current.filter((x) => clock.elapsedTime - x.born < RIPPLE_TIME).slice(-MAX_RIPPLES);
      ripples.current.forEach((x, i) => {
        const k = (clock.elapsedTime - x.born) / RIPPLE_TIME;
        tmp.position.set(x.x, 0.09, x.z);
        tmp.rotation.set(-Math.PI / 2, 0, 0);
        tmp.scale.setScalar(Math.max(0.001, k * 2));
        tmp.updateMatrix();
        r.setMatrixAt(i, tmp.matrix);
        r.setColorAt(i, c.set(x.color).multiplyScalar(1.4 * (1 - k)));
      });
      tmp.rotation.set(0, 0, 0);
      r.count = ripples.current.length;
      r.instanceMatrix.needsUpdate = true;
      if (r.instanceColor) r.instanceColor.needsUpdate = true;
    }
  });

  return (
    <>
      <instancedMesh ref={mesh} args={[undefined, undefined, MAX_PACKETS]} frustumCulled={false}>
        <sphereGeometry args={[1, 12, 10]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      {arcs && (
        <>
          {/* Additive blending: dark vertices vanish, so colour alone carries the fade. */}
          <mesh geometry={arcBuffer.geometry} frustumCulled={false}>
            <meshBasicMaterial vertexColors transparent blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} side={THREE.DoubleSide} />
          </mesh>
          <instancedMesh ref={rippleMesh} args={[undefined, undefined, MAX_RIPPLES]} frustumCulled={false}>
            <ringGeometry args={[0.85, 1, 40]} />
            <meshBasicMaterial transparent blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
          </instancedMesh>
        </>
      )}
    </>
  );
}

/** Five-point star outline used for the discovery flash. */
function makeStarGeometry(): THREE.ShapeGeometry {
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 0.18 : 0.5;
    const ang = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const x = Math.cos(ang) * r;
    const y = Math.sin(ang) * r;
    if (i) shape.lineTo(x, y);
    else shape.moveTo(x, y);
  }
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
}

interface Flash {
  id: string;
  robotId: number;
  text: string;
  born: number;
}

/** A sender only flashes "map update" this often (real seconds), so busy swarms stay readable. */
const MAP_FLASH_COOLDOWN = 4;
const FLASH_LIFETIME = 1.2;

/**
 * Discovery flash on the sender: a gold starburst plus a floating toast when a
 * robot broadcasts new map cells or starts investigating heat/sound evidence.
 */
export function CommEvents({ engine }: { engine: SimulationEngine }) {
  const version = useSim((s) => s.version);
  const [flashes, setFlashes] = useState<Flash[]>([]);
  const lastMapFlash = useRef(new Map<string, number>());
  const seenStep = useRef(-1);
  const star = useMemo(() => makeStarGeometry(), []);
  useEffect(() => () => star.dispose(), [star]);

  useEffect(() => {
    if (engine.step === seenStep.current) return;
    seenStep.current = engine.step;
    const now = performance.now() / 1000;
    const next: Flash[] = [];
    for (let i = engine.rawEvents.length - 1; i >= 0 && engine.rawEvents[i].step === engine.step; i--) {
      const e = engine.rawEvents[i];
      if (e.event.type !== 'investigate') continue;
      const ev = e.event;
      const robot = engine.robots.find((r) => r.name === ev.robot);
      if (robot) next.push({ id: `inv-${robot.name}-${e.step}`, robotId: robot.id, text: ev.thermal >= 0.32 ? '🔍 Found heat sig!' : '🔍 Faint survivor sounds', born: now });
    }
    for (const p of engine.packets) {
      if (p.mapCells <= 0) continue;
      if (now - (lastMapFlash.current.get(p.from) ?? -Infinity) < MAP_FLASH_COOLDOWN) continue;
      const robot = engine.robots.find((r) => r.name === p.from);
      if (!robot || next.some((f) => f.robotId === robot.id)) continue;
      lastMapFlash.current.set(p.from, now);
      next.push({ id: `map-${robot.name}-${engine.step}`, robotId: robot.id, text: '🗺 Map update', born: now });
    }
    setFlashes((prev) => [...prev.filter((f) => now - f.born < FLASH_LIFETIME), ...next]);
  }, [engine, version]);

  return (
    <>
      {flashes.map((f) => (
        <RobotAnchor key={f.id} engine={engine} id={f.robotId}>
          <Starburst geometry={star} y={antennaHeight(engine, f.robotId) + 0.3} />
          <Html position={[0, antennaHeight(engine, f.robotId) + 0.9, 0]} center zIndexRange={[25, 0]} style={{ pointerEvents: 'none' }}>
            <div className="comm-toast">{f.text}</div>
          </Html>
        </RobotAnchor>
      ))}
    </>
  );
}

/** Camera-facing gold star that grows and fades over 0.6 s. */
function Starburst({ geometry, y }: { geometry: THREE.ShapeGeometry; y: number }) {
  const ref = useRef<THREE.Mesh>(null);
  const born = useRef<number | null>(null);
  useFrame(({ clock, camera }) => {
    const m = ref.current;
    if (!m) return;
    if (born.current === null) born.current = clock.elapsedTime;
    const k = Math.min(1, (clock.elapsedTime - born.current) / 0.6);
    m.quaternion.copy(camera.quaternion);
    m.rotateZ(k * 1.2);
    m.scale.setScalar(0.6 + k * 1.4);
    (m.material as THREE.MeshBasicMaterial).opacity = 1 - k;
    m.visible = k < 1;
  });
  return (
    <mesh ref={ref} geometry={geometry} position={[0, y, 0]}>
      <meshBasicMaterial color={COLORS.discovery} transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} side={THREE.DoubleSide} />
    </mesh>
  );
}

const MERGE_FLASH_TIME = 0.8;

/**
 * Briefly lights up floor cells a robot just learned from a teammate's map.
 * Each tick it diffs every robot's private belief against the previous tick;
 * newly known cells beyond the robot's own vision radius can only have come
 * from a delivered peer message, so those flash teal for 0.8 s.
 */
export function MapMergeFlash({ engine }: { engine: SimulationEngine }) {
  const { width, height } = engine.scenario;
  const texture = useMemo(() => {
    const t = new THREE.DataTexture(new Uint8Array(width * height * 4), width, height, THREE.RGBAFormat);
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    return t;
  }, [width, height]);
  useEffect(() => () => texture.dispose(), [texture]);
  const flashAt = useMemo(() => new Float32Array(width * height).fill(-Infinity), [width, height]);
  const prevKnown = useRef(new Map<string, Uint8Array>());
  const seenStep = useRef(-1);
  const anyActive = useRef(false);

  useFrame(({ clock }) => {
    const now = clock.elapsedTime;
    if (engine.step !== seenStep.current) {
      seenStep.current = engine.step;
      for (const r of engine.robots) {
        const cells = r.belief.cells;
        let prev = prevKnown.current.get(r.name);
        const first = !prev;
        if (!prev) {
          prev = new Uint8Array(cells.length);
          prevKnown.current.set(r.name, prev);
        }
        const reach = r.config.visionRadius + 1;
        for (let i = 0; i < cells.length; i++) {
          const known = cells[i] !== UNKNOWN ? 1 : 0;
          if (known && !prev[i] && !first) {
            const x = i % width;
            const y = (i - x) / width;
            if (Math.hypot(x - r.x, y - r.y) > reach) {
              flashAt[i] = now;
              anyActive.current = true;
            }
          }
          prev[i] = known;
        }
      }
    }
    if (!anyActive.current) return;
    // Rows map to world +z; the plane is rotated so v runs along -z.
    const data = texture.image.data as Uint8Array;
    let active = false;
    for (let i = 0; i < flashAt.length; i++) {
      const k = (now - flashAt[i]) / MERGE_FLASH_TIME;
      const x = i % width;
      const y = (i - x) / width;
      const o = ((height - 1 - y) * width + x) * 4;
      const alpha = k >= 0 && k < 1 ? 1 - k : 0;
      if (alpha > 0) active = true;
      data[o] = 0x80;
      data[o + 1] = 0xde;
      data[o + 2] = 0xea;
      data[o + 3] = Math.round(alpha * 200);
    }
    texture.needsUpdate = true;
    anyActive.current = active;
  });

  return (
    <mesh rotation-x={-Math.PI / 2} position={[0, 0.03, 0]} renderOrder={4}>
      <planeGeometry args={[width, height]} />
      <meshBasicMaterial map={texture} transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
    </mesh>
  );
}

/** Red ring around partitioned robots; green burst on reconnection. */
export function PartitionAndReconnect({ engine }: { engine: SimulationEngine }) {
  useSim((s) => s.version);
  const isolated = engine.network.isolatedAgents(engine.step);
  const bursts = engine.rawEvents.filter((e) => (e.event.type === 'rejoined' || e.event.type === 'partition_off') && engine.step - e.step <= 8);
  return (
    <>
      {engine.robots.map((r) => {
        const partitioned = isolated.has(r.name) && r.alive;
        const burst = bursts.find((e) =>
          e.event.type === 'rejoined' ? e.event.robot === r.name : e.event.type === 'partition_off' && e.event.robots.includes(r.name),
        );
        if (!partitioned && !burst) return null;
        return (
          <RobotAnchor key={r.name} engine={engine} id={r.id}>
            {partitioned && <PartitionRing />}
            {burst && <ReconnectBurst key={burst.step} />}
          </RobotAnchor>
        );
      })}
    </>
  );
}

export function RobotAnchor({ engine, id, children }: { engine: SimulationEngine; id: number; children: React.ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    if (ref.current) robotRenderPosition(engine, id, ref.current.position);
  });
  return <group ref={ref}>{children}</group>;
}

function PartitionRing() {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const m = ref.current;
    if (!m) return;
    const s = 1 + 0.12 * Math.sin(clock.elapsedTime * 5);
    m.scale.set(s, s, s);
    (m.material as THREE.MeshBasicMaterial).opacity = 0.55 + 0.35 * Math.sin(clock.elapsedTime * 5);
  });
  return (
    <group>
      <mesh ref={ref} rotation-x={-Math.PI / 2} position={[0, 0.08, 0]}>
        <ringGeometry args={[0.85, 1.0, 48]} />
        <meshBasicMaterial color={COLORS.down} transparent toneMapped={false} depthWrite={false} />
      </mesh>
      <mesh position={[0, 2.3, 0]}>
        <octahedronGeometry args={[0.14, 0]} />
        <meshBasicMaterial color={COLORS.down} toneMapped={false} />
      </mesh>
    </group>
  );
}

function ReconnectBurst() {
  const ref = useRef<THREE.Mesh>(null);
  const start = useRef<number | null>(null);
  useFrame(({ clock }) => {
    const m = ref.current;
    if (!m) return;
    if (start.current === null) start.current = clock.elapsedTime;
    const t = Math.min(1, (clock.elapsedTime - start.current) / 1.4);
    const s = 0.6 + t * 4;
    m.scale.set(s, s, s);
    (m.material as THREE.MeshBasicMaterial).opacity = 1 - t;
  });
  return (
    <mesh ref={ref} rotation-x={-Math.PI / 2} position={[0, 0.1, 0]}>
      <ringGeometry args={[0.9, 1.0, 48]} />
      <meshBasicMaterial color={COLORS.healthy} transparent toneMapped={false} depthWrite={false} />
    </mesh>
  );
}

/** Radio range discs (min of own and peer radius applies per link). */
export function CommRanges({ engine, only }: { engine: SimulationEngine; only: string | null }) {
  useSim((s) => s.version);
  return (
    <>
      {engine.robots
        .filter((r) => r.alive && (!only || r.name === only))
        .map((r) => (
          <RobotAnchor key={r.name} engine={engine} id={r.id}>
            <mesh rotation-x={-Math.PI / 2} position={[0, 0.025, 0]}>
              <ringGeometry args={[r.config.commRadius - 0.06, r.config.commRadius, 96]} />
              <meshBasicMaterial color={r.type === 'rover' ? COLORS.rover : COLORS.drone} transparent opacity={0.45} toneMapped={false} depthWrite={false} />
            </mesh>
            <mesh rotation-x={-Math.PI / 2} position={[0, 0.02, 0]}>
              <circleGeometry args={[r.config.commRadius, 96]} />
              <meshBasicMaterial color={r.type === 'rover' ? COLORS.rover : COLORS.drone} transparent opacity={0.035} toneMapped={false} depthWrite={false} />
            </mesh>
          </RobotAnchor>
        ))}
    </>
  );
}
