# Driver Inputs Overlay — Design

**Status:** Draft — pending user final review
**Date:** 2026-05-10
**Scope:** First Bicycle-phase item. Adds a browser-source overlay that visualizes wheel rotation, pedal inputs, gear, shifter, and e-brake from Forza Horizon telemetry. Also establishes minimal overlay-serving conventions in core so future Bicycle overlays (G-Force Meter, Near Death Counter, Smooth Brain) are mostly UI work.

---

## 1. Summary

A new FTS plugin module (`driver-inputs`) serves an HTML/JS overlay at `GET /overlays/driver-inputs/` for use as an OBS Browser Source. The overlay shows a steering wheel with two hands (10-and-2), three vertical pedal bars (throttle/brake/clutch), a gear readout, a shifter (base + knob), and an e-brake (base + lever + effect). Visuals are driven entirely by Forza Horizon telemetry — no hardware-direct integration. Asset slot names match the RacingOverlay (Godot) reference so user-supplied PNG art drops in without rework.

To unblock this module and future overlays, one new method joins `PluginContext`: `registerOverlay({ builtInDir, userDir })`. The server-side asset resolver checks the user dir first, then falls back to the module's bundled built-in dir (SVG placeholders shipped with FTS so the overlay works zero-config).

The parser is restructured to support multiple Forza versions via a small interface; FH5 is the only implementation today, FH6 (expected late 2026) drops in as a sibling file when its packet layout is known.

## 2. Scope

**In scope:**
- New module `src/modules/driver-inputs/` with `Plugin` shape, JSON-schema-validated config, README
- Built-in SVG placeholder asset set under the module's `public/` directory
- One new `PluginContext` method: `registerOverlay`
- One new `Server` route handler that mounts `GET /overlays/:moduleId/*` with user-dir-overrides-built-in resolution and path-traversal protection
- Parser extension: `TelemetryPacket` gains `steer`, `throttle`, `brake`, `clutch`, `handbrake`
- Parser refactor: `ForzaDashParser` interface; current implementation becomes `parsers/fh5DashParser.ts`; `input.game` config selects the parser
- Browser-side `overlay.js` with rAF render loop, WS reconnect, right-hand pose state machine, gear-to-shifter-gate mapping
- Integration test driven by existing `MockInput` and the `skateboard-smoke.fzt` fixture
- Manual smoke test entries in `TESTING.md` including a Pithouse-in-the-chain verification

**Out of scope:**
- Other Bicycle overlays (G-Force Meter, Near Death Counter, Smooth Brain) — each gets its own brainstorm cycle
- Themes folder / runtime theme picker — single user-dir override is enough for the single-rig context
- Wheelbase-direct input (Boxflat-style raw wheel angle) — Forza's reported `steer` is sufficient with configurable visual rotation range
- Hot-reload of the overlay HTML — refresh the OBS browser source manually
- FH6 parser implementation — only the *seam* lands now; the FH6 file lands when FH6 telemetry is sampleable
- Recording UI / playback controls in Admin Panel
- Foot pose state machine beyond "visible while pedal pressed"
- Direct-Twitch consumer module

## 3. Upstream data flow

```
Forza Horizon 5/6 (UDP "Data Out")
  → Moza Pit House (transparent UDP relay)
  → FTS DirectUDPInput (port 9999)
  → parser → TelemetryBus → WS /telemetry
  → Browser overlay client (OBS Browser Source)
```

Two implications of Pithouse being upstream rather than downstream of FTS:

1. The `2026-04-18-stream-telemetry-suite-design.md` spec showed a `moza-pit-house` example under `rawOutputs` (FTS forwarding *to* Pithouse). That example is stale. The `UDPForwardOutput` mechanism itself is unchanged and still useful for SimHub, a second PC, or any other downstream consumer; only the documented Pithouse example becomes wrong. This spec's decision log records the flip.
2. FTS has no awareness of Pithouse. It listens on UDP, parses what arrives. **Assumption (verified in acceptance, not in code):** Pithouse is a transparent relay — it forwards Forza's Dash packet bytes unchanged. If a future Pithouse version reframes packets, the parser breaks and Pithouse's relay config is the place to fix it.

## 4. Tech stack decisions

