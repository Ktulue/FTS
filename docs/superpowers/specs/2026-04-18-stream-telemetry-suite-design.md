# Forza Stream Telemetry Suite — Skateboard Design

**Status:** Draft — pending user final review
**Date:** 2026-04-18
**Scope:** Skateboard phase only (core listener + plugin infrastructure + 2 validator modules). Bicycle and Car phases are captured at intent level in the Future Work appendix and will get their own brainstorm → spec → plan cycles.

---

## 1. Summary

FSTS is a single TypeScript/Node process that receives Forza Horizon UDP telemetry, parses each packet, and fans the data out to multiple stream-facing consumers (OBS overlays, Streamer.bot, Discord bots, etc.) through a clean pub/sub interface. Modules (overlays, alerts, chat commands, persistence) plug into a unified `Plugin` contract and can be toggled on/off at runtime via a browser-based Admin Panel.

The Skateboard phase delivers the listener, the plugin infrastructure, the Admin Panel, a raw UDP forwarder (for future Moza Pit House / SimHub integration), a mock input source for offline development, and two validator modules that exercise both architectural paths end-to-end: one pull-style (HTTP endpoint → Streamer.bot chat command) and one push-style (in-process plugin → WS event → Streamer.bot alert action).

## 2. Scope

**In scope for Skateboard:**
- Core UDP listener + packet parser + telemetry bus
- Pluggable `InputSource` with `DirectUDPInput` and `MockInput` implementations
- `RawOutput` forwarding chain with `UDPForwardOutput` (generic, Moza Pit House is one possible destination)
- Plugin host with lifecycle, config slicing, and crash-isolation
- HTTP + WebSocket server (Express + `ws`)
- Browser-based Admin Panel served at `/hub`
- Two validator modules (Backseat Speedometer, Redline Alert) — implemented to prove both architectural paths
- Config file system (JSONC with JSON schema validation)
- Structured logging with per-module sub-loggers
- Windows bat-file launchers (`start-fsts.bat`, `stop-fsts.bat`)
- Vitest unit + integration test suite

**Out of scope for Skateboard** (captured in Future Work, Section 9):
- Browser-source overlays (G-Force Meter, Near Death Counter, Smooth Brain) — Bicycle
- Persistence / SQLite (Session Stats, Car Report Card) — Car
- StreamDeck plugin — Car
- CLI wrapper — Car
- Direct-Twitch consumer module — Car or later
- Moza hardware integration validation (hardware not yet acquired — architecture is ready, activation deferred)

## 3. Tech stack decisions

| Decision | Choice | Rationale |
|---|---|---|
| Language / runtime | TypeScript on Node.js | One language spans listener + overlay widgets (OBS Browser Source is Chromium); shared packet schema types end-to-end; existing FH5 parser (`forza-horizon-5-udp`) as reference; Streamer.bot integration works equally well from any language |
| HTTP server | Express | Standard, well-documented, plays well with `ws` for WebSocket upgrade |
| WebSocket | `ws` | De-facto Node WS library; simple, fast |
| Packet parsing | Custom (informed by `forza-horizon-5-udp`) | Pin the schema we use; avoid a runtime dependency for a well-understood binary format |
| Config format | JSONC | Familiar syntax, supports comments, first-class in VS Code |
| Config validation | JSON Schema (ajv) | Standard, composable across modules, clear error messages |
| Logging | `pino` + `pino-pretty` | Fast structured logging, child loggers for per-module tagging |
| Testing | Vitest | TS-native, fast, modern |
| Startup | `start-fsts.bat` / `stop-fsts.bat` | One-click launch, live log window; no packaging overhead |

## 4. Architecture & core invariants

### 4.1 System diagram

