/**
 * UI state store. The SimulationEngine instance lives here but is mutated only
 * through engine.tick() and engine.issue(); React re-renders on `version`.
 */
import { create } from 'zustand';
import {
  SimulationEngine,
  defaultOptions,
  demoOptions,
  type Command,
  type EngineOptions,
} from '../simulation/core/SimulationEngine';
import type { MissionStatus, OperationMode } from '../simulation/core/types';
import type { PresetId } from '../simulation/world/ScenarioGenerator';

export type Quality = 'low' | 'medium' | 'high';
export type Speed = 0.5 | 1 | 2 | 4;

export interface Settings {
  preset: PresetId;
  seed: number;
  rovers: number;
  drones: number;
  packetLoss: number; // 0..0.3
  delayMax: number; // delay range is [1, delayMax]
  partition: boolean;
  sensorNoise: boolean;
  networkEnabled: boolean;
  fog: number; // 0..1
  quality: Quality;
  speed: Speed;
  mode: OperationMode;
}

export interface Overlays {
  links: boolean;
  graph: boolean;
  packets: boolean;
  ranges: boolean;
  paths: boolean;
  evidence: boolean;
  coverage: boolean;
  truth: boolean;
  netLog: boolean;
  labels: boolean;
}

/** Simulation ticks per second at 1x speed. One tick = one second of mission time. */
export const TICKS_PER_SECOND = 4;

/** Mutable render clock shared with the 3D scene (avoids React re-renders per frame). */
export const simClock = { alpha: 1, lastTickAt: 0 };

interface Store {
  settings: Settings;
  overlays: Overlays;
  engine: SimulationEngine;
  status: MissionStatus;
  selected: string | null;
  version: number;
  demo: boolean;
  /** Camera focus request: robot name plus a counter so repeat clicks re-trigger. */
  focus: { robot: string; nonce: number } | null;
  focusOn: (robot: string) => void;
  setSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  toggleOverlay: (key: keyof Overlays) => void;
  launch: () => void;
  pause: () => void;
  resume: () => void;
  reset: () => void;
  randomizeSeed: () => void;
  loadDemo: () => void;
  select: (name: string | null) => void;
  issue: (command: Command) => void;
  advance: (ticks: number) => void;
}

const initialSettings: Settings = {
  preset: 'office',
  seed: 7,
  rovers: 2,
  drones: 2,
  packetLoss: 0.05,
  delayMax: 2,
  partition: false,
  sensorNoise: true,
  networkEnabled: true,
  fog: 0.5,
  quality: 'medium',
  speed: 1,
  mode: 'autonomous',
};

function optionsFrom(s: Settings, demo: boolean, selected: string | null): EngineOptions {
  if (demo) return { ...demoOptions(s.seed), sensorNoise: s.sensorNoise, mode: s.mode, manualRobot: selected };
  return defaultOptions({
    preset: s.preset,
    seed: s.seed,
    rovers: s.rovers,
    drones: s.drones,
    packetLoss: s.packetLoss,
    delaySteps: [1, s.delayMax],
    networkEnabled: s.networkEnabled,
    sensorNoise: s.sensorNoise,
    mode: s.mode,
    manualRobot: selected,
  });
}

/** Settings that only take effect on a fresh world. */
const WORLD_KEYS: Array<keyof Settings> = ['preset', 'seed', 'rovers', 'drones', 'sensorNoise', 'networkEnabled'];

export const useSim = create<Store>((set, get) => ({
  settings: initialSettings,
  overlays: {
    links: true,
    graph: false,
    packets: true,
    ranges: false,
    paths: true,
    evidence: true,
    coverage: true,
    truth: false,
    netLog: false,
    labels: true,
  },
  engine: new SimulationEngine(optionsFrom(initialSettings, false, null)),
  status: 'ready',
  selected: null,
  version: 0,
  demo: false,
  focus: null,
  focusOn: (robot) => set({ focus: { robot, nonce: (get().focus?.nonce ?? 0) + 1 } }),

  setSetting: (key, value) => {
    const { settings, status, engine, selected } = get();
    const next = { ...settings, [key]: value };
    if (key === 'rovers' || key === 'drones') {
      const total = next.rovers + next.drones;
      if (total < 1 || total > 10) return;
    }
    if (WORLD_KEYS.includes(key)) {
      if (status !== 'ready') return;
      const demo = key === 'preset' ? false : get().demo;
      set({ settings: next, demo, engine: new SimulationEngine(optionsFrom(next, demo, null)), selected: null, version: get().version + 1 });
      return;
    }
    set({ settings: next });
    // Live network/mode settings become recorded engine commands.
    if (key === 'packetLoss') engine.issue({ kind: 'setPacketLoss', value: value as number });
    if (key === 'delayMax') engine.issue({ kind: 'setDelay', value: [1, value as number] });
    if (key === 'partition') {
      const target = selected ?? engine.robots[0]?.name;
      engine.issue({ kind: 'setPartition', on: value as boolean, robots: target ? [target] : [] });
    }
    if (key === 'mode') {
      const manualRobot = selected ?? (value === 'autonomous' ? null : engine.robots[0]?.name ?? null);
      if (value !== 'autonomous' && !selected && manualRobot) set({ selected: manualRobot });
      // Before launch the command stays queued and applies on the first tick.
      engine.issue({ kind: 'setMode', mode: value as OperationMode, manualRobot });
    }
    set({ version: get().version + 1 });
  },

  toggleOverlay: (key) => set({ overlays: { ...get().overlays, [key]: !get().overlays[key] } }),

  launch: () => {
    if (get().status === 'ready') set({ status: 'running' });
  },
  pause: () => {
    if (get().status === 'running') set({ status: 'paused' });
  },
  resume: () => {
    if (get().status === 'paused') set({ status: 'running' });
  },
  reset: () => {
    const { settings, demo } = get();
    set({
      engine: new SimulationEngine(optionsFrom({ ...settings, partition: false, mode: settings.mode }, demo, null)),
      status: 'ready',
      selected: null,
      settings: { ...settings, partition: false },
      version: get().version + 1,
    });
  },
  randomizeSeed: () => {
    if (get().status !== 'ready') return;
    get().setSetting('seed', Math.floor(Math.random() * 100000));
  },
  loadDemo: () => {
    const settings: Settings = {
      ...get().settings,
      preset: 'demo',
      seed: 11,
      rovers: 2,
      drones: 2,
      packetLoss: 0.15,
      delayMax: 3,
      partition: false,
      networkEnabled: true,
      mode: 'autonomous',
    };
    set({
      settings,
      demo: true,
      engine: new SimulationEngine(optionsFrom(settings, true, null)),
      status: 'ready',
      selected: null,
      version: get().version + 1,
    });
  },
  select: (name) => {
    const { engine, settings } = get();
    set({ selected: name });
    // In mixed mode the selected robot becomes the manually driven one.
    if (settings.mode === 'mixed' && name) engine.issue({ kind: 'setMode', mode: 'mixed', manualRobot: name });
    if (settings.mode === 'manual' && name) engine.issue({ kind: 'setMode', mode: 'manual', manualRobot: name });
    set({ version: get().version + 1 });
  },
  issue: (command) => {
    get().engine.issue(command);
  },
  advance: (ticks) => {
    const { engine, status } = get();
    if (status !== 'running' || ticks <= 0) return;
    for (let i = 0; i < ticks && !engine.done; i++) engine.tick();
    set({ version: get().version + 1, status: engine.done ? 'complete' : 'running' });
  },
}));
