import * as THREE from 'three';
import type { Quality } from '../store/simStore';
import type { SimulationEngine } from '../simulation/core/SimulationEngine';
import { simClock } from '../store/simStore';

/** One grid cell = one metre. Cell (x, y) maps to world (x, 0, y) centred on the map. */
export function cellToWorld(engine: SimulationEngine, x: number, y: number, target = new THREE.Vector3()): THREE.Vector3 {
  const { width, height } = engine.scenario;
  return target.set(x - width / 2 + 0.5, 0, y - height / 2 + 0.5);
}

export function worldToCell(engine: SimulationEngine, p: THREE.Vector3): { x: number; y: number } {
  const { width, height } = engine.scenario;
  return { x: Math.floor(p.x + width / 2), y: Math.floor(p.z + height / 2) };
}

/** Interpolated render position of a robot between its previous and current cell. */
export function robotRenderPosition(engine: SimulationEngine, id: number, target = new THREE.Vector3()): THREE.Vector3 {
  const r = engine.robots[id];
  const prev = engine.prevPositions.get(id) ?? r;
  const a = smoothstep(simClock.alpha);
  return cellToWorld(engine, prev.x + (r.x - prev.x) * a, prev.y + (r.y - prev.y) * a, target);
}

export const smoothstep = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

export interface QualityProfile {
  dpr: [number, number];
  antialias: boolean;
  shadows: boolean;
  shadowMapSize: number;
  dust: number;
  emergencyLights: number;
  robotSpotlights: boolean;
  lightShafts: boolean;
  rubblePerCell: number;
  /** Drifting clouds, robot glow lights, bloom/vignette and comm arcs: Medium and High only. */
  clouds: boolean;
  robotGlow: boolean;
  postFx: boolean;
  commFx: boolean;
}

export const QUALITY: Record<Quality, QualityProfile> = {
  low: {
    dpr: [1, 1],
    antialias: false,
    shadows: false,
    shadowMapSize: 1024,
    dust: 120,
    emergencyLights: 2,
    robotSpotlights: false,
    lightShafts: false,
    rubblePerCell: 2,
    clouds: false,
    robotGlow: false,
    postFx: false,
    commFx: false,
  },
  medium: {
    dpr: [1, 1.5],
    antialias: true,
    shadows: true,
    shadowMapSize: 1024,
    dust: 320,
    emergencyLights: 4,
    robotSpotlights: false,
    lightShafts: true,
    rubblePerCell: 3,
    clouds: true,
    robotGlow: true,
    postFx: true,
    commFx: true,
  },
  high: {
    dpr: [1, 2],
    antialias: true,
    shadows: true,
    shadowMapSize: 2048,
    dust: 700,
    emergencyLights: 6,
    robotSpotlights: true,
    lightShafts: true,
    rubblePerCell: 4,
    clouds: true,
    robotGlow: true,
    postFx: true,
    commFx: true,
  },
};

export const COLORS = {
  rover: '#ff9a3c',
  drone: '#46d9ff',
  healthy: '#38f28a',
  weak: '#ffd23f',
  down: '#ff3b4a',
  survivor: '#7dffb2',
  heat: '#ff6a2b',
  sound: '#b48cff',
  manual: '#f5f5ff',
  // Warm game-art palette for the environment and comm effects.
  sand: '#e8d5a3',
  sandDark: '#d4c48a',
  grout: '#a8925f',
  terracotta: '#cd853f',
  sienna: '#a0522d',
  saddle: '#8b4513',
  leaf: '#4caf50',
  leafDark: '#2e7d32',
  water: '#26c6da',
  sun: '#fff5e0',
  sky: '#c8e6f5',
  ember: '#ff7043',
  discovery: '#ffeb3b',
  merge: '#80deea',
};

/** Deterministic hash-based noise for procedural textures. */
function hash2(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2246822519) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

type FloorStyle = 'office' | 'mine' | 'apartment' | 'random' | 'demo';

/** Sand palettes per site: [light tile, dark tile, grout]. Mines run darker ochre. */
const TILE_PALETTE: Record<FloorStyle, [string, string, string]> = {
  office: [COLORS.sand, COLORS.sandDark, COLORS.grout],
  apartment: ['#ead3a8', '#d8bf8e', '#a88c62'],
  demo: [COLORS.sand, COLORS.sandDark, COLORS.grout],
  random: ['#dcc596', '#c9b27f', '#9a8458'],
  mine: ['#c9a66b', '#b58f58', '#7f6440'],
};

function shade(hex: string, k: number): string {
  const c = new THREE.Color(hex);
  c.r = Math.min(1, c.r * k);
  c.g = Math.min(1, c.g * k);
  c.b = Math.min(1, c.b * k);
  return `#${c.getHexString()}`;
}

/**
 * Chunky game-art floor: one bevelled tile per grid cell. Each tile gets a
 * checker tone, a lit top/left rim and a shaded bottom/right rim, so a flat
 * plane reads like raised isometric blocks. Pebbles and grass tufts add life.
 */
