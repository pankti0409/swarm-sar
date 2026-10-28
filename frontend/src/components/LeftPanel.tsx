import type { ReactNode } from 'react';
import { useSim, type Overlays, type Quality, type Speed } from '../store/simStore';
import { PRESETS, type PresetId } from '../simulation/world/ScenarioGenerator';
import type { OperationMode } from '../simulation/core/types';

function Section({ title, children, hint }: { title: string; children: ReactNode; hint?: string }) {
  return (
    <section className="section">
      <h3>
        {title}
        {hint && <span className="hint">{hint}</span>}
      </h3>
      {children}
    </section>
  );
}

function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  disabled,
}: {
  value: T;
  options: Array<{ value: T; label: string; title?: string }>;
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className={`segmented ${disabled ? 'disabled' : ''}`} role="radiogroup">
      {options.map((o) => (
        <button
          key={String(o.value)}
          role="radio"
          aria-checked={o.value === value}
          className={o.value === value ? 'on' : ''}
          title={o.title}
          disabled={disabled}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({ label, checked, onChange, disabled, danger, title }: { label: string; checked: boolean; onChange: () => void; disabled?: boolean; danger?: boolean; title?: string }) {
  return (
    <label className={`toggle ${danger ? 'danger' : ''} ${disabled ? 'disabled' : ''}`} title={title}>
      <input type="checkbox" checked={checked} onChange={onChange} disabled={disabled} />
      <span className="track">
        <span className="thumb" />
      </span>
      <span className="toggle-label">{label}</span>
    </label>
  );
}

function Stepper({ label, value, onChange, min, max, disabled, icon }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number; disabled?: boolean; icon: string }) {
  return (
    <div className={`stepper ${disabled ? 'disabled' : ''}`}>
      <span className={`stepper-icon ${icon}`} aria-hidden />
      <span className="stepper-label">{label}</span>
      <button aria-label={`Fewer ${label}`} disabled={disabled || value <= min} onClick={() => onChange(value - 1)}>
        −
      </button>
      <span className="stepper-value">{value}</span>
      <button aria-label={`More ${label}`} disabled={disabled || value >= max} onClick={() => onChange(value + 1)}>
        +
      </button>
    </div>
  );
}

export function LeftPanel() {
  const settings = useSim((s) => s.settings);
  const overlays = useSim((s) => s.overlays);
  const status = useSim((s) => s.status);
  const demo = useSim((s) => s.demo);
  const selected = useSim((s) => s.selected);
  const engine = useSim((s) => s.engine);
  const { setSetting, toggleOverlay, launch, pause, resume, reset, randomizeSeed, loadDemo } = useSim.getState();
  const locked = status !== 'ready';
  const total = settings.rovers + settings.drones;
  const partitionTarget = selected ? engine.label(selected) : engine.robots[0]?.label ?? '—';

  const overlayToggles: Array<[keyof Overlays, string]> = [
    ['links', 'Network links'],
    ['graph', 'Network graph overlay'],
    ['packets', 'Packet pulses'],
    ['ranges', 'Radio ranges'],
    ['paths', 'Planned paths'],
    ['evidence', 'Heat & sound evidence'],
    ['coverage', 'Unexplored fog / local map'],
    ['labels', 'Robot labels'],
  ];

  return (
    <aside className="panel left">
      <Section title="Mission">
        <div className="mission-buttons">
          {status === 'ready' && (
            <button className="btn primary" onClick={launch}>
              ▶ Launch mission
            </button>
          )}
          {status === 'running' && (
            <button className="btn" onClick={pause}>
              ❚❚ Pause
            </button>
          )}
          {status === 'paused' && (
            <button className="btn primary" onClick={resume}>
              ▶ Resume
            </button>
          )}
          {status === 'complete' && <div className="complete-note">Mission complete</div>}
          <button className="btn ghost" onClick={reset} disabled={status === 'ready' && engine.step === 0}>
            ↺ Reset
          </button>
        </div>
        <label className="field-label">Speed</label>
        <Segmented<Speed>
          value={settings.speed}
          onChange={(v) => setSetting('speed', v)}
          options={[0.5, 1, 2, 4].map((v) => ({ value: v as Speed, label: `${v}×` }))}
        />
        <label className="field-label">Operation mode</label>
        <Segmented<OperationMode>
          value={settings.mode}
          onChange={(v) => setSetting('mode', v)}
          options={[
            { value: 'autonomous', label: 'Auto', title: 'Decentralized Autonomous Mode for every robot' },
            { value: 'manual', label: 'Manual', title: 'Operator drives the selected robot; others hold' },
            { value: 'mixed', label: 'Mixed', title: 'Operator drives the selected robot; others stay autonomous' },
          ]}
        />
        <p className="explain">
          {settings.mode === 'autonomous'
            ? 'Decentralized Autonomous Mode: every robot plans from its own map and the messages it actually receives.'
            : settings.mode === 'manual'
              ? 'Select a robot, then click the floor or use arrow keys. All moves pass the collision-safety layer.'
              : 'Select a robot to drive it; the rest of the swarm keeps working autonomously.'}
        </p>
      </Section>

      <Section title="Scenario" hint={locked ? 'Reset to change' : undefined}>
        <label className="field-label">Disaster site</label>
        <select
          value={demo ? 'demo' : settings.preset}
          disabled={locked}
          onChange={(e) => setSetting('preset', e.target.value as PresetId)}
        >
          {PRESETS.filter((p) => p.id !== 'demo').map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
          {demo && <option value="demo">Validation Demo</option>}
        </select>
        <label className="field-label">Map seed</label>
        <div className="seed-row">
          <input
            type="number"
            value={settings.seed}
            disabled={locked}
            onChange={(e) => setSetting('seed', Math.max(0, Math.floor(Number(e.target.value) || 0)))}
          />
          <button className="btn icon" onClick={randomizeSeed} disabled={locked} title="Random seed" aria-label="Random seed">
            🎲
          </button>
        </div>
        <label className="field-label">
          Team <span className="faint">({total} of max 10)</span>
        </label>
        <Stepper label="Rovers" icon="rover" value={settings.rovers} min={0} max={10 - settings.drones} disabled={locked || demo} onChange={(v) => setSetting('rovers', v)} />
        <Stepper label="Drones" icon="drone" value={settings.drones} min={0} max={10 - settings.rovers} disabled={locked || demo} onChange={(v) => setSetting('drones', v)} />
        <Toggle label="Sensor noise & false alarms" checked={settings.sensorNoise} disabled={locked} onChange={() => setSetting('sensorNoise', !settings.sensorNoise)} />
        <button className="btn demo" onClick={loadDemo} disabled={locked}>
          ★ Load validation demo
        </button>
      </Section>

      <Section title="Radio network">
        <Toggle label="Peer-to-peer radio" checked={settings.networkEnabled} disabled={locked || demo} onChange={() => setSetting('networkEnabled', !settings.networkEnabled)} />
        <label className="field-label">
          Packet loss <span className="value">{Math.round(settings.packetLoss * 100)}%</span>
        </label>
        <input type="range" min={0} max={30} step={1} value={Math.round(settings.packetLoss * 100)} onChange={(e) => setSetting('packetLoss', Number(e.target.value) / 100)} />
        <label className="field-label">
          Message delay <span className="value">1–{settings.delayMax} ticks</span>
        </label>
        <input type="range" min={1} max={6} step={1} value={settings.delayMax} onChange={(e) => setSetting('delayMax', Number(e.target.value))} />
        <Toggle
          label={`Partition ${partitionTarget}`}
          title="Cut the selected robot (or Rover 1) off from every teammate"
          checked={settings.partition}
          danger
          disabled={!settings.networkEnabled}
          onChange={() => setSetting('partition', !settings.partition)}
        />
      </Section>

      <Section title="View">
        <label className="field-label">Graphics quality</label>
        <Segmented<Quality>
          value={settings.quality}
          onChange={(v) => setSetting('quality', v)}
          options={[
            { value: 'low', label: 'Low' },
            { value: 'medium', label: 'Medium' },
            { value: 'high', label: 'High' },
          ]}
        />
        <label className="field-label">
          Smoke & dust <span className="value">{Math.round(settings.fog * 100)}%</span>
        </label>
        <input type="range" min={0} max={100} value={Math.round(settings.fog * 100)} onChange={(e) => setSetting('fog', Number(e.target.value) / 100)} />
        <div className="toggles">
          {overlayToggles.map(([key, label]) => (
            <Toggle key={key} label={label} checked={overlays[key]} onChange={() => toggleOverlay(key)} />
          ))}
          <Toggle label="Truth map — Debug Only" danger checked={overlays.truth} onChange={() => toggleOverlay('truth')} title="Reveals hidden survivors. Never used by the robots." />
        </div>
      </Section>
    </aside>
  );
}
