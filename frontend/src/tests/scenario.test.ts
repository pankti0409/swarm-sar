import { PRESETS, generateScenario, scenarioFingerprint } from '../simulation/world/ScenarioGenerator';
import { FREE, RUBBLE, WALL, bfsDistances } from '../simulation/world/GridMap';

describe('ScenarioGenerator', () => {
  it.each(PRESETS.map((p) => p.id))('same seed gives the same %s scenario', (preset) => {
    const a = generateScenario({ preset, seed: 42 });
    const b = generateScenario({ preset, seed: 42 });
    expect(scenarioFingerprint(a)).toBe(scenarioFingerprint(b));
    expect(Array.from(a.material)).toEqual(Array.from(b.material));
    expect(a.props).toEqual(b.props);
  });

  it('different seeds give different scenarios', () => {
    const a = generateScenario({ preset: 'random', seed: 1 });
    const b = generateScenario({ preset: 'random', seed: 2 });
    expect(scenarioFingerprint(a)).not.toBe(scenarioFingerprint(b));
  });

  it('produces both portrait and landscape maps', () => {
    const shapes = new Set<string>();
    for (let seed = 0; seed < 16; seed++) {
      const s = generateScenario({ preset: 'random', seed });
      shapes.add(s.height > s.width ? 'portrait' : 'landscape');
    }
    expect(shapes).toEqual(new Set(['portrait', 'landscape']));
  });

  it('earthquake apartment has a broken stairwell between its corridors', () => {
    for (let seed = 0; seed < 4; seed++) {
      const s = generateScenario({ preset: 'apartment', seed });
      expect(s.stairwell).not.toBeNull();
      const { x, y0, y1 } = s.stairwell!;
      // Broken flights are rubble; later collapse damage may seal a few cells, but most stay passable.
      let rubble = 0;
      let open = 0;
      for (let y = y0; y <= y1; y++)
        for (const cx of [x, x + 1]) {
          if (s.grid.get(cx, y) === RUBBLE) rubble++;
          if (s.grid.get(cx, y) !== WALL) open++;
        }
      expect(rubble).toBeGreaterThan(0);
      expect(open).toBeGreaterThan((y1 - y0 + 1) * 2 * 0.6);
    }
    expect(generateScenario({ preset: 'office', seed: 0 }).stairwell).toBeNull();
  });

  it.each(PRESETS.map((p) => p.id))('%s places reachable, separated survivors away from spawn', (preset) => {
    for (let seed = 0; seed < 6; seed++) {
      const s = generateScenario({ preset, seed });
      const d = bfsDistances(s.grid, s.spawnCenter.x, s.spawnCenter.y);
      expect(s.victims.length).toBeGreaterThanOrEqual(2);
      for (const v of s.victims) {
        expect(s.grid.get(v.x, v.y)).toBe(FREE);
        expect(d[v.y * s.width + v.x]).toBeGreaterThanOrEqual(8);
        for (const o of s.victims) if (o !== v) expect(Math.hypot(o.x - v.x, o.y - v.y)).toBeGreaterThanOrEqual(4);
      }
      // Spawn staging square is clear and every non-wall cell is reachable.
      for (let y = s.spawn.y; y < s.spawn.y + s.spawn.size; y++)
        for (let x = s.spawn.x; x < s.spawn.x + s.spawn.size; x++) expect(s.grid.get(x, y)).not.toBe(WALL);
      for (let i = 0; i < d.length; i++) if (s.grid.cells[i] !== WALL) expect(d[i]).toBeGreaterThanOrEqual(0);
    }
  });
});