export function makeIsoTileTexture(width: number, height: number, style: FloorStyle, seed: number): THREE.CanvasTexture {
  const ppc = Math.max(8, Math.min(32, Math.floor(2048 / Math.max(width, height))));
  const canvas = document.createElement('canvas');
  canvas.width = width * ppc;
  canvas.height = height * ppc;
  const ctx = canvas.getContext('2d')!;
  const [light, dark, grout] = TILE_PALETTE[style];
  ctx.fillStyle = grout;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const bevel = Math.max(1, Math.round(ppc / 10));
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const px = x * ppc;
      const py = y * ppc;
      const base = shade((x + y) % 2 ? dark : light, 0.94 + hash2(x, y, seed) * 0.12);
      // Inset by 1px of grout, then paint top face, highlight rim and shadow rim.
      ctx.fillStyle = base;
      ctx.fillRect(px + 1, py + 1, ppc - 2, ppc - 2);
      ctx.fillStyle = shade(base, 1.12);
      ctx.fillRect(px + 1, py + 1, ppc - 2, bevel);
      ctx.fillRect(px + 1, py + 1, bevel, ppc - 2);
      ctx.fillStyle = shade(base, 0.8);
      ctx.fillRect(px + 1, py + ppc - 1 - bevel, ppc - 2, bevel);
      ctx.fillRect(px + ppc - 1 - bevel, py + 1, bevel, ppc - 2);
      const roll = hash2(x, y, seed + 7);
      if (roll < 0.12) {
        // Pebbles: a few square "pixels" in warm stone tones.
        for (let k = 0; k < 3; k++) {
          ctx.fillStyle = shade(dark, 0.7 + hash2(x, y + k, seed + 9) * 0.2);
          const s = Math.max(2, Math.round(ppc / 9));
          ctx.fillRect(px + 3 + hash2(x + k, y, seed) * (ppc - 8), py + 3 + hash2(x, y + k, seed + 3) * (ppc - 8), s, s);
        }
      } else if (roll < 0.17 && style !== 'mine') {
        // Grass tuft creeping through the cracks.
        ctx.fillStyle = COLORS.leaf;
        const s = Math.max(2, Math.round(ppc / 8));
        const gx = px + 2 + hash2(x, y, seed + 11) * (ppc - 6);
        const gy = py + 2 + hash2(x, y, seed + 13) * (ppc - 6);
        ctx.fillRect(gx, gy, s, s * 2);
        ctx.fillRect(gx + s, gy + s, s, s);
        ctx.fillStyle = COLORS.leafDark;
        ctx.fillRect(gx - s, gy + s, s, s);
      }
    }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  // Crisp pixel edges up close; mipmaps keep it calm when zoomed out.
  texture.magFilter = THREE.NearestFilter;
  return texture;
}

/** Tileable normal map of soft sine ripples, scrolled over time to animate water. */
export function makeWaterNormalTexture(): THREE.DataTexture {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = (x / size) * Math.PI * 2;
      const v = (y / size) * Math.PI * 2;
      // Gradient of h = sin(2u + v) + 0.6 sin(u - 3v), packed into RGB.
      const dx = 2 * Math.cos(2 * u + v) + 0.6 * Math.cos(u - 3 * v);
      const dy = Math.cos(2 * u + v) - 1.8 * Math.cos(u - 3 * v);
      const n = new THREE.Vector3(-dx * 0.25, -dy * 0.25, 1).normalize();
      const o = (y * size + x) * 4;
      data[o] = (n.x * 0.5 + 0.5) * 255;
      data[o + 1] = (n.y * 0.5 + 0.5) * 255;
      data[o + 2] = (n.z * 0.5 + 0.5) * 255;
      data[o + 3] = 255;
    }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

/** Glowing hexagon outline for the selection marker. */
export function makeHexTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const hex = (r: number) => {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i + Math.PI / 6;
      const x = size / 2 + Math.cos(a) * r;
      const y = size / 2 + Math.sin(a) * r;
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    ctx.closePath();
  };
  // Soft outer glow via shadowBlur, a crisp rim, and a faint filled face.
  ctx.shadowColor = 'rgba(255,255,255,0.9)';
  ctx.shadowBlur = 14;
  ctx.strokeStyle = 'rgba(255,255,255,1)';
  ctx.lineWidth = 5;
  hex(48);
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  hex(46);
  ctx.fill();
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Night-ops sky: deep navy overhead fading to a faint blue horizon glow. */
export function makeSkyTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#070b14');
  g.addColorStop(0.65, '#0f1830');
  g.addColorStop(1, '#1a2744');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Repeating horizontal scanlines used as an alpha map on the coverage fog. */
export function makeScanlineTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 2;
  canvas.height = 4;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 2, 4);
  ctx.fillStyle = '#c4c4c4';
  ctx.fillRect(0, 0, 2, 1);
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  return t;
}

/** Soft radial sprite used for dust, glows and floor light pools. */
export function makeGlowTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Yellow/black hazard stripes for the staging zone. */
export function makeHazardTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#16140f';
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = '#e2b414';
  for (let i = -128; i < 256; i += 32) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + 16, 0);
    ctx.lineTo(i + 16 + 128, 128);
    ctx.lineTo(i + 128, 128);
    ctx.fill();
  }
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

let glow: THREE.CanvasTexture | null = null;
export function glowTexture(): THREE.CanvasTexture {
  if (!glow) glow = makeGlowTexture();
  return glow;
}

let hexTex: THREE.CanvasTexture | null = null;
export function hexTexture(): THREE.CanvasTexture {
  if (!hexTex) hexTex = makeHexTexture();
  return hexTex;
}