```
                       ┌─────────────────────┐
                       │ Forza Horizon 5     │
                       │ (UDP Data Out)      │
                       └─────────┬───────────┘
                                 │ UDP :PORT
                                 ▼
┌────────────────────────────────────────────────────────────┐
│ FSTS Core (single Node process)                            │
│                                                            │
│ ┌────────────────────────────────────────────────────┐     │
│ │ InputSource  (DirectUDPInput | MockInput)          │     │
│ └─────┬───────────────────────────┬──────────────────┘     │
│       │ raw bytes                 │ raw bytes              │
│       ▼                           ▼                        │
│ ┌──────────────────┐    ┌──────────────────────────┐       │
│ │ RawOutputChain   │    │ PacketParser             │       │
│ │ (forward UDP to  │    └─────────────┬────────────┘       │
│ │  Moza/SimHub/…)  │                  ▼                    │
│ └──────────────────┘    ┌──────────────────────────┐       │
│                         │ TelemetryBus             │       │
│                         └─────────┬────────────────┘       │
│                                   ├────────────────────┐   │
│                                   ▼                    ▼   │
│                    ┌────────────────────┐   ┌──────────────┐│
│                    │ PluginHost         │   │ HTTP/WS      ││
│                    │ (registered plugins│   │ Server       ││
│                    │  get onTelemetry)  │   │              ││
│                    │                    │   │ • GET        ││
│                    │  ctx.emit() ───────┼──►│   /telemetry ││
│                    │  ctx.registerRoute─┼──►│   /latest    ││
│                    │    │               │   │ • GET/POST   ││
│                    │    └─────────┬─────┼──►│   /modules   ││
│                    │              │     │   │ • GET        ││
│                    │              │     │   │   /hub       ││
│                    │              │     │   │ • WS         ││
│                    │              │     │   │   /telemetry ││
│                    │              │     │   │ • WS /events ││
│                    └──────────────┼─────┘   └──────┬───────┘│
└───────────────────────────────────┼────────────────┼────────┘
                                    │                │
                                    ▼                ▼
                             (consumers: OBS overlays, Streamer.bot, etc.)
```

### 4.2 Core design invariants

These rules govern every subsequent design and implementation decision. Any future module or change must honor them.

1. **Twitch-agnostic listener.** FSTS Core has zero knowledge of Twitch, Streamer.bot, Discord, or any downstream consumer. It only parses UDP and publishes events. Consumers decide what to do with the data.

2. **Forza-agnostic modules.** Modules receive a parsed `TelemetryPacket` via the plugin API. They don't know about UDP byte layouts or input source. `DirectUDPInput` ↔ `MockInput` swap is invisible to every module.

3. **One-way data flow.** UDP input → parse → broadcast/plugins → WS/HTTP out. The only consumer → listener communication is Admin Panel toggle requests, which are a control-plane concern (Section 6.8).

4. **Crash-isolated modules.** A plugin throwing an exception in `onTelemetry` never crashes the core. The hot path wraps each plugin call in try/catch; repeated failures auto-disable the plugin (Section 6.6).

5. **Admin Panel is the control plane, not the data plane.** The hub manages module on/off state and surfaces status. Module configuration (thresholds, sound paths, etc.) lives in `config.jsonc` that the user edits directly. This keeps Admin Panel scope small and avoids a settings-form builder in Skateboard.

6. **Downstream-agnostic forwarders.** The raw UDP forwarder is a generic fan-out feature, not Moza-specific. Moza Pit House is one possible destination; SimHub, a second PC, or any other consumer can be another.

## 5. Components, interfaces & data flow

### 5.1 `InputSource` — how bytes get into the system

```ts
interface InputSource {
  readonly name: string;
  start(onPacket: (raw: Buffer) => void): Promise<void>;
  stop(): Promise<void>;
}
```

Two implementations ship in Skateboard:

- **`DirectUDPInput({ port })`** — binds a UDP socket, calls `onPacket` per datagram.
- **`MockInput({ file, loop, speed })`** — replays a recorded telemetry file. `speed: 1.0` = real-time; `0.5` = slow-motion for debugging; `loop: true` = continuous replay for overlay development.

Only one `InputSource` is active at a time. Chosen via `config.jsonc`:

```jsonc
"input": { "type": "udp", "port": 9999 }
// or
"input": { "type": "mock", "file": "./recordings/laguna-seca.fzt" }
```

