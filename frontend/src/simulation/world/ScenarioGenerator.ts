/**
 * Deterministic seeded scenario generation.
 *
 * Mirrors the Python world generator contract (world/generator.py,
 * world/victims.py, world/reachability.py): walls/rubble on a grid, a common
 * spawn staging square, reachability cleanup from the spawn and well separated
 * reachable survivors. Layout styles are browser-specific presets.
 */
import { DEFAULT_WORLD } from '../core/config';
import { Rng, hashString } from '../core/Rng';
import type { Point } from '../core/types';
import { FREE, GridMap, Material, RUBBLE, WALL, bfsDistances, closeUnreachable } from './GridMap';

export type PresetId = 'office' | 'mine' | 'apartment' | 'random' | 'demo';

export interface PresetInfo {
  id: PresetId;
  name: string;
  disaster: string;
}

export const PRESETS: PresetInfo[] = [
  {
    id: 'office',
    name: 'Collapsed Office',
    disaster: 'Partial floor collapse in a 3-storey office block after a gas explosion.',
  },
  {
    id: 'mine',
    name: 'Mine Tunnel',
    disaster: 'Roof fall in a mine gallery. Miners are trapped behind narrow, rubble-choked tunnels.',
  },
  {
    id: 'apartment',
    name: 'Earthquake Apartment',
    disaster: 'M6.8 earthquake. Apartment floor with broken stairwell and survivor voids.',
  },
  {
    id: 'random',
    name: 'Random Irregular Site',
    disaster: 'Unmapped irregular collapse zone generated from the mission seed.',
  },
  {
    id: 'demo',
    name: 'Validation Demo',
    disaster: 'Controlled demo: lossy radio, delayed links, a forced partition and a one-cell corridor.',
  },
];

export interface Victim {
  id: number;
  x: number;
  y: number;
  found: boolean;
  foundBy: string | null;
  foundStep: number | null;
}

export type PropKind = 'beam' | 'pipe' | 'debris' | 'barrel' | 'cable';

export interface Stairwell {
  x: number;
  y0: number;
  y1: number;
}

export interface DecorProp {
  kind: PropKind;
  x: number;
  y: number;
  rotation: number;
  scale: number;
}

export interface Scenario {
  preset: PresetId;
  seed: number;
  name: string;
  disaster: string;
  width: number;
  height: number;
  /** Ground truth. Used only for rendering, physics, sensor simulation and statistics. */
  grid: GridMap;
  material: Uint8Array;
  wallHeight: Float32Array;
  spawn: { x: number; y: number; size: number };
  spawnCenter: Point;
  /** BFS distance from spawn over the truth map (offline statistics only). */
  distances: Int32Array;
  victims: Victim[];
  props: DecorProp[];
  emergencyLights: Point[];
  openings: Point[];
  /** Apartment stairwell (rendering only): two cells wide from row y0 to y1. */
  stairwell: Stairwell | null;
  maxSteps: number;
  batteryScale: number;
}

export interface ScenarioOptions {
  preset: PresetId;
  seed: number;
  survivorCount?: [number, number];
}

class Builder {
  grid: GridMap;
  material: Uint8Array;
  stairwell: Stairwell | null = null;
  constructor(
    readonly width: number,
    readonly height: number,
    readonly rng: Rng,
    fillMaterial: number,
  ) {
    this.grid = new GridMap(width, height, WALL);
    this.material = new Uint8Array(width * height).fill(fillMaterial);
  }

  interior(x: number, y: number): boolean {
    return x >= 1 && y >= 1 && x < this.width - 1 && y < this.height - 1;
  }

  setCell(x: number, y: number, value: number, material: number = Material.None): void {
    if (!this.interior(x, y)) return;
    this.grid.set(x, y, value);
    this.material[y * this.width + x] = value === WALL ? material || Material.Concrete : material;
  }

