import { useEffect, useMemo, useRef } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { SimulationEngine } from '../simulation/core/SimulationEngine';
import { FREE, Material, RUBBLE, WALL } from '../simulation/world/GridMap';
import { Rng } from '../simulation/core/Rng';
import { cellToWorld, glowTexture, makeFloorTexture, makeHazardTexture, type QualityProfile } from './common';

const tmp = new THREE.Object3D();
const color = new THREE.Color();

function wallStyle(material: number, rng: Rng): { color: string; jitter: number } {
  switch (material) {
    case Material.Rock:
      return { color: rng.pick(['#4a3d33', '#3f342c', '#55483b', '#3a312b']), jitter: 0.18 };
    case Material.BrokenWall:
      return { color: rng.pick(['#7b7570', '#6c6661', '#85807a']), jitter: 0.12 };
    case Material.Collapsed:
      return { color: rng.pick(['#5e5a55', '#6d665e']), jitter: 0.3 };
    case Material.Desk:
      return { color: rng.pick(['#5a4330', '#6b4f36']), jitter: 0.05 };
    case Material.Crate:
      return { color: rng.pick(['#7a5a2e', '#6d5128']), jitter: 0.08 };
    case Material.Shelf:
      return { color: '#4b5560', jitter: 0.03 };
    case Material.Pillar:
      return { color: '#77726c', jitter: 0.05 };
    default:
      return { color: rng.pick(['#8d8882', '#98928b', '#87827c', '#a29b92']), jitter: 0.02 };
  }
}

function Walls({ engine }: { engine: SimulationEngine }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const { grid, material, wallHeight } = engine.scenario;
  const cells = useMemo(() => {
    const list: number[] = [];
    for (let i = 0; i < grid.cells.length; i++) if (grid.cells[i] === WALL) list.push(i);
    return list;
  }, [grid]);

  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const rng = new Rng(engine.scenario.seed ^ 0x51ab);
    const p = new THREE.Vector3();
    cells.forEach((index, n) => {
      const x = index % grid.width;
      const y = Math.floor(index / grid.width);
      const m = material[index];
      // Solid mass far from any open cell reads as a dark, lower collapsed block
      // so corridors and rooms stand out against it.
      let deep = true;
      for (let dy = -1; dy <= 1 && deep; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (grid.inBounds(nx, ny) && grid.get(nx, ny) !== WALL) {
            deep = false;
            break;
          }
        }
      const h = deep ? wallHeight[index] * 0.72 : wallHeight[index];
      const style = wallStyle(m, rng);
      cellToWorld(engine, x, y, p);
      let sx = 1;
      let sz = 1;
      if (m === Material.Desk) {
        sx = 0.95;
        sz = 0.7;
      } else if (m === Material.Crate) {
        sx = sz = 0.8;
      } else if (m === Material.Shelf) {
        sx = 0.9;
        sz = 0.45;
      } else if (m === Material.Pillar) {
        sx = sz = 0.7;
      } else if (m === Material.Rock) {
        sx = 1.04 + rng.random() * 0.1;
        sz = 1.04 + rng.random() * 0.1;
      }
      tmp.position.set(p.x + (rng.random() - 0.5) * style.jitter * 0.3, h / 2, p.z + (rng.random() - 0.5) * style.jitter * 0.3);
      tmp.rotation.set((rng.random() - 0.5) * style.jitter, (rng.random() - 0.5) * style.jitter * 2, (rng.random() - 0.5) * style.jitter);
      tmp.scale.set(sx, h, sz);
      tmp.updateMatrix();
      mesh.setMatrixAt(n, tmp.matrix);
      color.set(style.color).multiplyScalar((0.85 + rng.random() * 0.3) * (deep ? (m === Material.Rock ? 0.65 : 0.42) : 1));
      mesh.setColorAt(n, color);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [cells, engine, grid, material, wallHeight]);

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, cells.length]} castShadow receiveShadow>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial roughness={0.92} metalness={0.05} />
    </instancedMesh>
  );
}