### 5.2 `RawOutput` — the generic forwarder contract

```ts
interface RawOutput {
  readonly name: string;
  readonly enabled: boolean;
  send(raw: Buffer): void;        // fire-and-forget, must not throw
  shutdown(): Promise<void>;
}
```

One implementation in Skateboard: `UDPForwardOutput({ host, port })`.

Raw outputs operate on raw UDP bytes **before** parsing, so:

- Forwarding failures don't affect parsing.
- Moza Pit House gets exactly the bytes Forza would have sent if it were the direct recipient.
- A future Forza version with a different packet format can still be forwarded transparently.

Config:

```jsonc
"rawOutputs": [
  { "name": "moza-pit-house", "type": "udp-forward", "host": "127.0.0.1", "port": 5300, "enabled": false },
  { "name": "simhub",         "type": "udp-forward", "host": "127.0.0.1", "port": 22222, "enabled": false }
]
```

Errors (socket unreachable, DNS fail) are caught per-output, logged, and counted. The Admin Panel shows per-output health.

### 5.3 Packet parsing & `TelemetryBus`

```ts
interface TelemetryPacket {
  timestamp: number;                 // Unix epoch ms (packet receive time at FSTS)
  isRaceOn: boolean;                 // false = menu/paused
  speed: number;                     // m/s
  rpm: number;
  maxRpm: number;                    // EngineMaxRpm
  gear: number;
  accelLateral: number;              // G (lateral)
  accelLongitudinal: number;         // G (longitudinal)
  tireSlipRatio: { fl: number; fr: number; rl: number; rr: number };
  carOrdinal: number;                // unique car ID (used in Car phase)
  carClass: number;
  drivetrainType: number;
  // ... full schema matches FH5 "Dash" packet
}

class TelemetryBus {
  subscribe(handler: (pkt: TelemetryPacket) => void): () => void;
  lastPacket(): TelemetryPacket | null;
}
```

`TelemetryBus.lastPacket()` returns the most recent parsed packet instantly, without waiting for a new UDP datagram — used by HTTP endpoints like `GET /telemetry/latest`. Subscriptions are synchronous; fast consumers only.

### 5.4 WebSocket event envelope

Two WS channels:

**`/telemetry`** — raw feed, 60Hz:
```json
{ "type": "telemetry", "timestamp": 1744994123456, "data": { "speed": 52.3, "rpm": 6800, "...": "..." } }
```

**`/events`** — plugin-emitted events:
```json
{
  "type": "event",
  "source": "redline-alert",
  "event": "triggered",
  "timestamp": 1744994123789,
  "payload": { "rpm": 7450, "maxRpm": 7500, "durationMs": 1200 }
}
```

Envelope rules:

- `type` is always present and is the discriminator for consumer dispatch.
- `source` on events is always the plugin `id`.
- `event` is kebab-case, plugin-defined, documented per plugin.
- `payload` is free-form JSON, plugin-defined.
- Adding new event types or plugins doesn't break existing subscribers.

### 5.5 HTTP surface (Skateboard)

```
GET  /telemetry/latest         → latest TelemetryPacket as JSON (204 if no packet yet)
GET  /modules                  → [{id, displayName, enabled, running, errorCount, status?}, ...]
POST /modules/:id/enable       → enables plugin, returns updated record
POST /modules/:id/disable      → disables plugin, returns updated record
GET  /hub                      → Admin Panel HTML
GET  /hub/static/*             → Admin Panel assets
GET  /health                   → {status, uptimeMs, packetsReceived, errors, ...}
```

Modules can register additional routes under their own path namespace via `ctx.registerRoute()` (Section 6.2).

## 6. Where modules live

### 6.1 Directory layout

