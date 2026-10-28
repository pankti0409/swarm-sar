import { useSim } from '../store/simStore';
import { robotConnection } from '../app/format';

const SIZE = 168;
const PAD = 16;
const EDGE = { healthy: 'var(--good)', weak: 'var(--warn)', down: 'var(--bad)' } as const;

/** Optional 2D network graph: robots as nodes at their site positions, live links as edges. */
export function NetworkGraph() {
  useSim((s) => s.version);
  const engine = useSim((s) => s.engine);
  const selected = useSim((s) => s.selected);
  const select = useSim((s) => s.select);
  const { width, height } = engine.scenario;
  const scale = (SIZE - PAD * 2) / Math.max(width, height);
  const w = width * scale + PAD * 2;
  const h = height * scale + PAD * 2;
  const pos = new Map(engine.robots.map((r) => [r.name, { x: PAD + (r.x + 0.5) * scale, y: PAD + (r.y + 0.5) * scale }]));
  const isolated = engine.network.isolatedAgents(engine.step);
  // Only links measured this tick; a partitioned link is drawn dashed red, out-of-range links are omitted.
  const edges = [...engine.network.links.values()].filter((l) => l.step === engine.step && (l.health !== 'down' || l.reason === 'partition'));

  return (
    <div className="net-graph">
      <div className="net-graph-title">Network graph</div>
      {!engine.network.enabled ? (
        <div className="faint small">Radio disabled</div>
      ) : (
        <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Robot communication graph">
          <rect x={PAD / 2} y={PAD / 2} width={w - PAD} height={h - PAD} rx={4} className="net-graph-site" />
          {edges.map((l) => {
            const a = pos.get(l.a);
            const b = pos.get(l.b);
            if (!a || !b) return null;
            return (
              <line
                key={`${l.a}|${l.b}`}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={EDGE[l.health]}
                strokeWidth={l.health === 'healthy' ? 1.8 : 1.3}
                strokeDasharray={l.health === 'down' ? '3 3' : undefined}
                opacity={0.9}
              />
            );
          })}
          {engine.robots.map((r) => {
            const p = pos.get(r.name)!;
            const tone = robotConnection(engine, r).tone;
            return (
              <g key={r.name} className="net-graph-node" onClick={() => select(r.name)}>
                <title>{`${r.label}: ${robotConnection(engine, r).label}`}</title>
                {isolated.has(r.name) && <circle cx={p.x} cy={p.y} r={9} className="net-graph-isolated" />}
                {r.type === 'drone' ? (
                  <rect x={p.x - 4.5} y={p.y - 4.5} width={9} height={9} transform={`rotate(45 ${p.x} ${p.y})`} className={`tone-fill-${tone}`} />
                ) : (
                  <circle cx={p.x} cy={p.y} r={5} className={`tone-fill-${tone}`} />
                )}
                {selected === r.name && <circle cx={p.x} cy={p.y} r={8} className="net-graph-selected" />}
                <text x={p.x} y={p.y - 9} textAnchor="middle">
                  {r.label.replace('Rover ', 'R').replace('Drone ', 'D')}
                </text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}