| Decision | Choice | Rationale |
|---|---|---|
| Overlay transport | Existing `WS /telemetry` | Already broadcasts the parsed packet; no new endpoint needed; one socket connection per browser source |
| Render loop | `requestAnimationFrame` reading last-known packet | Decouples 60Hz UDP from display refresh; dropped packets repaint last state without stutter |
| Asset format (user) | PNG, with SVG fallback per slot | PNG is what users will produce/commission; SVG fallback lets the built-in placeholder set work zero-config without forcing the user to draw anything before they see results |
| Asset format (built-in) | SVG | Tiny, scalable, no licensing question |
| Parser version selection | Explicit config flag (`input.game`) | Byte-sniffing to auto-detect FH5 vs FH6 is fragile; one flag is honest |
| Theme system | None (single user-dir override) | Single-user single-rig context; speculative scope per the project's YAGNI guidance |
| Hand-pose driving | Heuristic state machine over Forza inputs | Forza doesn't tell us where hands physically are; gear-change + handbrake + idle are the only honest signals; matches RacingOverlay's approach |

## 5. Architecture

### 5.1 Parser changes

**File moves:**

```
src/core/parser/
├── PacketParser.ts         (deleted — contents move to parsers/fh5DashParser.ts)
├── TelemetryPacket.ts      (existing — extend with new fields)
└── parsers/
    ├── ForzaDashParser.ts  (new — interface)
    └── fh5DashParser.ts    (new — implementation, contents moved from PacketParser.ts)
```

All call sites (`src/index.ts`, `PacketParser.test.ts`) update in the same change. No compatibility shim — clean break per project conventions.

**`TelemetryPacket` additions:**

```ts
interface TelemetryPacket {
  // ...existing fields unchanged...

  /** Steering, -1..1 (negative = left). Derived from signed int8 at offset 308. */
  steer: number;
  /** Throttle pedal, 0..1. Derived from uint8 at offset 303. */
  throttle: number;
  /** Brake pedal, 0..1. Derived from uint8 at offset 304. */
  brake: number;
  /** Clutch pedal, 0..1. Derived from uint8 at offset 305. */
  clutch: number;
  /** Handbrake, 0..1. Derived from uint8 at offset 306. */
  handbrake: number;
}
```

**`ForzaDashParser` interface:**

```ts
export interface ForzaDashParser {
  readonly id: "fh5" | "fh6";
  readonly minPacketSize: number;
  parse(buf: Buffer, receiveTimestamp: number): TelemetryPacket;
}
```

**`fh5DashParser`:** existing `parseDashPacket` logic, plus the five new field decodings. Reads byte 308 as signed int8 and divides by 127 (clamped to [-1, 1]); reads bytes 303–306 as uint8 and divides by 255.

**Selection:** `src/index.ts` reads `cfg.input.game` (default `"fh5"`) and constructs the matching parser. The packet-receive callback calls `parser.parse(raw, Date.now())` instead of the standalone `parseDashPacket`.

**FH6 path (not implemented now):** add `parsers/fh6DashParser.ts` implementing the same interface; add `"fh6"` to the config schema enum; flip `input.game`.

### 5.2 New core method: `registerOverlay`

**`PluginContext`:**

```ts
interface PluginContext {
  // ...existing members...
  registerOverlay(opts: {
    builtInDir: string;   // absolute path inside the module folder
    userDir?: string;     // optional override dir from this module's config
  }): void;
}
```

**`PluginHost.makeContext`:** forwards to a new `Server.registerOverlay(moduleId, opts)`. On module disable, `Server.unregisterOverlay(moduleId)` is called alongside `unregisterModuleRoutes`.

**`Server.registerOverlay`:** maintains a `Map<moduleId, { builtInDir, userDir? }>`. Installs (once) a single dynamic handler at `GET /overlays/:moduleId/*`. The handler:

1. Look up entry; if missing → 503 (module disabled).
2. Resolve requested filename: empty path or trailing slash → `index.html`.
3. For each dir in `[userDir, builtInDir]` (skip null):
   - `candidate = path.resolve(dir, requestedPath)`
   - `rootResolved = path.resolve(dir)`
   - If `candidate` does not begin with `rootResolved + path.sep` → skip (traversal block).
   - If `fs.existsSync(candidate)` and `fs.statSync(candidate).isFile()` → `res.sendFile(candidate)` and return.