```
fsts/
├── src/
│   ├── core/                       # listener infrastructure — never imports from modules/
│   │   ├── input/
│   │   │   ├── InputSource.ts
│   │   │   ├── DirectUDPInput.ts
│   │   │   └── MockInput.ts
│   │   ├── parser/
│   │   │   └── PacketParser.ts
│   │   ├── bus/
│   │   │   └── TelemetryBus.ts
│   │   ├── raw-outputs/
│   │   │   ├── RawOutput.ts
│   │   │   └── UDPForwardOutput.ts
│   │   ├── plugin-host/
│   │   │   ├── Plugin.ts           # Plugin interface + PluginContext
│   │   │   └── PluginHost.ts       # lifecycle, crash-isolation, config slicing
│   │   ├── http/
│   │   │   └── Server.ts           # Express + ws
│   │   └── hub/                    # Admin Panel HTML/JS served from here
│   ├── modules/
│   │   ├── index.ts                # registry: explicit array of all modules
│   │   ├── backseat-speedometer/
│   │   │   ├── plugin.ts
│   │   │   ├── config.schema.json
│   │   │   └── README.md
│   │   └── redline-alert/
│   │       ├── plugin.ts
│   │       ├── config.schema.json
│   │       └── README.md
│   └── index.ts                    # entry: loads config, starts core, registers modules
├── config.jsonc                    # user-facing config
├── config.example.jsonc            # shipped default; copied to config.jsonc on first run
├── recordings/                     # .fzt files for MockInput
├── logs/                           # rotating log files
├── test/
│   ├── integration/
│   └── fixtures/
│       └── skateboard-smoke.fzt    # ~30s recorded fixture committed to repo
├── start-fsts.bat
├── stop-fsts.bat
└── package.json
```

**The boundary:** `core/` never imports from `modules/`. `modules/` only imports `Plugin` and `PluginContext` from `core/plugin-host/`.

### 6.2 The unified `Plugin` contract

```ts
interface PluginContext {
  emit(channel: "events", event: string, payload: unknown): void;
  registerRoute(method: "GET" | "POST", path: string, handler: RouteHandler): void;
  log: Logger;
  config: unknown;                               // this plugin's config slice
}

interface Plugin {
  readonly id: string;                           // kebab-case, stable
  readonly displayName: string;                  // for the Admin Panel
  readonly description?: string;                 // Admin Panel tooltip
  readonly configSchema?: object;                // JSON schema

  onStart(ctx: PluginContext): Promise<void> | void;
  onTelemetry?(pkt: TelemetryPacket, ctx: PluginContext): void;
  onStop(): Promise<void> | void;
}
```

A module uses whatever subset it needs:

- **Pure-HTTP module** — implements only `onStart` (registers routes); skips `onTelemetry`.
- **Pure-plugin module** — implements `onTelemetry`; emits events via `ctx.emit`; no routes.
- **Hybrid** — both.
- **Pure observer** — caches state on telemetry; another module or overlay reads its state via a registered route.

Every module goes through the same lifecycle, toggle, and crash-isolation regardless of flavor.

### 6.3 Registration — explicit, not filesystem-scanned

```ts
// src/modules/index.ts
import { backseatSpeedometer } from "./backseat-speedometer/plugin";
import { redlineAlert } from "./redline-alert/plugin";

export const modules: Plugin[] = [
  backseatSpeedometer,
  redlineAlert,
];
```

Why explicit array, not `fs.readdir`:

- Deterministic load order
- Grep-friendly — one file answers "what modules exist?"
- Typechecker catches broken modules at compile time
- Adding a module = two-line change (import + array entry)

### 6.4 Config slicing

```jsonc
{
  "input":   { "type": "udp", "port": 9999 },
  "rawOutputs": [ /* ... */ ],
  "http":    { "port": 5780 },
  "logging": { "level": "info", "dir": "./logs" },

  "modules": {
    "backseat-speedometer": {
      "enabled": true,
      "config": { /* module-specific shape, validated against its schema */ }
    },
    "redline-alert": {
      "enabled": true,
      "config": { /* ... */ }
    }
  }
}
```

`PluginHost` hands each module only its own `config` slice via `ctx.config`. A module cannot see or touch another module's config — enforced by the `PluginContext` API surface.

### 6.5 Lifecycle