  rect(x0: number, y0: number, x1: number, y1: number, value: number, material: number = Material.None): void {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
      for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) this.setCell(x, y, value, material);
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, value: number): void {
    for (let y = cy - ry; y <= cy + ry; y++)
      for (let x = cx - rx; x <= cx + rx; x++) {
        const nx = (x - cx) / Math.max(1, rx);
        const ny = (y - cy) / Math.max(1, ry);
        if (nx * nx + ny * ny <= 1.0) this.setCell(x, y, value);
      }
  }

  segment(a: Point, b: Point, radius: number, value: number): void {
    const count = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y), 1);
    for (let i = 0; i <= count; i++) {
      const f = i / count;
      const x = Math.round(a.x + f * (b.x - a.x));
      const y = Math.round(a.y + f * (b.y - a.y));
      if (radius <= 0) this.setCell(x, y, value);
      else this.rect(x - radius, y - radius, x + radius, y + radius, value);
    }
  }

  elbow(a: Point, b: Point, radius: number, horizontalFirst: boolean): void {
    const corner = horizontalFirst ? { x: b.x, y: a.y } : { x: a.x, y: b.y };
    this.segment(a, corner, radius, FREE);
    this.segment(corner, b, radius, FREE);
  }

  reachableCount(sx: number, sy: number): number {
    const d = bfsDistances(this.grid, sx, sy);
    let n = 0;
    for (let i = 0; i < d.length; i++) if (d[i] >= 0) n++;
    return n;
  }

  /** Place blocking cells only if they do not cut off more than the cells themselves. */
  tryBlock(cells: Point[], spawn: Point, material: number): boolean {
    const before = this.reachableCount(spawn.x, spawn.y);
    const previous = cells.map((c) => [this.grid.get(c.x, c.y), this.material[c.y * this.width + c.x]] as const);
    let changed = 0;
    for (const c of cells) {
      if (this.interior(c.x, c.y) && this.grid.get(c.x, c.y) !== WALL) changed++;
      this.setCell(c.x, c.y, WALL, material);
    }
    const after = this.reachableCount(spawn.x, spawn.y);
    if (after < before - changed) {
      cells.forEach((c, i) => {
        this.grid.set(c.x, c.y, previous[i][0]);
        this.material[c.y * this.width + c.x] = previous[i][1];
      });
      return false;
    }
    return true;
  }

  rubblePatches(count: number, radius: [number, number], spawn: Rect): void {
    for (let i = 0; i < count; i++) {
      const cx = this.rng.integers(1, this.width - 1);
      const cy = this.rng.integers(1, this.height - 1);
      const r = this.rng.integers(radius[0], radius[1] + 1);
      for (let y = cy - r; y <= cy + r; y++)
        for (let x = cx - r; x <= cx + r; x++) {
          if (!this.interior(x, y) || inRect(spawn, x, y, 1)) continue;
          if (this.grid.get(x, y) !== FREE) continue;
          if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
          if (this.rng.random() < 0.65) this.setCell(x, y, RUBBLE);
        }
    }
  }
}

interface Rect {
  x: number;
  y: number;
  size: number;
}

function inRect(r: Rect, x: number, y: number, margin = 0): boolean {
  return x >= r.x - margin && y >= r.y - margin && x < r.x + r.size + margin && y < r.y + r.size + margin;
}

// ---------------------------------------------------------------------------
// Layout styles. Each returns the spawn square; the builder holds the grid.
// ---------------------------------------------------------------------------