function Rubble({ engine, perCell }: { engine: SimulationEngine; perCell: number }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const { grid, material } = engine.scenario;
  const spots = useMemo(() => {
    const list: Array<[number, number, number]> = [];
    for (let i = 0; i < grid.cells.length; i++) {
      if (grid.cells[i] === RUBBLE) for (let k = 0; k < perCell; k++) list.push([i % grid.width, Math.floor(i / grid.width), 1]);
      // Spill debris at the foot of broken and collapsed walls.
      if (material[i] === Material.BrokenWall || material[i] === Material.Collapsed) list.push([i % grid.width, Math.floor(i / grid.width), 0.6]);
    }
    return list;
  }, [grid, material, perCell]);

  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const rng = new Rng(engine.scenario.seed ^ 0x7b1e);
    const p = new THREE.Vector3();
    spots.forEach(([x, y, size], n) => {
      cellToWorld(engine, x, y, p);
      const s = (0.18 + rng.random() * 0.32) * size;
      tmp.position.set(p.x + (rng.random() - 0.5) * 0.9, s * 0.45, p.z + (rng.random() - 0.5) * 0.9);
      tmp.rotation.set(rng.random() * 3, rng.random() * 3, rng.random() * 3);
      tmp.scale.set(s * (0.8 + rng.random() * 0.6), s * (0.5 + rng.random() * 0.5), s * (0.8 + rng.random() * 0.6));
      tmp.updateMatrix();
      mesh.setMatrixAt(n, tmp.matrix);
      color.set(rng.pick(['#6b5d4f', '#7d7065', '#5a4e43', '#8a8076', '#4d4339'])).multiplyScalar(0.8 + rng.random() * 0.4);
      mesh.setColorAt(n, color);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [engine, spots]);

  if (!spots.length) return null;
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, spots.length]} castShadow receiveShadow>
      <dodecahedronGeometry args={[1, 0]} />
      <meshStandardMaterial roughness={1} flatShading />
    </instancedMesh>
  );
}

const PROP_SHAPES = {
  beam: { geo: <boxGeometry args={[0.14, 0.14, 1.7]} />, color: '#5b4632' },
  pipe: { geo: <cylinderGeometry args={[0.06, 0.06, 1.5, 8]} />, color: '#7d8790' },
  debris: { geo: <boxGeometry args={[0.32, 0.12, 0.28]} />, color: '#6e655c' },
  barrel: { geo: <cylinderGeometry args={[0.22, 0.22, 0.6, 12]} />, color: '#a3471f' },
  cable: { geo: <cylinderGeometry args={[0.025, 0.025, 1.8, 5]} />, color: '#151515' },
} as const;

function Props({ engine }: { engine: SimulationEngine }) {
  const groups = useMemo(() => {
    const by: Record<string, typeof engine.scenario.props> = {};
    for (const p of engine.scenario.props) (by[p.kind] ??= []).push(p);
    return by;
  }, [engine]);
  return (
    <>
      {Object.entries(groups).map(([kind, items]) => (
        <PropGroup key={kind} engine={engine} kind={kind as keyof typeof PROP_SHAPES} items={items} />
      ))}
    </>
  );
}

function PropGroup({ engine, kind, items }: { engine: SimulationEngine; kind: keyof typeof PROP_SHAPES; items: SimulationEngine['scenario']['props'] }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const p = new THREE.Vector3();
    items.forEach((item, n) => {
      cellToWorld(engine, item.x, item.y, p);
      if (kind === 'beam') {
        // Fallen beams lean against the floor at an angle.
        tmp.position.set(p.x, 0.35, p.z);
        tmp.rotation.set(0.35, item.rotation, 0.1);
      } else if (kind === 'pipe' || kind === 'cable') {
        tmp.position.set(p.x, kind === 'pipe' ? 0.07 : 0.03, p.z);
        tmp.rotation.set(Math.PI / 2, 0, item.rotation);
      } else if (kind === 'barrel') {
        const tipped = item.scale > 1;
        tmp.position.set(p.x, tipped ? 0.22 : 0.3, p.z);
        tmp.rotation.set(tipped ? Math.PI / 2 : 0, item.rotation, 0);
      } else {
        tmp.position.set(p.x + Math.cos(item.rotation) * 0.25, 0.06, p.z + Math.sin(item.rotation) * 0.25);
        tmp.rotation.set(0, item.rotation, 0.1);
      }
      tmp.scale.setScalar(kind === 'barrel' ? 1 : item.scale);
      tmp.updateMatrix();
      mesh.setMatrixAt(n, tmp.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [engine, items, kind]);
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, items.length]} castShadow receiveShadow>
      {PROP_SHAPES[kind].geo}
      <meshStandardMaterial color={PROP_SHAPES[kind].color} roughness={kind === 'pipe' ? 0.45 : 0.85} metalness={kind === 'pipe' ? 0.6 : 0.1} />
    </instancedMesh>
  );
}

