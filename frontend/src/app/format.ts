import type { SimulationEngine } from '../simulation/core/SimulationEngine';
import type { RobotState } from '../simulation/robots/RobotState';

/** One simulation tick represents one second of mission time. */
export function missionTime(step: number): string {
  const m = Math.floor(step / 60);
  const s = step % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export type HealthTone = 'good' | 'warn' | 'bad' | 'off';

export function networkHealth(engine: SimulationEngine): { label: string; tone: HealthTone; detail: string } {
  if (!engine.network.enabled) return { label: 'Offline', tone: 'off', detail: 'Radio disabled — robots work alone' };
  const alive = engine.robots.filter((r) => r.alive).length;
  if (alive <= 1) return { label: 'Solo', tone: 'off', detail: 'Only one robot active' };
  const connected = engine.connectedRobots();
  const ratio = connected / alive;
  const detail = `${connected} of ${alive} robots in radio contact`;
  if (ratio >= 0.99) return { label: 'Healthy', tone: 'good', detail };
  if (ratio >= 0.5) return { label: 'Degraded', tone: 'warn', detail };
  if (engine.network.isolatedAgents(engine.step).size) return { label: 'Critical', tone: 'bad', detail: `${detail} · partition active` };
  return { label: 'Sparse', tone: 'warn', detail: `${detail} · robots spread beyond radio range` };
}

export function swarmIntent(engine: SimulationEngine): string {
  const counts = { explore: 0, investigate: 0, hold: 0, manual: 0, depleted: 0, peer: 0 };
  for (const r of engine.robots) {
    const o = r.objective;
    if (o.kind === 'explore') {
      if (o.followingPeerEvidence) counts.peer++;
      else counts.explore++;
    } else if (o.kind === 'investigate') counts.investigate++;
    else if (o.kind === 'manual') counts.manual++;
    else if (o.kind === 'depleted') counts.depleted++;
    else counts.hold++;
  }
  const parts: string[] = [];
  if (counts.investigate) parts.push(`${counts.investigate} checking a possible survivor`);
  if (counts.peer) parts.push(`${counts.peer} converging on a teammate's heat report`);
  if (counts.explore) parts.push(`${counts.explore} exploring unmapped areas`);
  if (counts.manual) parts.push(`${counts.manual} under operator control`);
  if (counts.hold) parts.push(`${counts.hold} holding`);
  if (counts.depleted) parts.push(`${counts.depleted} out of battery`);
  return parts.join(' · ') || 'Standing by at the staging area';
}

export const pct = (v: number, digits = 0) => `${(v * 100).toFixed(digits)}%`;

export const batteryPct = (r: RobotState) => Math.round((r.battery / r.maxBattery) * 100);

/** Fill width plus the full-track gradient size (--full) so the bar's tip shows the level colour. */
export const batteryFillStyle = (p: number) =>
  ({ width: `${p}%`, '--full': `${p > 0 ? (100 / p) * 100 : 100}%` }) as React.CSSProperties;

export function robotConnection(engine: SimulationEngine, r: RobotState): { label: string; tone: HealthTone } {
  if (!engine.network.enabled) return { label: 'Radio off', tone: 'off' };
  if (!r.alive) return { label: 'Offline', tone: 'off' };
  if (engine.network.isolatedAgents(engine.step).has(r.name)) return { label: 'Partitioned', tone: 'bad' };
  const links = engine.linksFor(r.name);
  const up = links.filter((l) => l.health !== 'down');
  if (!up.length) return { label: 'No peers in range', tone: 'bad' };
  if (up.some((l) => l.health === 'healthy')) return { label: `${up.length} peer${up.length > 1 ? 's' : ''} linked`, tone: 'good' };
  return { label: `${up.length} weak link${up.length > 1 ? 's' : ''}`, tone: 'warn' };
}