4. Fallthrough → 404.

URL decoding happens before path normalization so encoded `%2e%2e` traversals are caught by the same boundary check.

### 5.3 New module: `driver-inputs`

```
src/modules/driver-inputs/
├── plugin.ts            # registers overlay; no onTelemetry
├── handPose.ts          # right-hand state machine (pure)
├── gearGate.ts          # gear → shifter-knob gate position (pure)
├── config.schema.json
├── README.md
├── plugin.test.ts
├── handPose.test.ts
├── gearGate.test.ts
└── public/              # built-in placeholder assets, served as builtInDir
    ├── index.html
    ├── overlay.css
    ├── overlay.js
    └── assets/
        ├── wheel.svg
        ├── hand_left.svg
        ├── hand_right_steering.svg
        ├── hand_right_shifter.svg
        ├── hand_right_ebrake.svg
        ├── hand_right_floating.svg
        ├── shifter_base.svg
        ├── shifter_knob.svg
        ├── ebrake.svg
        ├── ebrake_base.svg
        ├── ebrake_effect.svg
        ├── pedal_base.svg
        ├── pedal_fill.svg
        ├── foot_left.svg
        └── foot_right.svg
```

**`plugin.ts`:** `onStart` resolves an absolute path to its own `public/` dir (`path.join(import.meta.dirname or equivalent, 'public')`), reads `userAssetDir` from `ctx.config`, calls `ctx.registerOverlay({ builtInDir, userDir })`. No `onTelemetry`. No `onStop` work needed beyond what `unregisterOverlay` handles.

**Config slice (validated by `config.schema.json`):**

```jsonc
"driver-inputs": {
  "enabled": true,
  "config": {
    "userAssetDir": null,
    "wheelRotationRangeDeg": 450,
    "shifterPoseDurationMs": 350,
    "handbrakeEngageThreshold": 0.1
  }
}
```

### 5.4 Right-hand pose state machine (`handPose.ts`)

Pure function. Inputs per tick: `currGear`, `handbrake`, `throttle`, `brake`, `clutch`, `nowMs`, `lastGearChangeMs`, `shifterPoseDurationMs`, `handbrakeEngageThreshold`. Returns one of `"shifter" | "ebrake" | "floating" | "steering"`.

Priority, top to bottom:

1. `(nowMs - lastGearChangeMs) < shifterPoseDurationMs` → `"shifter"`
2. `handbrake > handbrakeEngageThreshold` → `"ebrake"`
3. `currGear === 0 && throttle === 0 && brake === 0 && clutch === 0` → `"floating"`
4. otherwise → `"steering"`

The function holds no state. The **caller** (overlay client) is responsible for tracking `prevGear` and updating its local `lastGearChangeMs` whenever `currGear !== prevGear`, then passing that value in on the next tick. This keeps `handPose` trivially testable with synthetic sequences and keeps all mutation in one place (`overlay.js`).

### 5.5 Shifter gate (`gearGate.ts`)

Pure function. Input: `gear` (0 = R, 1..N = forward). Output: `{ x, y }` percentage offsets from shifter-base center.

For FH5 cars typically ≤6 forward gears, render an H-pattern grid:

```
1   3   5
 R   N   7
2   4   6
```

For >6 forward gears (rare; some hypercars), fall back to sequential vertical positioning. The CSS positions the knob via `transform: translate(${x}%, ${y}%)` against a `transform-origin: center`.

### 5.6 Overlay client (`overlay.js`)

Single file, no build step, no framework. Responsibilities:

1. **Connect WS** to `ws://${location.host}/telemetry`. On `message`, write the parsed packet into a single mutable `latest` variable.
2. **Reconnect** on close with backoff: 250ms, 500ms, 1s, 2s, 5s (cap), reset on successful open.
3. **rAF loop** reads `latest` once per frame and applies DOM transforms:
   - Wheel: `transform: rotate(${clamp(steer, -1, 1) * rotationRange}deg)`
   - Pedal fills: `transform: scaleY(${clamp(value, 0, 1)})` with `transform-origin: bottom`
   - Shifter knob: `transform: translate(${x}%, ${y}%)` from `gearGate(gear)`
   - E-brake lever: `transform: rotate(${handbrake * maxAngleDeg}deg)`
   - Right hand: track previous pose; if `handPose(...)` returns a different pose, swap `src` to `assets/hand_right_<pose>.png` (browser caches all four after first load)
   - Gear text: `gear === 0 ? "R" : String(gear)`
   - Feet: `opacity` 1 when their pedal > 0, 0 otherwise
