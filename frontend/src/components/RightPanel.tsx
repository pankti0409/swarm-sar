import { useSim } from '../store/simStore';
import type { SimulationEngine } from '../simulation/core/SimulationEngine';
import type { RobotState } from '../simulation/robots/RobotState';
import { describeObjective } from '../simulation/telemetry/HumanReadableEventFormatter';
import { ROVER_DESCRIPTION } from '../simulation/robots/RoverRobot';
import { DRONE_DESCRIPTION } from '../simulation/robots/DroneRobot';
import { maxThermal } from '../simulation/sensing/SensorModel';
import { UNKNOWN } from '../simulation/world/GridMap';
import { batteryFillStyle, batteryPct, robotConnection } from '../app/format';
import { MiniMap } from './MiniMap';

function Battery({ robot }: { robot: RobotState }) {
  const p = batteryPct(robot);
  return (
    <div className="battery" title={`${p}% battery`}>
      <div className="battery-track">
        <div className="battery-fill" style={batteryFillStyle(p)} />
      </div>
      <span>{p}%</span>
    </div>
  );
}

function FleetCard({ engine, robot }: { engine: SimulationEngine; robot: RobotState }) {
  const select = useSim((s) => s.select);
  const conn = robotConnection(engine, robot);
  return (
    <button className={`fleet-card ${robot.type} ${robot.alive ? '' : 'dead'}`} onClick={() => select(robot.name)}>
      <div className="fleet-head">
        <span className={`type-icon ${robot.type}`} aria-hidden />
        <strong>{robot.label}</strong>
        {robot.manual && <span className="pill manual">Manual</span>}
        <span className={`conn-dot ${conn.tone}`} title={conn.label} />
      </div>
      <div className="fleet-objective">{describeObjective(robot.objective)}</div>
      <Battery robot={robot} />
    </button>
  );
}

function SensorBars({ robot }: { robot: RobotState }) {
  const sectors = ['N', 'E', 'S', 'W'];
  return (
    <div className="sensors">
      <div className="sensor-row">
        <span className="sensor-name">Heat</span>
        <div className="sector-bars">
          {robot.thermal.map((v, i) => (
            <div key={i} className="sector" title={`${sectors[i]} ${v.toFixed(2)}`}>
              <div className="sector-fill heat" style={{ height: `${Math.min(100, (v / 0.6) * 100)}%` }} />
              <span>{sectors[i]}</span>
            </div>
          ))}
        </div>
        <span className="sensor-val">{maxThermal(robot.thermal) >= 0.32 ? 'Strong' : maxThermal(robot.thermal) >= 0.16 ? 'Weak' : 'None'}</span>
      </div>
      <div className="sensor-row">
        <span className="sensor-name">Sound</span>
        <div className="meter">
          <div className="meter-fill sound" style={{ width: `${Math.min(100, (robot.acoustic / 0.6) * 100)}%` }} />
        </div>
        <span className="sensor-val">{robot.acoustic >= 0.2 ? 'Heard' : 'Quiet'}</span>
      </div>
    </div>
  );
}

