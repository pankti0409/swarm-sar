# Swarm Mission Control: browser 3D simulator

A standalone, browser-only 3D simulator for the swarm-sar disaster-response project. Rovers and
drones search a collapsed site, share maps over a lossy peer-to-peer radio, and locate
survivors. The mission-control interface explains what is happening in plain language.

- **Separate from ROS 2 and Gazebo.** This simulator does not use ROS 2, Gazebo, the Python runtime, WebSockets, a backend, a database or any cloud service. Everything runs in the browser tab.
- **Autonomous Mode is not RL.** *Decentralized Autonomous Mode* is a TypeScript implementation of the Step 4 decentralized frontier controller principles (`src/swarm_sar/baselines/decentralized.py`). It is not PPO, RL, MARL or a GNN.
- **No global knowledge.** Every robot decides from its own belief map, its own sensors, its own battery and pose, and messages that actually reached its inbox. There is no central planner, reservation table or access to survivor positions.

See [CONTROLLER_COMPATIBILITY.md](CONTROLLER_COMPATIBILITY.md) for the field-by-field mapping to the Python reference and the list of intentional differences.

## Install and run

Requires Node.js 18 or newer (tested with Node 24).

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173
```

Other commands:

```bash
npm run test         # Vitest simulation suite (headless, no browser needed)
npm run build        # type-check + production bundle in dist/
npm run preview      # serve the production bundle locally
```

## Architecture

```text
 ┌──────────────────────── React UI (src/components, src/app) ────────────────────────┐
 │ TopBar · LeftPanel (scenario/network/mode) · RightPanel (fleet, robot, mini-map)    │
 │ EventFeed (plain language + Advanced Network Log) · SceneHud                        │
 └───────────────▲─────────────────────────────────────────────┬──────────────────────┘
                 │ version counter (re-render)                 │ commands (recorded)
        ┌────────┴──────── Zustand store (src/store) ──────────▼────────┐
        │ settings · overlays · status · selected robot · engine        │
        └────────▲─────────────────────────────────────────────┬────────┘
                 │ positions + alpha (read-only)               │ tick() at 4 Hz × speed
 ┌───────────────┴──── React Three Fiber scene (src/scene) ────▼────────────────────────┐
 │ World (instanced walls/rubble/props) · Robots (rover, drone) · NetworkLinks ·       │
 │ PacketPulses · Partition/Reconnect · Survivors · Evidence · CoverageFog · Dust      │
 └──────────────────────────────────────────────────────────────────────────────────────┘
                                       │
 ┌──────────────────── Deterministic simulation core (src/simulation) ──────────────────┐
 │ core/SimulationEngine ── fixed tick:                                                  │
 │   commands → per-robot AgentBrain(LocalView) / ManualController                       │
 │   → CollisionSafety.safetyFilter → applyMovements (physics)                           │
 │   → Vision + SensorModel (truth → noisy readings) → investigate / confirm             │
 │   → broadcast PeerMessage → PeerNetwork (range, walls, loss, delay, TTL, partition)   │
 │   → merge delivered map cells into private beliefs                                    │
 │ world/ (GridMap, ScenarioGenerator, WorldState)  robots/  sensing/  planning/         │
 │ network/  controller/  telemetry/ (HumanReadableEventFormatter)                       │
 └──────────────────────────────────────────────────────────────────────────────────────┘
```

The simulation core has no React or Three.js imports, so it runs unchanged in Vitest. Given
the same options and command log, the engine produces the same result
(`SimulationEngine.stateHash()`). Rendering interpolates between the previous and current
tick and never mutates simulation state.

## Using the simulator

1. Pick a **disaster site** (Collapsed Office, Mine Tunnel, Earthquake Apartment, Random Irregular Site) and a **seed**, or press 🎲.
2. Choose 1–10 robots with any rover/drone mix (default 2 + 2), sensor noise, and radio settings.
3. Press **Launch mission** (or Space).
4. Watch the top bar for survivors found, coverage, time, network health and packet loss. The scene brief explains what the swarm is doing now.
5. Click a robot, or its fleet card, to see its objective, battery, links, sensors, recent messages and **private map**: what that robot believes, including teammates drawn where their last delivered message placed them.

**Validation demo.** Press **★ Load validation demo**, then launch. Rover 1 is partitioned
from step 20 to step 60, with 15% packet loss and 1–3 ticks of delay, on a map with a 12-cell
one-cell-wide corridor. Watch for:

- red packet pulses and red links;
- the red partition ring and the "Critical" network state;
- the green reconnection burst and "Network restored…" feed message;
- map-sharing messages and snapshot catch-up;
- heat and sound markers, then survivor beacons;
- "moved through a narrow passage in single file" convoys, with zero collisions.

`src/tests/demo.test.ts` asserts all of these headlessly.

### Controls

| Input | Action |
|---|---|
| Left-drag / right-drag / wheel | Orbit / pan / zoom |
| Click robot | Select (click again to deselect); **Focus** in the robot panel moves the camera to it |
| Space | Launch / pause / resume |
| Esc | Deselect |
| Manual or Mixed mode, robot selected | Click the floor to set a waypoint |
| Arrow keys or WASD | Step the selected manual robot |
| E / X | Scan here (confirm survivor) / stop |

Modes:

- **Auto**: every robot runs Decentralized Autonomous Mode.
- **Manual**: the operator drives the selected robot and the others hold.
- **Mixed**: the operator drives the selected robot and the others stay autonomous.

Manual commands always pass through the same collision-safety shield and physics.

### Overlays

The View section toggles:

- network links: green healthy, yellow weak or lossy, red lost or partitioned;
- network graph overlay: a 2D graph of robots and their live links, with a blinking red ring on isolated robots (off by default; click a node to select it);
- packet pulses;
- radio ranges;
- planned paths;
- heat and sound evidence;
- unexplored fog / local map;
- robot labels;
- **Truth map — Debug Only**, which reveals hidden survivors in magenta and shows a banner. Robots never read this data.

The bottom panel's **Advanced network log** tab lists, per packet: sender, recipient,
sequence, type, state, delay, expiry, drop reason and map-delta size. Next to it are
reconnect events and aggregate counters.

## Browser requirements

- A desktop browser with WebGL 2: current Chrome, Edge, Firefox or Safari 16+.
- Hardware acceleration enabled. Check `chrome://gpu` and look for "WebGL2: Hardware accelerated".
- At least a 1280×720 window. Panels stack below 1180 px wide and on phones.