4. **Asset fallback:** every `<img>` slot starts as `<img src="assets/<slot>.png" data-fallback="assets/<slot>.svg">`. An `onerror` handler swaps to the SVG fallback (one shot — second failure leaves the broken-image icon, intentional so a typo is visible).

`overlay.js` reads `wheelRotationRangeDeg`, `shifterPoseDurationMs`, and `handbrakeEngageThreshold` from a small JSON document fetched at startup — see §5.7.

### 5.7 Passing config to the browser

The plugin registers one regular module route (via existing `ctx.registerRoute`): `GET /modules/driver-inputs/config.json` returning the module's user-facing config keys (`wheelRotationRangeDeg`, `shifterPoseDurationMs`, `handbrakeEngageThreshold`). `overlay.js` fetches this before starting the rAF loop.

Why a separate route under `/modules/...` rather than serving the JSON from the overlay's static dir:
- Keeps `index.html` and `overlay.js` as pure static files (no template interpolation; cacheable; user can override either with a single file copy).
- Doesn't collide with the overlay's asset namespace.
- Uses the existing `registerRoute` machinery — no new core surface beyond `registerOverlay` itself.

Plugin `onStart` therefore makes two calls: one `ctx.registerOverlay({ builtInDir, userDir })` and one `ctx.registerRoute("GET", "/config.json", handler)`. The handler reads `ctx.config` and returns it as JSON.

The same route is used by integration tests to assert config reaches the client.

### 5.8 Directory layout summary

```
src/
├── core/
│   ├── parser/
│   │   ├── TelemetryPacket.ts          (extended)
│   │   ├── PacketParser.ts             (thin re-export during transition)
│   │   └── parsers/
│   │       ├── ForzaDashParser.ts      (new)
│   │       └── fh5DashParser.ts        (new — contents from old PacketParser.ts)
│   ├── plugin-host/
│   │   ├── Plugin.ts                   (PluginContext gets registerOverlay)
│   │   └── PluginHost.ts               (forwards registerOverlay/unregisterOverlay)
│   └── http/
│       └── Server.ts                   (new registerOverlay/unregisterOverlay + handler)
├── modules/
│   ├── index.ts                        (registers driverInputs)
│   └── driver-inputs/                  (new module — full layout above)
└── index.ts                            (parser selection by cfg.input.game)
```

## 6. Configuration

**Top-level addition to `config.jsonc`:**

```jsonc
"input": {
  "type": "udp",
  "port": 9999,
  "game": "fh5"        // new — enum: "fh5" (default), "fh6" reserved
}
```

**Module slice:**

```jsonc
"modules": {
  "driver-inputs": {
    "enabled": true,
    "config": {
      "userAssetDir": null,
      "wheelRotationRangeDeg": 450,
      "shifterPoseDurationMs": 350,
      "handbrakeEngageThreshold": 0.1
    }
  }
}
```

`config.example.jsonc` updated with both blocks and explanatory comments.

JSON-schema validation enforces:
- `input.game` ∈ `{"fh5", "fh6"}`
- `wheelRotationRangeDeg` is a positive number ≤ 1800 (sanity bound)
- `shifterPoseDurationMs` is a non-negative integer
- `handbrakeEngageThreshold` is between 0 and 1
- `userAssetDir` is either null or a string

## 7. Error handling