function layoutOffice(b: Builder): Rect {
  const { width: W, height: H, rng } = b;
  const hallTop = Math.floor(H / 2) - 1;
  const hallBottom = hallTop + 1;
  b.rect(1, hallTop, W - 2, hallBottom, FREE);
  // Upper and lower rows of offices separated by randomly spaced partitions.
  const rows: Array<[number, number, number]> = [
    [1, hallTop - 2, hallTop - 1],
    [hallBottom + 2, H - 2, hallBottom + 1],
  ];
  for (const [y0, y1, wallY] of rows) {
    let x = 1;
    while (x < W - 2) {
      const roomWidth = Math.min(W - 2 - x, rng.integers(5, 10));
      if (roomWidth < 3) break;
      b.rect(x, y0, x + roomWidth - 1, y1, FREE);
      // Door into the hallway.
      const door = x + rng.integers(1, Math.max(2, roomWidth - 1));
      b.setCell(door, wallY, FREE);
      if (rng.random() < 0.35) b.setCell(Math.min(x + roomWidth - 1, door + 1), wallY, FREE);
      // Desks along the back wall.
      const desks = rng.integers(1, 3);
      for (let d = 0; d < desks; d++) {
        const dx = x + rng.integers(0, Math.max(1, roomWidth - 2));
        const dy = y0 === 1 ? y0 + rng.integers(0, 2) : y1 - rng.integers(0, 2);
        if (Math.abs(dx - door) > 1) {
          b.setCell(dx, dy, WALL, Material.Desk);
          if (dx + 1 < x + roomWidth) b.setCell(dx + 1, dy, WALL, Material.Desk);
        }
      }
      x += roomWidth + 1;
    }
  }
  // Explosion damage: blast holes through partition walls between rooms.
  const holes = rng.integers(4, 8);
  for (let i = 0; i < holes; i++) {
    const hx = rng.integers(2, W - 2);
    const hy = rng.integers(2, H - 2);
    if (b.grid.get(hx, hy) === WALL && b.material[hy * W + hx] === Material.Concrete) {
      b.setCell(hx, hy, RUBBLE);
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nx = hx + dx;
        const ny = hy + dy;
        if (b.interior(nx, ny) && b.grid.get(nx, ny) === WALL && b.material[ny * W + nx] === Material.Concrete)
          b.material[ny * W + nx] = Material.BrokenWall;
      }
    }
  }
  const spawnLeft = rng.random() < 0.5;
  const spawn: Rect = { x: spawnLeft ? 1 : W - 5, y: hallTop - 1, size: 4 };
  b.rect(spawn.x, spawn.y, spawn.x + 3, spawn.y + 3, FREE);
  // Blocked hallway: collapsed ceiling slab somewhere in the middle third.
  const center = { x: spawn.x + 2, y: spawn.y + 2 };
  const bx = rng.integers(Math.floor(W / 3), Math.floor((2 * W) / 3));
  b.tryBlock(
    [
      { x: bx, y: hallTop },
      { x: bx, y: hallBottom },
      { x: bx + 1, y: hallTop },
    ],
    center,
    Material.Collapsed,
  );
  return spawn;
}