/** Broken stairwell treads and railing (apartment preset). Purely visual: the grid decides traversal. */
function Stairs({ engine }: { engine: SimulationEngine }) {
  const treads = useRef<THREE.InstancedMesh>(null);
  const posts = useRef<THREE.InstancedMesh>(null);
  const layout = useMemo(() => {
    const well = engine.scenario.stairwell;
    const steps: Array<{ x: number; y: number; h: number; tilt: number; yaw: number }> = [];
    const rails: Array<{ x: number; y: number; fallen: number }> = [];
    if (!well) return { steps, rails };
    const rng = new Rng(engine.scenario.seed ^ 0x57a1);
    const span = Math.max(1, well.y1 - well.y0 - 2);
    for (let y = well.y0 + 1; y < well.y1; y++) {
      // Treads climb towards the landing halfway, then descend again.
      const t = (y - well.y0 - 1) / span;
      const h = 0.03 + 0.16 * (1 - Math.abs(t * 2 - 1));
      for (const x of [well.x, well.x + 1]) {
        // Rubble and collapsed (wall) cells are drawn by their own layers.
        if (engine.scenario.grid.get(x, y) !== FREE) continue;
        const broken = rng.random() < 0.25;
        steps.push({ x, y, h, tilt: broken ? (rng.random() - 0.5) * 0.5 : 0, yaw: broken ? (rng.random() - 0.5) * 0.4 : 0 });
      }
      if ((y - well.y0) % 2 === 0) for (const x of [well.x - 0.45, well.x + 1.45]) rails.push({ x, y, fallen: rng.random() < 0.3 ? rng.random() * 1.3 : 0 });
    }
    return { steps, rails };
  }, [engine]);

  useEffect(() => {
    const p = new THREE.Vector3();
    const t = treads.current;
    if (t) {
      layout.steps.forEach((s, n) => {
        cellToWorld(engine, s.x, s.y, p);
        tmp.position.set(p.x, s.h / 2, p.z);
        tmp.rotation.set(s.tilt, s.yaw, 0);
        tmp.scale.set(1, s.h / 0.1, 1);
        tmp.updateMatrix();
        t.setMatrixAt(n, tmp.matrix);
      });
      t.instanceMatrix.needsUpdate = true;
      t.computeBoundingSphere();
    }
    const r = posts.current;
    if (r) {
      layout.rails.forEach((s, n) => {
        cellToWorld(engine, s.x, s.y, p);
        tmp.position.set(p.x, s.fallen ? 0.08 : 0.45, p.z);
        tmp.rotation.set(s.fallen ? Math.PI / 2 : 0, s.fallen, 0);
        tmp.scale.set(1, 1, 1);
        tmp.updateMatrix();
        r.setMatrixAt(n, tmp.matrix);
      });
      r.instanceMatrix.needsUpdate = true;
      r.computeBoundingSphere();
    }
  }, [engine, layout]);

  if (!layout.steps.length) return null;
  return (
    <group>
      <instancedMesh ref={treads} args={[undefined, undefined, layout.steps.length]} castShadow receiveShadow>
        <boxGeometry args={[0.94, 0.1, 0.8]} />
        <meshStandardMaterial color="#77736b" roughness={0.9} />
      </instancedMesh>
      <instancedMesh ref={posts} args={[undefined, undefined, layout.rails.length]} castShadow>
        <cylinderGeometry args={[0.03, 0.03, 0.9, 6]} />
        <meshStandardMaterial color="#3d4248" roughness={0.5} metalness={0.7} />
      </instancedMesh>
    </group>
  );
}

function Floor({ engine, onFloorClick }: { engine: SimulationEngine; onFloorClick?: (e: ThreeEvent<MouseEvent>) => void }) {
  const { width, height, preset, seed } = engine.scenario;
  const texture = useMemo(() => makeFloorTexture(width, height, preset, seed), [width, height, preset, seed]);
  useEffect(() => () => texture.dispose(), [texture]);
  return (
    <mesh rotation-x={-Math.PI / 2} receiveShadow onClick={onFloorClick}>
      <planeGeometry args={[width, height]} />
      <meshStandardMaterial map={texture} roughness={0.95} metalness={0.02} />
    </mesh>
  );
}