| Failure mode | Handling |
|---|---|
| Packet shorter than parser's `minPacketSize` | Existing parse-error path: log warn, drop packet, no bus publish. Overlay keeps painting last state. |
| Packet format mismatch (FH6 packet against FH5 parser) | Garbage values; the overlay clamps `steer` to [-1, 1] and pedals to [0, 1], so visuals stay sane. Real fix is flipping `input.game`. |
| Pithouse not running or wrong outbound port | Zero packets at FTS; `/health` shows zero; overlay holds idle state. Not detectable as an error condition on FTS's side. |
| User asset file unreadable | Express `sendFile` errors → handler logs and returns 404; overlay's per-`<img>` `onerror` falls back to SVG once. |
| Overlay loses WS connection | `overlay.js` reconnects with capped exponential backoff. rAF loop continues painting last-known state. |
| Plugin `onStart` throws (e.g., built-in dir missing) | Existing `PluginHost` crash-isolation marks module errored; `/overlays/driver-inputs/*` returns 503; Admin Panel surfaces the error. |
| User passes a `userAssetDir` that doesn't exist | Schema-valid (any string); per-file fallback to built-in handles it silently. Logged once at module start as a warning. |
| Path traversal attempt | `startsWith(rootResolved + path.sep)` boundary check rejects it; handler returns 404 (not 403, to avoid confirming the file exists outside root). |

## 8. Testing

### 8.1 Unit tests (Vitest, co-located)

- **`fh5DashParser.test.ts`** — synthetic 324-byte buffers; assert each new field decodes correctly at the documented offsets, including boundary values (`steer = -127` → ≈ -1; `steer = 127` → ≈ 1; pedal bytes 0 → 0; pedal bytes 255 → 1).
- **`Server.registerOverlay.test.ts`** — table-driven:
  - user-dir hit (file exists in userDir, also in builtInDir → userDir wins)
  - built-in fallback (file exists only in builtInDir)
  - 404 (file missing from both)
  - traversal blocked (`../../etc/passwd` literal)
  - traversal blocked (URL-encoded `%2e%2e/%2e%2e/etc/passwd`)
  - 503 after `unregisterOverlay`
  - empty path → `index.html`
- **`handPose.test.ts`** — synthetic packet sequences asserting all four pose transitions and priority order:
  - gear change → `"shifter"` for the configured duration, then `"steering"`
  - handbrake during driving → `"ebrake"`
  - handbrake released → `"steering"`
  - gear 0 + zero pedals → `"floating"`
  - gear change while handbrake engaged → `"shifter"` wins (priority 1 over priority 2)
- **`gearGate.test.ts`** — table of `gear → { x, y }` for R, 0..6 (H-pattern) and 7..10 (sequential).
- **`plugin.test.ts`** — `driver-inputs` plugin's `onStart` calls `ctx.registerOverlay` with the expected `builtInDir` resolved relative to the module's location.

### 8.2 Integration test

`test/integration/driver-inputs.test.ts`:
- Boot full core with `MockInput` replaying `test/fixtures/skateboard-smoke.fzt`.
- `GET /overlays/driver-inputs/` → 200, HTML body contains the overlay's marker elements.
- `GET /overlays/driver-inputs/assets/wheel.svg` → 200, SVG content.
- `GET /modules/driver-inputs/config.json` → 200, JSON with `wheelRotationRangeDeg`, `shifterPoseDurationMs`, `handbrakeEngageThreshold`.
- Subscribe to `WS /telemetry`; assert received packets carry non-trivial `steer`, `throttle`, `brake` values across the recording.
- `POST /modules/driver-inputs/disable` → `GET /overlays/driver-inputs/` returns 503.
- `POST /modules/driver-inputs/enable` → returns 200 again.

### 8.3 Manual smoke (added to `TESTING.md`)

1. `start-fts.bat`; add `http://localhost:5780/overlays/driver-inputs/` as an OBS Browser Source (1920×1080 transparent).
2. Drive in FH5 for 60s with Pithouse in the chain:
   - Wheel rotates with steering input; direction matches what the in-game wheel does.
   - All three pedal bars fill/empty appropriately.
   - Gear text updates on each gear change.
   - Right hand swaps to `shifter` pose briefly on each gear change, returns to `steering`.
   - Engage handbrake → right hand → `ebrake`, e-brake lever rises, effect flashes.
3. Drop a single `wheel.png` into the configured `userAssetDir/assets/`; reload the browser source; only the wheel slot swaps; everything else remains on built-in SVG.
4. Pithouse-bypass reference run (one-time, for the assumption check):
   - Reconfigure Forza Data Out to send directly to FTS port 9999.
   - Drive for 30s; record `/health` packet count and a sample telemetry value.
   - Re-enable Pithouse-in-chain; repeat; numbers should match within drift expected from a 30s window.