function layoutMine(b: Builder): Rect {
  const { width: W, height: H, rng } = b;
  const portrait = H > W;
  const spawn: Rect = portrait
    ? { x: Math.floor(W / 2) - 2, y: 1, size: 4 }
    : { x: 1, y: Math.floor(H / 2) - 2, size: 4 };
  b.rect(spawn.x, spawn.y, spawn.x + 3, spawn.y + 3, FREE);
  const start = { x: spawn.x + 2, y: spawn.y + 2 };
  // Main gallery drifting towards the far end.
  const main: Point[] = [start];
  let cur = { ...start };
  const target = portrait ? { x: Math.floor(W / 2), y: H - 4 } : { x: W - 4, y: Math.floor(H / 2) };
  while (Math.abs(cur.x - target.x) + Math.abs(cur.y - target.y) > 3) {
    const next = portrait
      ? { x: clamp(cur.x + rng.integers(-4, 5), 3, W - 4), y: Math.min(target.y, cur.y + rng.integers(4, 8)) }
      : { x: Math.min(target.x, cur.x + rng.integers(4, 8)), y: clamp(cur.y + rng.integers(-4, 5), 3, H - 4) };
    b.elbow(cur, next, 0, rng.random() < 0.5);
    // Widen the main gallery in places to leave passing bays.
    if (rng.random() < 0.5) b.segment(cur, { x: cur.x + (portrait ? 1 : 0), y: cur.y + (portrait ? 0 : 1) }, 0, FREE);
    main.push(next);
    cur = next;
  }
  // Narrow side drifts ending in small chambers (refuge pockets).
  const branches = rng.integers(5, 8);
  for (let i = 0; i < branches; i++) {
    let p = { ...main[rng.integers(1, main.length)] };
    const steps = rng.integers(2, 4);
    for (let s = 0; s < steps; s++) {
      const len = rng.integers(4, 9);
      const horizontal = portrait ? s % 2 === 0 : s % 2 === 1;
      const dir = rng.random() < 0.5 ? -1 : 1;
      const q = horizontal
        ? { x: clamp(p.x + dir * len, 2, W - 3), y: p.y }
        : { x: p.x, y: clamp(p.y + dir * len, 2, H - 3) };
      b.segment(p, q, 0, FREE);
      p = q;
    }
    b.ellipse(p.x, p.y, rng.integers(1, 3), rng.integers(1, 3), FREE);
  }
  // Collapsed shaft: a rubble choke on the main gallery.
  const choke = main[Math.floor(main.length / 2)];
  for (let y = choke.y - 1; y <= choke.y + 1; y++)
    for (let x = choke.x - 1; x <= choke.x + 1; x++) if (b.grid.get(x, y) === FREE && !inRect(spawn, x, y, 1)) b.setCell(x, y, RUBBLE);
  return spawn;
}

function layoutApartment(b: Builder): Rect {
  const { width: W, height: H, rng } = b;
  const c1 = Math.floor(H / 3);
  const c2 = Math.floor((2 * H) / 3);
  b.rect(2, c1, W - 3, c1, FREE);
  b.rect(2, c2, W - 3, c2, FREE);
  // Stairwell linking the two corridors; its broken flights are rubble.
  const stairX = rng.integers(Math.floor(W / 3), Math.floor((2 * W) / 3));
  b.rect(stairX, c1, stairX + 1, c2, FREE);
  b.stairwell = { x: stairX, y0: c1, y1: c2 };
  for (let y = c1 + 2; y < c2 - 1; y += 2) b.setCell(stairX + (y % 4 === 0 ? 0 : 1), y, RUBBLE);
  // Apartment units on each side of the corridors.
  const bands: Array<[number, number, number]> = [
    [1, c1 - 2, c1 - 1],
    [c1 + 2, c2 - 2, c1 + 1],
    [c2 + 2, H - 2, c2 + 1],
  ];
  for (const [y0, y1, doorY] of bands) {
    let x = 1;
    while (x < W - 3) {
      const w = Math.min(W - 2 - x, rng.integers(4, 8));
      if (w < 3) break;
      if (x <= stairX + 1 && x + w >= stairX) {
        x = stairX + 3;
        continue;
      }
      b.rect(x, y0, x + w - 1, y1, FREE);
      b.setCell(x + rng.integers(0, w), doorY, FREE);
      // Survivor void: a small closet with a single opening.
      if (rng.random() < 0.55 && w >= 4 && y1 - y0 >= 3) {
        const top = y0 === 1;
        const vy = top ? y0 : y1;
        const vx = x + w - 2;
        b.setCell(vx - 1, top ? vy + 1 : vy - 1, WALL, Material.Concrete);
        b.setCell(vx - 1, vy, WALL, Material.Concrete);
        b.setCell(vx, top ? vy + 1 : vy - 1, WALL, Material.Concrete);
      }
      if (rng.random() < 0.6) b.setCell(x + rng.integers(0, w), y0 + rng.integers(0, Math.max(1, y1 - y0)), WALL, Material.Shelf);
      x += w + 1;
    }
  }
  // Earthquake damage: cracked partitions become rubble gaps.
  for (let i = 0; i < rng.integers(5, 9); i++) {
    const x = rng.integers(2, W - 2);
    const y = rng.integers(2, H - 2);
    if (b.grid.get(x, y) === WALL) b.setCell(x, y, RUBBLE);
  }
  const spawnLeft = rng.random() < 0.5;
  const spawn: Rect = { x: spawnLeft ? 1 : W - 5, y: c2 - 2, size: 4 };
  b.rect(spawn.x, spawn.y, spawn.x + 3, spawn.y + 3, FREE);
  // Pancaked corner: a collapsed block that may seal part of a corridor.
  const center = { x: spawn.x + 2, y: spawn.y + 2 };
  const px = rng.integers(Math.floor(W / 4), Math.floor((3 * W) / 4));
  b.tryBlock(
    [
      { x: px, y: c1 },
      { x: px + 1, y: c1 },
    ],
    center,
    Material.Collapsed,
  );
  return spawn;
}