function StagingZone({ engine }: { engine: SimulationEngine }) {
  const texture = useMemo(() => makeHazardTexture(), []);
  const { spawn } = engine.scenario;
  const c = cellToWorld(engine, spawn.x + spawn.size / 2 - 0.5, spawn.y + spawn.size / 2 - 0.5);
  const s = spawn.size;
  const strips: Array<[number, number, number, number]> = [
    [c.x, c.z - s / 2, s, 0.18],
    [c.x, c.z + s / 2, s, 0.18],
    [c.x - s / 2, c.z, 0.18, s],
    [c.x + s / 2, c.z, 0.18, s],
  ];
  return (
    <group>
      {strips.map(([x, z, w, h], i) => (
        <mesh key={i} position={[x, 0.012, z]} rotation-x={-Math.PI / 2}>
          <planeGeometry args={[w, h]} />
          <meshBasicMaterial map={texture} toneMapped={false} transparent opacity={0.85} />
        </mesh>
      ))}
      <mesh position={[c.x, 0.01, c.z]} rotation-x={-Math.PI / 2}>
        <planeGeometry args={[s, s]} />
        <meshBasicMaterial color="#e2b414" transparent opacity={0.06} toneMapped={false} />
      </mesh>
    </group>
  );
}

function EmergencyLights({ engine, count }: { engine: SimulationEngine; count: number }) {
  const lights = engine.scenario.emergencyLights.slice(0, count);
  const refs = useRef<Array<THREE.PointLight | null>>([]);
  const bulbs = useRef<Array<THREE.Mesh | null>>([]);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    lights.forEach((_, i) => {
      const pulse = 0.55 + 0.45 * Math.max(0, Math.sin(t * 3.2 + i * 1.7));
      const light = refs.current[i];
      if (light) light.intensity = 6 * pulse;
      const bulb = bulbs.current[i];
      if (bulb) (bulb.material as THREE.MeshBasicMaterial).color.setRGB(1 * pulse + 0.2, 0.12 * pulse, 0.05);
    });
  });
  return (
    <>
      {lights.map((l, i) => {
        const p = cellToWorld(engine, l.x, l.y);
        return (
          <group key={i} position={[p.x, 0, p.z]}>
            <pointLight ref={(el) => (refs.current[i] = el)} position={[0, 1.7, 0]} color="#ff2a10" distance={7.5} decay={1.6} />
            <mesh ref={(el) => (bulbs.current[i] = el)} position={[0, 1.95, 0]}>
              <boxGeometry args={[0.16, 0.08, 0.16]} />
              <meshBasicMaterial color="#ff2a10" toneMapped={false} />
            </mesh>
          </group>
        );
      })}
    </>
  );
}

/** Fake volumetric moonlight spilling through roof openings. */
function LightShafts({ engine }: { engine: SimulationEngine }) {
  const glow = glowTexture();
  return (
    <>
      {engine.scenario.openings.map((o, i) => {
        const p = cellToWorld(engine, o.x, o.y);
        return (
          <group key={i} position={[p.x, 0, p.z]}>
            <mesh position={[0, 3.2, 0]}>
              <cylinderGeometry args={[0.5, 1.7, 6.4, 20, 1, true]} />
              <meshBasicMaterial color="#9fc4ff" transparent opacity={0.055} depthWrite={false} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} toneMapped={false} />
            </mesh>
            <mesh position={[0, 0.02, 0]} rotation-x={-Math.PI / 2}>
              <planeGeometry args={[4, 4]} />
              <meshBasicMaterial map={glow} color="#7fa8ff" transparent opacity={0.35} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
            </mesh>
            <pointLight position={[0, 3.5, 0]} color="#8fb4ff" intensity={4} distance={8} decay={1.5} />
          </group>
        );
      })}
    </>
  );
}

export function World({
  engine,
  quality,
  onFloorClick,
}: {
  engine: SimulationEngine;
  quality: QualityProfile;
  onFloorClick?: (e: ThreeEvent<MouseEvent>) => void;
}) {
  return (
    <group>
      <Floor engine={engine} onFloorClick={onFloorClick} />
      <StagingZone engine={engine} />
      <Walls engine={engine} />
      <Rubble engine={engine} perCell={quality.rubblePerCell} />
      <Props engine={engine} />
      <Stairs engine={engine} />
      <EmergencyLights engine={engine} count={quality.emergencyLights} />
      {quality.lightShafts && <LightShafts engine={engine} />}
    </group>
  );
}