function RobotDetail({ engine, robot, version }: { engine: SimulationEngine; robot: RobotState; version: number }) {
  const select = useSim((s) => s.select);
  const mode = useSim((s) => s.settings.mode);
  const issue = useSim((s) => s.issue);
  const conn = robotConnection(engine, robot);
  const received = [...(engine.network.recentReceived.get(robot.name) ?? [])].reverse().slice(0, 6);
  const links = engine.linksFor(robot.name);
  const known = robot.belief.cells.length - robot.belief.count(UNKNOWN);
  const brain = engine.controller.brains.get(robot.name);
  const remaining = robot.path.length ? robot.path.length - 1 : 0;
  const canDrive = mode !== 'autonomous' && robot.manual && robot.alive;

  return (
    <div className="robot-detail">
      <div className="detail-head">
        <span className={`type-icon big ${robot.type}`} aria-hidden />
        <div>
          <h2>{robot.label}</h2>
          <div className="faint">{robot.type === 'rover' ? 'Ground rover' : 'Quadcopter drone'} · id {robot.name}</div>
        </div>
        <button className="btn ghost small" onClick={() => useSim.getState().focusOn(robot.name)} title="Move the camera to this robot">
          Focus
        </button>
        <button className="btn ghost small" onClick={() => select(null)} aria-label="Back to fleet">
          ✕
        </button>
      </div>

      <div className="objective-card">
        <div className="label">Current objective</div>
        <div className="objective">{describeObjective(robot.objective)}</div>
        {remaining > 0 && (
          <div className="faint">
            {remaining} cell{remaining > 1 ? 's' : ''} to {robot.manual ? 'waypoint' : 'goal'}
            {robot.activeGoal && ` (${robot.activeGoal.x}, ${robot.activeGoal.y})`}
          </div>
        )}
      </div>

      <div className="kv">
        <span>Battery</span>
        <Battery robot={robot} />
        <span>Network</span>
        <span className={`tone-${conn.tone}`}>{conn.label}</span>
        <span>Map known</span>
        <span>{known} cells (own + shared)</span>
      </div>

      {canDrive && (
        <div className="drive">
          <div className="label">Manual control</div>
          <div className="dpad">
            <button onClick={() => issue({ kind: 'manualStep', robot: robot.name, direction: 1 })} aria-label="Up">▲</button>
            <button onClick={() => issue({ kind: 'manualStep', robot: robot.name, direction: 3 })} aria-label="Left">◀</button>
            <button onClick={() => issue({ kind: 'manualStop', robot: robot.name })} aria-label="Stop">■</button>
            <button onClick={() => issue({ kind: 'manualStep', robot: robot.name, direction: 4 })} aria-label="Right">▶</button>
            <button onClick={() => issue({ kind: 'manualStep', robot: robot.name, direction: 2 })} aria-label="Down">▼</button>
          </div>
          <button className="btn small" onClick={() => issue({ kind: 'manualScan', robot: robot.name })}>
            Scan here (confirm survivor)
          </button>
          <p className="faint small">Click the floor to set a waypoint. Keys: arrows/WASD, E scan, X stop.</p>
        </div>
      )}

      <div className="block">
        <div className="label">Sensors</div>
        <SensorBars robot={robot} />
      </div>

      <div className="block">
        <div className="label">
          Private map <span className="faint">— what {robot.label} believes</span>
        </div>
        <MiniMap engine={engine} robot={robot} version={version} />
        <div className="legend-row faint small">
          <span className="sw free" /> free <span className="sw wall" /> wall <span className="sw rubble" /> rubble <span className="sw unk" /> unknown ○ teammate (last report)
        </div>
      </div>

      <div className="block">
        <div className="label">Communication peers</div>
        {!engine.network.enabled && <div className="faint">Radio disabled</div>}
        <ul className="peers">
          {engine.robots
            .filter((r) => r.name !== robot.name)
            .map((peer) => {
              const link = links.find((l) => l.a === peer.name || l.b === peer.name);
              const health = link?.health ?? 'down';
              const reason = link && link.health === 'down' ? (link.reason === 'range' ? 'out of range' : link.reason === 'wall' ? 'blocked by walls' : link.reason) : null;
              return (
                <li key={peer.name}>
                  <span className={`conn-dot ${health === 'healthy' ? 'good' : health === 'weak' ? 'warn' : 'bad'}`} />
                  {peer.label}
                  <span className="faint">{health === 'down' ? reason ?? 'no link' : health === 'weak' ? 'weak / lossy' : 'healthy'}</span>
                </li>
              );
            })}
        </ul>
      </div>

      <div className="block">
        <div className="label">Recently received</div>
        {!received.length && <div className="faint small">Nothing received yet.</div>}
        <ul className="received">
          {received.map((m) => (
            <li key={`${m.senderId}:${m.sequence}`}>
              <strong>{engine.label(m.senderId)}</strong>
              <span className="faint"> · {engine.step - m.sentStep} s ago</span>
              <div className="small">
                {m.mapCells.length ? `${m.mapCells.length} map cells${m.isSnapshot ? ' (recovery snapshot)' : ''}` : 'position update'}
                {m.claimedGoal && ` · heading to (${m.claimedGoal[0]}, ${m.claimedGoal[1]})`}
                {m.evidence.thermal >= 0.35 && ' · heat report'}
              </div>
            </li>
          ))}
        </ul>
      </div>

      <details className="advanced">
        <summary>Advanced</summary>
        <div className="kv mono small">
          <span>Odometry pose</span>
          <span>
            ({robot.odomX.toFixed(2)}, {robot.odomY.toFixed(2)})
          </span>
          <span>Pose uncertainty</span>
          <span>{robot.odomUncertainty.toFixed(3)}</span>
          <span>Brain goal</span>
          <span>{brain?.localGoal ? `(${brain.localGoal.x}, ${brain.localGoal.y})` : '—'}</span>
          <span>Next seq</span>
          <span>{engine.network.nextSeq.get(robot.name) ?? 0}</span>
          <span>Thermal N/E/S/W</span>
          <span>{robot.thermal.map((v) => v.toFixed(2)).join(' / ')}</span>
          <span>Acoustic</span>
          <span>{robot.acoustic.toFixed(3)}</span>
          <span>Vision / radio</span>
          <span>
            {robot.config.visionRadius} / {robot.config.commRadius} cells
          </span>
          <span>Distance moved</span>
          <span>{robot.distanceTravelled} cells</span>
          <span>Last action</span>
          <span>{['hold', 'up', 'down', 'left', 'right'][robot.lastAction]}</span>
        </div>
        <p className="faint small">{robot.type === 'rover' ? ROVER_DESCRIPTION : DRONE_DESCRIPTION}</p>
      </details>
    </div>
  );
}

export function RightPanel() {
  const version = useSim((s) => s.version);
  const engine = useSim((s) => s.engine);
  const selected = useSim((s) => s.selected);
  const robot = selected ? engine.robots.find((r) => r.name === selected) : null;
  return (
    <aside className="panel right">
      {robot ? (
        <RobotDetail engine={engine} robot={robot} version={version} />
      ) : (
        <>
          <h3 className="panel-title">Fleet overview</h3>
          <p className="faint small">Click a robot card or a robot in the scene for details.</p>
          <div className="fleet">
            {engine.robots.map((r) => (
              <FleetCard key={r.name} engine={engine} robot={r} />
            ))}
          </div>
        </>
      )}
    </aside>
  );
}