function layoutRandom(b: Builder): Rect {
  const { width: W, height: H, rng } = b;
  const corner = rng.integers(4);
  const spawn: Rect = {
    x: corner % 2 === 0 ? 1 : W - 5,
    y: corner < 2 ? 1 : H - 5,
    size: 4,
  };
  const center = { x: spawn.x + 2, y: spawn.y + 2 };
  b.ellipse(center.x, center.y, 3, 3, FREE);
  const centers: Point[] = [center];
  const lobes = clamp(Math.floor((W * H) / 180), 6, 14);
  for (let i = 0; i < lobes; i++) {
    const c = { x: rng.integers(3, W - 3), y: rng.integers(3, H - 3) };
    const nearest = centers.reduce((best, p) =>
      Math.abs(p.x - c.x) + Math.abs(p.y - c.y) < Math.abs(best.x - c.x) + Math.abs(best.y - c.y) ? p : best,
    );
    b.ellipse(c.x, c.y, rng.integers(2, 5), rng.integers(2, 5), FREE);
    b.elbow(nearest, c, rng.random() < 0.6 ? 0 : 1, rng.random() < 0.5);
    centers.push(c);
  }
  // Collapsed columns inside open lobes.
  for (let i = 0; i < rng.integers(4, 10); i++) {
    const x = rng.integers(2, W - 2);
    const y = rng.integers(2, H - 2);
    if (!inRect(spawn, x, y, 2) && b.grid.get(x, y) === FREE) b.tryBlock([{ x, y }], center, Material.Pillar);
  }
  b.rect(spawn.x, spawn.y, spawn.x + 3, spawn.y + 3, FREE);
  return spawn;
}