```
Startup:
  1. Core reads config.jsonc (validate against composed JSON schema)
  2. Core starts InputSource → parser → bus → HTTP server → raw-outputs
  3. For each module in modules[]:
       if enabled in config:
         ctx = new PluginContext(pluginId, configSlice)
         try { await module.onStart(ctx) } catch → mark errored, skip
         if module.onTelemetry defined → subscribe it to bus (wrapped try/catch)
  4. HTTP server ready, Admin Panel reachable

Runtime toggle — POST /modules/:id/disable:
  1. Unsubscribe module from bus
  2. Unregister its routes (they now return 503)
  3. Stop emitting its WS events (dropped at ctx.emit())
  4. Call module.onStop()
  5. Broadcast state change on admin WS so all hub views update

Runtime toggle — POST /modules/:id/enable:
  Mirror of the above.

Shutdown (Ctrl+C / stop-fsts.bat):
  1. Stop InputSource (no more packets)
  2. For each running module: call onStop()
  3. Flush raw-output buffers
  4. Close HTTP/WS connections
  5. Flush logs, exit
```

### 6.6 Crash-isolation policy

- **`onStart` throws:** module marked errored at startup, never subscribed, visible in Admin Panel with the error. Core keeps running.
- **`onTelemetry` throws:** caught by PluginHost wrapper, logged with module id and packet timestamp, counter incremented. If counter exceeds **5 errors within 10 seconds**, module auto-disables (same as Admin Panel toggle). Toast notification via admin WS so the user sees it immediately.
- **Registered HTTP route throws:** caught by Express middleware, returns HTTP 500 with module id, logs include stack. Does NOT auto-disable (a buggy route is less dangerous than a buggy hot-path handler).
- **`onStop` throws:** logged; shutdown continues.

### 6.7 Adding a new module — the 4-step checklist

1. `mkdir src/modules/my-new-thing && touch src/modules/my-new-thing/plugin.ts`
2. Write a `Plugin` object exporting an `id`, `displayName`, and whichever lifecycle hooks you need
3. Add it to the array in `src/modules/index.ts`
4. Add its config slice under `modules.my-new-thing` in `config.jsonc`

No core edits. No HTTP-server edits. No Admin Panel edits (picks up new modules automatically from `GET /modules`). Restart FSTS.

### 6.8 Admin Panel

Served at `GET /hub` (main view) with a separate admin area at `GET /hub/admin` for module toggles. Reads `GET /modules` for the module list, subscribes to the admin WS for live updates.

Conceptual layout:

