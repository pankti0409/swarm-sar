import { useSim } from '../store/simStore';
import { swarmIntent } from '../app/format';
import { PRESETS } from '../simulation/world/ScenarioGenerator';
import { NetworkGraph } from './NetworkGraph';

/** Overlay on the 3D view: what happened, what the swarm is doing, and a legend. */
export function SceneHud() {
  useSim((s) => s.version);
  const engine = useSim((s) => s.engine);
  const status = useSim((s) => s.status);
  const truth = useSim((s) => s.overlays.truth);
  const graph = useSim((s) => s.overlays.graph);
  const mode = useSim((s) => s.settings.mode);
  const selected = useSim((s) => s.selected);
  const launch = useSim((s) => s.launch);
  const disaster = PRESETS.find((p) => p.id === engine.scenario.preset)?.disaster;
  const manualRobot = selected ? engine.robots.find((r) => r.name === selected && r.manual) : null;

  return (
    <div className="hud">
      <div className="brief">
        <div className="brief-kicker">{engine.scenario.name}</div>
        <div className="brief-text">{disaster}</div>
        <div className="brief-intent">
          <span className="label">Swarm now</span> {swarmIntent(engine)}
        </div>
        <div className="brief-mode">
          {mode === 'autonomous' ? 'Decentralized Autonomous Mode' : mode === 'manual' ? 'Manual mode' : 'Mixed mode'}
        </div>
      </div>

      {truth && <div className="debug-banner">DEBUG ONLY — ground-truth survivors visible. Robots never see this.</div>}

      {status === 'ready' && (
        <div className="launch-card">
          <div className="launch-title">{engine.robots.length} robots at the staging area</div>
          <div className="faint">{engine.scenario.victims.length > 0 ? 'Survivor locations are unknown.' : ''} Configure the mission on the left, then launch.</div>
          <button className="btn primary" onClick={launch}>
            ▶ Launch mission
          </button>
        </div>
      )}

      {status === 'complete' && (
        <div className="launch-card done">
          <div className="launch-title">
            {engine.doneReason === 'all_found' ? 'All survivors located' : engine.doneReason === 'timeout' ? 'Mission time limit reached' : 'All robots out of battery'}
          </div>
          <div>
            {engine.survivorsFound()} of {engine.scenario.victims.length} survivors found · {Math.round(engine.coverage() * 100)}% of the site mapped · {engine.collisions}{' '}
            collisions
          </div>
        </div>
      )}

      {manualRobot && status !== 'complete' && (
        <div className="manual-hint">
          Driving <strong>{manualRobot.label}</strong> — click the floor for a waypoint, arrows/WASD to step, E to scan.
        </div>
      )}

      {graph && <NetworkGraph />}

      <div className="legend">
        <div>
          <span className="lg-line healthy" /> healthy link
        </div>
        <div>
          <span className="lg-line weak" /> weak / lossy
        </div>
        <div>
          <span className="lg-line down" /> lost / partitioned
        </div>
        <div>
          <span className="lg-dot heat" /> heat estimate
        </div>
        <div>
          <span className="lg-dot sound" /> sound heard
        </div>
        <div>
          <span className="lg-dot survivor" /> confirmed survivor
        </div>
      </div>
    </div>
  );
}