## GTX 1650 / 16 GB RAM performance guidance

- The app starts on Medium. **Low** is the safe choice for a GTX 1650 laptop:
  - device pixel ratio 1;
  - no antialiasing and no shadows;
  - 2 emergency lights and 120 dust particles;
  - no robot spotlights or light shafts.
- **Medium** adds antialiasing, light shafts and more particles, and usually holds 60 fps on a GTX 1650 with 4–6 robots.
- **High** adds 2048² moon shadows, robot and drone spotlights, and up to 2× pixel ratio. Use it for screenshots or on stronger GPUs.
- On Windows laptops:
  - go to Settings → System → Display → Graphics, and set your browser to **High performance** so it uses the GTX 1650 rather than the integrated GPU;
  - keep the laptop on mains power.
- 10 robots at 4× speed is the heaviest case. If frames drop, use Low, turn off packet pulses, or lower Smoke & dust.
- Walls, rubble and props are instanced (a handful of draw calls). Textures are generated procedurally at load; nothing is downloaded.

## Tests

`npm run test` runs these suites:

| Suite | Covers |
|---|---|
| `scenario.test.ts` | same seed → identical scenario for every preset; portrait and landscape maps; reachable, separated survivors; clear spawn |
| `determinism.test.ts` | same seed + command script (mode switches, waypoints, partitions, loss changes) → identical state hash, network metrics and feed; command-log replay |
| `network.test.ts` | packet loss drops; delay queues; TTL expiry; range and wall attenuation; partition isolation; reconnection; operator partition toggle; de-duplication; deterministic transport |
| `autonomy.test.ts` | robots never see truth survivors; `LocalView` has no truth fields; relocating hidden survivors does not change autonomous trajectories; network-off autonomy; maps spread only through delivered messages |
| `collision.test.ts` | same-cell overlap prevented; swaps blocked; convoys advance through one-cell corridors; holding robots yield; turning robots are followed, not pushed; walls respected; manual movement passes the shield |
| `controller.test.ts` | deterministic rendezvous branch ownership and reassignment; thermal/acoustic corroboration; no reservation table; priority claim release; never selects a masked frontier action (mirrors the upstream Python test); controller source never references truth data |
| `demo.test.ts` | the validation demo shows loss, delay, partition, reconnection, map sharing, survivor detection and convoy traffic with zero collisions |
| `missions.test.ts` | complete missions on every preset at 10% loss: zero collisions, recall guard, coverage guard |

## Screenshots and recordings

- **Screenshot:** load the validation demo, set quality to High, launch at 1× and pause (Space) during steps 20–60 to capture the partition. Then press Win+Shift+S (Windows) or Cmd+Shift+4 (macOS).
- **Recording:**
  - Windows: Win+Alt+R (Xbox Game Bar) or OBS.
  - macOS: Cmd+Shift+5.
  - Record at 1× with Medium quality for smooth output, and turn on Radio ranges for network-focused clips.

## Known limitations

- The simulator is grid-based with discrete one-second ticks. Smooth motion is interpolation only.
- Drones are 2D proxies with visual altitude. They never cross walls, as in Python Step 4.
- Radio, thermal and acoustic models are seeded abstractions, not calibrated RF or sensor models.
- Random streams differ from numpy, so browser runs are not bit-identical to Python runs on the same seed. See CONTROLLER_COMPATIBILITY.md for this and other deviations, including the yield-rule livelock fix.
- Robots can be added or removed only before launch. Mid-mission spawning is not implemented.
- No PPO/ONNX learned policy is included. The `LocalView` → `Decision` interface is the intended slot for one.
- Map sizes are kept browser-friendly (about 28–56 cells per side). Python Step 4 audits used much larger sites.
- Browser recall is a regression guard on small maps, not a reproduction of the Python Step 4 audit numbers.