```
┌─ FSTS Admin Panel ──────────────────────────────────────┐
│                                                         │
│ Input:     ● udp (listening on :9999)                   │
│ Uptime:    01:23:45   Packets: 298,410   Errors: 0      │
│                                                         │
│ Raw Outputs:                                            │
│   ☐ moza-pit-house    (disabled)                        │
│   ☐ simhub            (disabled)                        │
│                                                         │
│ Modules:                                                │
│   ☑ Backseat Speedometer  ● running   0 errors          │
│   ☑ Redline Alert         ● running   0 errors          │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

Each module checkbox drives `POST /modules/:id/{enable|disable}`. Status pill reflects `running | stopped | errored`. Modules can publish a single short status string via `ctx.emit("admin", "status", "...")` to render next to their name — the only "extra" UI surface modules get in Skateboard.

Designed to be pinnable as an OBS Custom Browser Dock so it lives inside OBS during streaming.

## 7. Config, logging, runtime

### 7.1 Config lifecycle

- **File:** `config.jsonc` in project root.
- **Validation:** module schemas composed into a top-level schema at startup; invalid config fails startup with a specific error.
- **First-run UX:** if `config.jsonc` is missing, core copies `config.example.jsonc`, logs `"Created default config.jsonc — review and restart"`, exits.
- **Reload model:** no hot-reload in Skateboard. Restart to apply config changes. Module enable/disable is handled by the Admin Panel and is a separate concern from config reloading.

### 7.2 Logging

- **Library:** pino (structured JSON) + pino-pretty (colorized console in dev)
- **Outputs:** console + daily-rotating file in `logs/fsts-YYYY-MM-DD.log`, keep last 7 days
- **Levels:** trace, debug, info, warn, error (default: info)
- **Per-module child loggers:** `ctx.log` is a pino child pre-tagged with `{module: "<id>"}`
- **Info-level coverage:** startup state, module lifecycle transitions, WS connections, Admin Panel actions
- **Not logged at info:** per-packet data (60/sec = noise); only at trace

### 7.3 Runtime

- **`start-fsts.bat`** — wraps `npm start` in a named console window; double-click to launch; live logs visible
- **`stop-fsts.bat`** — cleanly terminates the process (avoids orphan UDP binding)
- **Single process, single machine** — no service, no tray, no bundled exe in Skateboard

## 8. Testing strategy

### 8.1 Unit tests — `src/**/*.test.ts` (Vitest, co-located)

- `PacketParser`: known byte buffers → expected parsed object
- `TelemetryBus`: subscribe/unsubscribe/lastPacket semantics
- `PluginHost`: crash-isolation, auto-disable thresholds, config slicing
- Each module: pure functions (detection math, formatting) tested in isolation

### 8.2 Integration tests — `test/integration/*.test.ts`

- Boot full core with `MockInput` pointing at `test/fixtures/skateboard-smoke.fzt`
- Assert: HTTP endpoints respond correctly; WS events fire as expected; Admin Panel toggle works mid-replay
- `MockInput` is the linchpin — without it, integration tests would require Forza running (impossible for CI, slow for dev)

### 8.3 Manual smoke test — `TESTING.md` checklist

- Launch via `start-fsts.bat`; Admin Panel loads
- Drive in Forza for 60s; `/telemetry/latest` updates; logs show packets
- Exercise each validator module's path end-to-end
- Toggle each module off; verify it stops responding

## 9. Skateboard acceptance criteria

Skateboard is "done" when all of the following pass.

**Infrastructure**
- [ ] `start-fsts.bat` launches; Admin Panel reachable at `localhost:5780/hub`; logs written to `logs/`
- [ ] `stop-fsts.bat` cleanly terminates (no orphan UDP binding)
- [ ] Missing `config.jsonc` auto-copies example and exits with clear instructions
- [ ] Invalid `config.jsonc` fails startup with a specific JSON-schema error

**Core data path**
- [ ] `DirectUDPInput` receives packets from Forza while driving; `/health` shows non-zero packet count
- [ ] `MockInput` replays a fixture file at real-time speed; downstream consumers see identical behavior to `DirectUDPInput`
- [ ] `GET /telemetry/latest` returns the most recent packet as JSON
- [ ] WS `/telemetry` broadcasts every packet to connected clients
- [ ] WS `/events` broadcasts plugin-emitted events to connected clients

**Plugin system**
- [ ] Both Skateboard modules appear in Admin Panel with correct id, displayName, status
- [ ] Admin Panel checkboxes enable/disable each module in <500ms with no restart
- [ ] A module throwing 5 exceptions in 10s auto-disables and surfaces the error in the Admin Panel
- [ ] Disabling a module stops its WS emissions and makes its HTTP routes return 503
- [ ] Each module's config slice is readable from `ctx.config` and inaccessible to other modules

**Raw forwarder**
- [ ] A `udp-forward` raw output enabled with a test target (verified with `netcat -u -l PORT`) receives identical bytes to what Forza sent
- [ ] Disabling all raw outputs has zero performance impact (no send calls in hot path)
- [ ] A forwarder with an unreachable target logs errors but doesn't block the input hot path

**Validator paths**
- [ ] Pull path validated: HTTP-endpoint module serves data; Streamer.bot can read and respond in chat
- [ ] Push path validated: plugin emits event; Streamer.bot WS client receives it and acts on it

## 10. Future work appendix (Bicycle / Car)

Captured at intent level only. Each gets its own brainstorm → spec → plan cycle when its turn comes.

### Bicycle — browser-source overlays

- **G-Force Meter** — pure-render overlay consuming `/telemetry`
- **Near Death Counter** — stateful plugin (velocity-drop detection) + overlay
- **Smooth Brain / Galaxy Brain** — composite scoring plugin + overlay
- Overlays served as HTML/JS from the listener's existing HTTP server (e.g., `GET /overlays/g-force`)
- `MockInput` becomes essential for overlay visual iteration without Forza

### Car — persistence, history, hardware

- **SQLite persistence module** — new module category for long-term cross-session state
- **Car Report Card** — per-car/class/drivetrain historical stats; triggered on car-switch detection
- **Session Stats End Card** — summary rendered as browser source or exported image
- **StreamDeck plugin** — calls existing `POST /modules/:id/{enable|disable}` endpoints; zero listener changes
- **Moza integration activation** — flip `moza-pit-house` forwarder `enabled: true` when hardware arrives; verify packet receipt; no code change expected
- **CLI wrapper** — thin shell around HTTP endpoints for keybinds/macros
- **Direct-Twitch consumer module** — optional alternative to Streamer.bot; subscribes to `/events` internally

### Flagged considerations

- **Forza 6 compatibility** (May 2026) — parser may need small adjustments if packet format changes; input/output abstractions unchanged
- **Boxflat integration** — speculative; new `InputSource` reading Moza wheel/pedal state via Boxflat's WebSocket, mergeable with Forza telemetry if a future module needs it
- **Recording & playback UI** — record-current-session button + replay controls in Admin Panel; natural evolution of `MockInput` but not needed for Skateboard

## 11. Decision log

| # | Decision | Alternatives considered | Why |
|---|---|---|---|
| 1 | Skateboard scope only | Full-suite architecture spec; detailed all-modules spec | Moza hardware unknown; want to validate architecture cheap before committing to 7 modules |
| 2 | TypeScript | C#; Go | Collapses listener + overlays to one language; shared packet schema; existing FH5 TS parser as reference |
| 3 | Hybrid plugin architecture (in-process + external subscriber) | In-process only; external-only | Matches the mix of module types — render-only overlays vs stateful detectors — without forcing either pattern to do the other's job |
| 4 | Both validator modules in Skateboard (pull + push) | Single validator | Exercises both architectural paths before committing to 7 modules; both Streamer.bot integration styles proven |
| 5 | Unified `Plugin` contract with optional route registration | Separate "HTTP module" and "plugin" concepts | One lifecycle, one toggle, one crash-isolation policy; module flavor is an implementation choice not a type distinction |
| 6 | Browser hub at `localhost/hub` with separate Admin Panel area | Electron/Tauri app; StreamDeck-only; TUI | Zero new dependencies; OBS browser-dock compatible; extensible to logs/live view/config as more pages |
| 7 | HTTP for pull + WebSocket for push | HTTP-only (polling); WS-only | Each transport does what it's naturally good at; matches standard pub/sub; avoids polling latency for alerts |
| 8 | Listener is Twitch-agnostic; consumers decide Twitch routing | Listener calls Twitch directly; Streamer.bot tight coupling | Extensibility: any consumer (SB, direct Twitch, Discord, custom) reads the same contract |
| 9 | Pluggable `InputSource` + `MockInput` | Direct UDP only | `MockInput` enables CI integration tests and overlay dev without Forza; keeps Moza integration path open |
| 10 | Generic `RawOutput` forwarder (not Moza-specific) | Moza-specific forwarder; no forwarder | Controller vs wheel is a config question; forwarding to SimHub/LAN/other consumers also becomes trivial |
| 11 | `start-fsts.bat` launcher over packaged .exe or service | Compiled single-file exe; Windows service | One-click launch with zero packaging overhead; live log window matters mid-stream; sole-user project doesn't need distribution |
| 12 | Auto-disable plugin after 5 errors in 10s | No auto-disable; different threshold | Prevents a buggy hot-path plugin from flooding logs while keeping core up; threshold is a starting heuristic, tunable later |
| 13 | No hot config reload in Skateboard | Full hot-reload | Reload introduces subtle partial-state bugs; restart is cheap; Admin Panel covers the common "toggle a module" case |

---

**End of design document.**