## 9. Acceptance criteria

**Parser**
- [ ] `TelemetryPacket` exposes `steer` (-1..1), `throttle`/`brake`/`clutch`/`handbrake` (0..1)
- [ ] `fh5DashParser` lives behind `ForzaDashParser`; `input.game` selects implementation; default `"fh5"`
- [ ] Existing modules (backseat-speedometer, redline-alert) continue to work without code changes
- [ ] Replaying `skateboard-smoke.fzt` produces non-degenerate values for the new fields across the recording

**Core overlay helper**
- [ ] `ctx.registerOverlay({ builtInDir, userDir })` mounts `GET /overlays/:moduleId/*`
- [ ] User-dir-overrides-built-in resolution works file-by-file
- [ ] Path traversal blocked for `..` literals and URL-encoded forms
- [ ] Disabling the module returns 503 from overlay routes
- [ ] Re-enabling restores 200 responses

**Driver Inputs module**
- [ ] `GET /overlays/driver-inputs/` renders with built-in SVG placeholders, transparent background, no browser console errors
- [ ] Wheel rotation visually tracks `steer`; configured `wheelRotationRangeDeg` produces expected max rotation
- [ ] Three pedal bars track `throttle`/`brake`/`clutch`; idle = empty, full press = full
- [ ] Right hand state machine transitions per §5.4 priority order
- [ ] Gear text updates each gear change; gear 0 renders as `R`
- [ ] Single-file user override: dropping `wheel.png` into `userAssetDir/assets/` swaps only that slot
- [ ] Pithouse-in-chain smoke run: `/health` packet count non-zero; parsed values match the bypass reference run

## 10. Decision log

| # | Decision | Alternatives considered | Why |
|---|---|---|---|
| 1 | Single-overlay scope + minimal overlay-serving convention | Full Bicycle phase (4 overlays); single overlay with zero core changes | Smallest deliverable that earns reusable conventions; future overlays become mostly UI work |
| 2 | Forza telemetry as the only input source | Moza wheelbase direct (Boxflat-style); Forza now with abstraction for wheelbase later | Forza's reported `steer` matches what the game does, which is what the viewer sees on screen; wheelbase-direct is speculative scope and hardware-coupled |
| 3 | Wheel + 3 pedal bars + gear text + shifter + e-brake + 7-slot hand/foot asset model | Strict wheel-only; minimal (no shifter/e-brake); skip hands/feet | Matches RacingOverlay's visual model per user direction; pedals as bars (not tilting images) per user clarification |
| 4 | Hand-pose driven by heuristic state machine over Forza inputs | Static "steering" pose only; physical-hand tracking (impossible without external sensors) | Forza doesn't expose physical hand state; gear-change + handbrake + idle are the only honest signals; matches RacingOverlay |
| 5 | Built-in SVG placeholder + PNG-or-SVG user override (no themes folder) | Themes folder with picker (RacingOverlay parity); PNG-only with no built-in fallback | Single-user single-rig context; user-dir override is enough; themes is speculative scope per project YAGNI rules |
| 6 | New `registerOverlay` method on `PluginContext` | Module hand-rolls asset fallback via `registerRoute`; full `OverlayRegistry` framework | Asset-fallback logic in one place; future overlays inherit it for free; doesn't introduce speculative metadata/listing/theme surface |
| 7 | FH version selection via config flag | Byte-sniff auto-detection | Sniffing FH5 vs FH6 from packet bytes is fragile; one flag is honest and reviewable |
| 8 | rAF render loop reading last-known packet | Render-on-WS-message; polling `/telemetry/latest` | Decouples 60Hz UDP from display refresh; dropped packets repaint last state without stutter |
| 9 | Pithouse role flipped from downstream (per 2026-04-18 spec) to upstream relay | Pithouse as downstream `rawOutput` destination | Real setup confirmed during 2026-05-10 brainstorm; FTS code unaffected — only documentation/examples shift |
| 10 | No hot-reload of overlay HTML | File-watcher in dev; live-reload websocket | Refreshing the OBS source manually is one click; live-reload is its own surface; pure scope creep |

---

**End of design document.**