/** Fixed demo geometry: staging room, a one-cell corridor and a damaged wing. */
function layoutDemo(b: Builder): Rect {
  const { width: W, height: H, rng } = b;
  const spawn: Rect = { x: 2, y: Math.floor(H / 2) - 2, size: 4 };
  b.rect(1, spawn.y - 2, 7, spawn.y + 5, FREE);
  const cy = Math.floor(H / 2);
  // The narrow corridor: exactly one cell wide for 12 cells.
  b.rect(8, cy, 20, cy, FREE);
  // Damaged east wing: three rooms off a north–south hall.
  b.rect(21, 2, 23, H - 3, FREE);
  b.rect(25, 2, W - 2, 8, FREE);
  b.rect(25, 10, W - 2, H - 11, FREE);
  b.rect(25, H - 9, W - 2, H - 2, FREE);
  b.setCell(24, 5, FREE);
  b.setCell(24, cy, FREE);
  b.setCell(24, H - 5, FREE);
  // A second, rubble-choked route back west so the wing is not a pure dead end.
  b.rect(8, 3, 20, 3, FREE);
  b.rect(8, 3, 8, spawn.y - 2, FREE);
  for (let x = 11; x <= 15; x++) b.setCell(x, 3, RUBBLE);
  for (let i = 0; i < 6; i++) {
    const x = rng.integers(26, W - 2);
    const y = rng.integers(2, H - 2);
    if (b.grid.get(x, y) === FREE) b.setCell(x, y, WALL, Material.Crate);
  }
  b.rect(spawn.x, spawn.y, spawn.x + 3, spawn.y + 3, FREE);
  return spawn;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function dimensions(preset: PresetId, rng: Rng): [number, number] {
  switch (preset) {
    case 'office':
      return [rng.integers(42, 50), rng.integers(26, 32)];
    case 'mine':
      // Mines alternate portrait and landscape by seed.
      return rng.random() < 0.5 ? [rng.integers(30, 36), rng.integers(44, 52)] : [rng.integers(44, 52), rng.integers(30, 36)];
    case 'apartment':
      return [rng.integers(40, 48), rng.integers(30, 36)];
    case 'random': {
      const a = rng.integers(28, 38);
      const b2 = rng.integers(42, 56);
      return rng.random() < 0.5 ? [a, b2] : [b2, a];
    }
    case 'demo':
      return [40, 26];
  }
}

function placeVictims(
  grid: GridMap,
  distances: Int32Array,
  rng: Rng,
  count: number,
  minPath: number,
  minBetween: number,
): Victim[] | null {
  const candidates: Point[] = [];
  for (let y = 0; y < grid.height; y++)
    for (let x = 0; x < grid.width; x++)
      if (grid.get(x, y) === FREE && distances[y * grid.width + x] >= minPath) candidates.push({ x, y });
  if (candidates.length < count) return null;
  const order = rng.permutation(candidates.length);
  const chosen: Point[] = [];
  for (const index of order) {
    const p = candidates[index];
    if (chosen.every((c) => Math.hypot(p.x - c.x, p.y - c.y) >= minBetween)) {
      chosen.push(p);
      if (chosen.length === count) break;
    }
  }
  if (chosen.length !== count) return null;
  return chosen.map((p, id) => ({ id, x: p.x, y: p.y, found: false, foundBy: null, foundStep: null }));
}

export function generateScenario(options: ScenarioOptions): Scenario {
  const { preset, seed } = options;
  const info = PRESETS.find((p) => p.id === preset)!;
  const rng = new Rng((seed ^ hashString(preset)) >>> 0);
  const survivorRange = options.survivorCount ?? DEFAULT_WORLD.numVictims;

  for (let attempt = 0; attempt < DEFAULT_WORLD.maxGenerationRetries; attempt++) {
    const [W, H] = dimensions(preset, rng);
    const b = new Builder(W, H, rng, preset === 'mine' || preset === 'random' ? Material.Rock : Material.Concrete);
    const spawn =
      preset === 'office'
        ? layoutOffice(b)
        : preset === 'mine'
          ? layoutMine(b)
          : preset === 'apartment'
            ? layoutApartment(b)
            : preset === 'demo'
              ? layoutDemo(b)
              : layoutRandom(b);
    if (preset !== 'demo') b.rubblePatches(DEFAULT_WORLD.rubblePatches, DEFAULT_WORLD.rubblePatchRadius, spawn);
    const spawnCenter = { x: spawn.x + Math.floor(spawn.size / 2), y: spawn.y + Math.floor(spawn.size / 2) };
    const distances = closeUnreachable(b.grid, spawnCenter.x, spawnCenter.y);
    // Keep the material layer consistent with sealed pockets.
    for (let i = 0; i < b.grid.cells.length; i++) {
      if (b.grid.cells[i] === WALL && b.material[i] === Material.None) b.material[i] = preset === 'mine' || preset === 'random' ? Material.Rock : Material.Concrete;
      if (b.grid.cells[i] !== WALL) b.material[i] = Material.None;
    }
    let reachable = 0;
    for (let i = 0; i < distances.length; i++) if (distances[i] >= 0) reachable++;
    // Mines are mostly rock by design; other sites need a substantial open floor.
    if (reachable < W * H * (preset === 'mine' ? 0.1 : 0.18)) continue;
    const count = rng.integers(survivorRange[0], survivorRange[1] + 1);
    const minPath = preset === 'demo' ? 18 : DEFAULT_WORLD.victimMinDistFromSpawn;
    const victims = placeVictims(b.grid, distances, rng, count, minPath, DEFAULT_WORLD.victimMinDistBetween);
    if (!victims) continue;

    const wallHeight = new Float32Array(W * H);
    for (let i = 0; i < wallHeight.length; i++) {
      const m = b.material[i];
      wallHeight[i] =
        m === Material.BrokenWall
          ? 0.5 + rng.random() * 0.9
          : m === Material.Collapsed
            ? 0.6 + rng.random() * 0.5
            : m === Material.Desk
              ? 0.75
              : m === Material.Crate
                ? 0.9
                : m === Material.Shelf
                  ? 1.5
                  : m === Material.Rock
                    ? 1.9 + rng.random() * 0.8
                    : 1.9 + rng.random() * 0.25;
    }

    // Decoration: beams, pipes, debris on free floor; never blocks logic.
    const props: DecorProp[] = [];
    const kinds: PropKind[] = preset === 'mine' ? ['beam', 'cable', 'debris', 'barrel'] : ['beam', 'pipe', 'debris', 'barrel', 'cable'];
    const propCount = Math.floor(reachable / 14);
    for (let i = 0; i < propCount; i++) {
      const x = rng.integers(1, W - 1);
      const y = rng.integers(1, H - 1);
      if (b.grid.get(x, y) === WALL || inRect(spawn, x, y)) continue;
      props.push({ kind: rng.pick(kinds), x, y, rotation: rng.random() * Math.PI * 2, scale: 0.6 + rng.random() * 0.6 });
    }
    const emergencyLights: Point[] = [];
    for (let i = 0; i < 40 && emergencyLights.length < 8; i++) {
      const x = rng.integers(1, W - 1);
      const y = rng.integers(1, H - 1);
      if (b.grid.get(x, y) !== WALL && emergencyLights.every((p) => Math.hypot(p.x - x, p.y - y) > 7)) emergencyLights.push({ x, y });
    }
    const openings: Point[] = [];
    for (let i = 0; i < 200 && openings.length < 3; i++) {
      const x = rng.integers(2, W - 2);
      const y = rng.integers(2, H - 2);
      if (b.grid.get(x, y) === FREE && openings.every((p) => Math.hypot(p.x - x, p.y - y) > 10)) openings.push({ x, y });
    }

    const area = W * H;
    return {
      preset,
      seed,
      name: info.name,
      disaster: info.disaster,
      width: W,
      height: H,
      grid: b.grid,
      material: b.material,
      wallHeight,
      spawn,
      spawnCenter,
      distances,
      victims,
      props,
      emergencyLights,
      openings,
      stairwell: b.stairwell,
      // Step 2.5 scales mission time and battery with site area (base: 400 steps on 32×32).
      maxSteps: Math.max(400, Math.round((400 * area) / 1024)),
      batteryScale: Math.max(1, area / 1024),
    };
  }
  throw new Error(`Could not generate a valid ${preset} scenario for seed ${seed}`);
}

/** Stable fingerprint used by tests and the debug panel. */
export function scenarioFingerprint(s: Scenario): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.grid.cells.length; i++) h = Math.imul(h ^ (s.grid.cells[i] + 2), 0x01000193) >>> 0;
  return `${s.width}x${s.height}:${h.toString(16)}:${s.victims.map((v) => `${v.x},${v.y}`).join('|')}:${s.spawn.x},${s.spawn.y}`;
}
