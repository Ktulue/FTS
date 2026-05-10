# Driver Inputs Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a browser-source overlay at `GET /overlays/driver-inputs/` that visualizes wheel rotation, three pedal bars, gear text, shifter, and e-brake from Forza Horizon UDP telemetry, and establish minimal overlay-serving conventions (one new `PluginContext.registerOverlay` method) for future Bicycle overlays.

**Architecture:** Parser refactor splits packet decoding behind a `ForzaDashParser` interface (FH5 only today, FH6-ready). A new `Server.registerOverlay(moduleId, { builtInDir, userDir })` mounts an Express handler at `/overlays/:moduleId/*` that serves the user dir first, falls back to the module's built-in dir, blocks path traversal. The `driver-inputs` module is a plain `Plugin` with no `onTelemetry`; its `onStart` registers the overlay and a `/modules/driver-inputs/config.json` route. Browser-side, `overlay.js` opens `WS /telemetry`, runs a `requestAnimationFrame` loop that applies CSS transforms to layered `<img>` elements (wheel + hands + shifter + e-brake + pedal bars + feet + gear text). A pure `handPose` state machine drives right-hand pose; a pure `gearGate` function positions the shifter knob.

**Tech Stack:** TypeScript / Node 20+ / Vite tsx, Express, ws, Ajv (JSON schema), Vitest, plain JS + SVG for the browser side (no framework, no build step).

---

**Spec reference:** `docs/superpowers/specs/2026-05-10-driver-inputs-overlay-design.md`

**File map (created or modified by this plan):**

| Action | Path | Responsibility |
|---|---|---|
| Create | `src/core/parser/parsers/ForzaDashParser.ts` | Interface |
| Create | `src/core/parser/parsers/fh5DashParser.ts` | FH5 implementation (contents moved from `PacketParser.ts`) |
| Create | `src/core/parser/parsers/fh5DashParser.test.ts` | Renamed/extended from `PacketParser.test.ts` |
| Delete | `src/core/parser/PacketParser.ts` | Replaced by `parsers/fh5DashParser.ts` |
| Delete | `src/core/parser/PacketParser.test.ts` | Replaced by `parsers/fh5DashParser.test.ts` |
| Modify | `src/core/parser/TelemetryPacket.ts` | Add `steer`, `throttle`, `brake`, `clutch`, `handbrake` |
| Modify | `src/core/config/types.ts` | Add `game?: "fh5" \| "fh6"` to `UDPInputConfig` and `MockInputConfig` |
| Modify | `src/core/config/schema.ts` | Add `game` enum to both input branches |
| Modify | `src/index.ts` | Select parser via `cfg.input.game` |
| Modify | `src/core/plugin-host/Plugin.ts` | Add `registerOverlay` to `PluginContext` |
| Modify | `src/core/plugin-host/PluginHost.ts` | Forward `registerOverlay`; call `unregisterOverlay` on stop |
| Modify | `src/core/http/Server.ts` | Add `registerOverlay` / `unregisterOverlay` + dynamic `/overlays/:moduleId/*` handler |
| Modify | `src/core/http/Server.test.ts` | Add resolver + traversal tests |
| Create | `src/modules/driver-inputs/plugin.ts` | Plugin shape; `onStart` registers overlay + config route |
| Create | `src/modules/driver-inputs/handPose.ts` | Pure right-hand pose state machine |
| Create | `src/modules/driver-inputs/handPose.test.ts` | Unit tests |
| Create | `src/modules/driver-inputs/gearGate.ts` | Pure gear → `{x, y}` mapping |
| Create | `src/modules/driver-inputs/gearGate.test.ts` | Unit tests |
| Create | `src/modules/driver-inputs/config.schema.json` | Module config JSON schema |
| Create | `src/modules/driver-inputs/plugin.test.ts` | `onStart` calls `registerOverlay` with the right dirs |
| Create | `src/modules/driver-inputs/README.md` | What it is, how to override assets |
| Create | `src/modules/driver-inputs/public/index.html` | Overlay shell |
| Create | `src/modules/driver-inputs/public/overlay.css` | Layout |
| Create | `src/modules/driver-inputs/public/overlay.js` | WS client, rAF loop, pose swapping |
| Create | `src/modules/driver-inputs/public/assets/*.svg` | 15 placeholder SVG slots |
| Modify | `src/modules/index.ts` | Register `driverInputs` |
| Create | `test/integration/driver-inputs.test.ts` | End-to-end with MockInput |
| Modify | `config.example.jsonc` | Add `input.game` + `driver-inputs` module slice |
| Modify | `TESTING.md` | Add manual smoke entries |
| Modify | `TODO.md` | Last-shipped update + next-up adjustment |

**Commands you'll run repeatedly:**

```bash
npm test                                  # run all vitest unit + integration tests
npx vitest run path/to/file.test.ts      # run one test file
npm run typecheck                         # tsc --noEmit
npm start                                 # tsx src/index.ts (live server for manual smoke)
```

**Branch:** This plan is intended to be executed on `feat/driver-inputs-overlay`. Already on it.

---

## Task 1: Parser refactor — interface + FH5 implementation (no new fields yet)

Pure mechanical refactor. Behavior identical to today. New tests pass against the renamed module. This is intentionally split from the field-addition task so any breakage in step 2 is unambiguous.

**Files:**
- Create: `src/core/parser/parsers/ForzaDashParser.ts`
- Create: `src/core/parser/parsers/fh5DashParser.ts`
- Create: `src/core/parser/parsers/fh5DashParser.test.ts`
- Delete: `src/core/parser/PacketParser.ts`
- Delete: `src/core/parser/PacketParser.test.ts`
- Modify: `src/index.ts:7` (import statement)

- [ ] **Step 1: Write the new test file**

Create `src/core/parser/parsers/fh5DashParser.test.ts` with the existing test content but imported from the new module:

```ts
import { describe, it, expect } from "vitest";
import { fh5DashParser } from "./fh5DashParser.js";

const DASH_PACKET_SIZE = 324;

function buildDashBuffer(): Buffer {
  const buf = Buffer.alloc(DASH_PACKET_SIZE);
  buf.writeInt32LE(1, 0);
  buf.writeUInt32LE(12345, 4);
  buf.writeFloatLE(7500, 8);
  buf.writeFloatLE(6800, 16);
  buf.writeFloatLE(0.12, 20);
  buf.writeFloatLE(0.00, 28);
  buf.writeFloatLE(0.01, 84);
  buf.writeFloatLE(0.02, 88);
  buf.writeFloatLE(0.03, 92);
  buf.writeFloatLE(0.04, 96);
  buf.writeInt32LE(2345, 212);
  buf.writeInt32LE(3, 216);
  buf.writeInt32LE(1, 224);
  buf.writeFloatLE(52.3, 244);
  buf.writeUInt8(4, 307);
  return buf;
}

describe("fh5DashParser", () => {
  it("exposes id 'fh5' and minPacketSize 324", () => {
    expect(fh5DashParser.id).toBe("fh5");
    expect(fh5DashParser.minPacketSize).toBe(324);
  });

  it("parses a complete Dash packet", () => {
    const buf = buildDashBuffer();
    const pkt = fh5DashParser.parse(buf, 1700000000000);
    expect(pkt.timestamp).toBe(1700000000000);
    expect(pkt.isRaceOn).toBe(true);
    expect(pkt.maxRpm).toBeCloseTo(7500, 1);
    expect(pkt.rpm).toBeCloseTo(6800, 1);
    expect(pkt.accelLateral).toBeCloseTo(0.12, 2);
    expect(pkt.accelLongitudinal).toBeCloseTo(0, 2);
    expect(pkt.tireSlipRatio.fl).toBeCloseTo(0.01, 3);
    expect(pkt.tireSlipRatio.fr).toBeCloseTo(0.02, 3);
    expect(pkt.tireSlipRatio.rl).toBeCloseTo(0.03, 3);
    expect(pkt.tireSlipRatio.rr).toBeCloseTo(0.04, 3);
    expect(pkt.carOrdinal).toBe(2345);
    expect(pkt.carClass).toBe(3);
    expect(pkt.drivetrainType).toBe(1);
    expect(pkt.speed).toBeCloseTo(52.3, 1);
    expect(pkt.gear).toBe(4);
  });

  it("decodes isRaceOn=false when byte is zero", () => {
    const buf = buildDashBuffer();
    buf.writeInt32LE(0, 0);
    const pkt = fh5DashParser.parse(buf, 1700000000000);
    expect(pkt.isRaceOn).toBe(false);
  });

  it("throws on wrong-sized buffer", () => {
    const buf = Buffer.alloc(100);
    expect(() => fh5DashParser.parse(buf, 1700000000000)).toThrow();
  });
});
```

- [ ] **Step 2: Run test, expect FAIL (module not found)**

```bash
npx vitest run src/core/parser/parsers/fh5DashParser.test.ts
```

Expected: FAIL — cannot find module `./fh5DashParser.js`.

- [ ] **Step 3: Create the interface**

Create `src/core/parser/parsers/ForzaDashParser.ts`:

```ts
import type { TelemetryPacket } from "../TelemetryPacket.js";

export interface ForzaDashParser {
  readonly id: "fh5" | "fh6";
  readonly minPacketSize: number;
  parse(buf: Buffer, receiveTimestamp: number): TelemetryPacket;
}
```

- [ ] **Step 4: Create the FH5 implementation**

Create `src/core/parser/parsers/fh5DashParser.ts` with the existing `parseDashPacket` body wrapped in the interface shape:

```ts
import type { TelemetryPacket } from "../TelemetryPacket.js";
import type { ForzaDashParser } from "./ForzaDashParser.js";

const DASH_PACKET_SIZE = 324;

export const fh5DashParser: ForzaDashParser = {
  id: "fh5",
  minPacketSize: DASH_PACKET_SIZE,
  parse(buf: Buffer, receiveTimestamp: number): TelemetryPacket {
    if (buf.length < DASH_PACKET_SIZE) {
      throw new Error(
        `Invalid packet size: got ${buf.length}, expected at least ${DASH_PACKET_SIZE}`,
      );
    }
    return {
      timestamp: receiveTimestamp,
      isRaceOn: buf.readInt32LE(0) !== 0,
      maxRpm: buf.readFloatLE(8),
      rpm: buf.readFloatLE(16),
      accelLateral: buf.readFloatLE(20),
      accelLongitudinal: buf.readFloatLE(28),
      tireSlipRatio: {
        fl: buf.readFloatLE(84),
        fr: buf.readFloatLE(88),
        rl: buf.readFloatLE(92),
        rr: buf.readFloatLE(96),
      },
      carOrdinal: buf.readInt32LE(212),
      carClass: buf.readInt32LE(216),
      drivetrainType: buf.readInt32LE(224),
      speed: buf.readFloatLE(244),
      gear: buf.readUInt8(307),
    };
  },
};
```

- [ ] **Step 5: Run new test, expect PASS**

```bash
npx vitest run src/core/parser/parsers/fh5DashParser.test.ts
```

Expected: PASS (4/4).

- [ ] **Step 6: Update `src/index.ts` import**

In `src/index.ts`, change the import line:

From:
```ts
import { parseDashPacket } from "./core/parser/PacketParser.js";
```

To:
```ts
import { fh5DashParser } from "./core/parser/parsers/fh5DashParser.js";
```

And in `main()`, find the line:
```ts
const pkt = parseDashPacket(raw, Date.now());
```

Change to:
```ts
const pkt = fh5DashParser.parse(raw, Date.now());
```

- [ ] **Step 7: Delete old files**

```bash
git rm src/core/parser/PacketParser.ts src/core/parser/PacketParser.test.ts
```

- [ ] **Step 8: Run full test suite + typecheck**

```bash
npm run typecheck && npm test
```

Expected: all tests pass; no type errors.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "refactor: extract ForzaDashParser interface + fh5DashParser

Pure refactor with identical behavior. Drops PacketParser.ts and
PacketParser.test.ts in favor of parsers/fh5DashParser.ts behind a
ForzaDashParser interface, prepping for FH6 to drop in as a sibling.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Add input fields to TelemetryPacket and fh5DashParser

Extend the packet shape and decoder with `steer`, `throttle`, `brake`, `clutch`, `handbrake`. Existing modules continue to compile (they don't read these fields).

**Files:**
- Modify: `src/core/parser/TelemetryPacket.ts`
- Modify: `src/core/parser/parsers/fh5DashParser.ts`
- Modify: `src/core/parser/parsers/fh5DashParser.test.ts`

- [ ] **Step 1: Add failing tests for the new fields**

Append to the existing `describe("fh5DashParser", ...)` block in `src/core/parser/parsers/fh5DashParser.test.ts`:

```ts
  it("decodes steer at offset 308 as signed int8 normalized to -1..1", () => {
    const buf = buildDashBuffer();
    // Full-left
    buf.writeInt8(-127, 308);
    let pkt = fh5DashParser.parse(buf, 0);
    expect(pkt.steer).toBeCloseTo(-1, 3);
    // Center
    buf.writeInt8(0, 308);
    pkt = fh5DashParser.parse(buf, 0);
    expect(pkt.steer).toBe(0);
    // Full-right
    buf.writeInt8(127, 308);
    pkt = fh5DashParser.parse(buf, 0);
    expect(pkt.steer).toBeCloseTo(1, 3);
  });

  it("clamps extreme steer values to [-1, 1]", () => {
    const buf = buildDashBuffer();
    // -128 / 127 would be -1.0078; must clamp to -1
    buf.writeInt8(-128, 308);
    const pkt = fh5DashParser.parse(buf, 0);
    expect(pkt.steer).toBe(-1);
  });

  it("decodes throttle/brake/clutch/handbrake at offsets 303-306 as uint8 / 255", () => {
    const buf = buildDashBuffer();
    buf.writeUInt8(0, 303);   buf.writeUInt8(0, 304);
    buf.writeUInt8(0, 305);   buf.writeUInt8(0, 306);
    let pkt = fh5DashParser.parse(buf, 0);
    expect(pkt.throttle).toBe(0);
    expect(pkt.brake).toBe(0);
    expect(pkt.clutch).toBe(0);
    expect(pkt.handbrake).toBe(0);

    buf.writeUInt8(255, 303); buf.writeUInt8(255, 304);
    buf.writeUInt8(255, 305); buf.writeUInt8(255, 306);
    pkt = fh5DashParser.parse(buf, 0);
    expect(pkt.throttle).toBe(1);
    expect(pkt.brake).toBe(1);
    expect(pkt.clutch).toBe(1);
    expect(pkt.handbrake).toBe(1);

    buf.writeUInt8(128, 303);
    pkt = fh5DashParser.parse(buf, 0);
    expect(pkt.throttle).toBeCloseTo(128 / 255, 4);
  });
```

- [ ] **Step 2: Run, expect FAIL (TS error: field not on TelemetryPacket)**

```bash
npx vitest run src/core/parser/parsers/fh5DashParser.test.ts
```

Expected: FAIL — type error or `pkt.steer is undefined`.

- [ ] **Step 3: Add fields to TelemetryPacket**

Edit `src/core/parser/TelemetryPacket.ts`, append before the closing brace:

```ts
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
```

- [ ] **Step 4: Decode the fields in fh5DashParser**

Edit `src/core/parser/parsers/fh5DashParser.ts`. In the returned object, add (after `gear`):

```ts
      gear: buf.readUInt8(307),
      steer: Math.max(-1, Math.min(1, buf.readInt8(308) / 127)),
      throttle: buf.readUInt8(303) / 255,
      brake: buf.readUInt8(304) / 255,
      clutch: buf.readUInt8(305) / 255,
      handbrake: buf.readUInt8(306) / 255,
```

- [ ] **Step 5: Run tests, expect PASS**

```bash
npx vitest run src/core/parser/parsers/fh5DashParser.test.ts
```

Expected: PASS (all 7 tests).

- [ ] **Step 6: Run full suite + typecheck**

```bash
npm run typecheck && npm test
```

Expected: all green. Existing modules don't read the new fields, so they continue to work.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(parser): decode steer, throttle, brake, clutch, handbrake

Adds Forza Horizon 5 Dash packet input bytes (offsets 303-306, 308) to
TelemetryPacket. Steering is normalized to [-1, 1] with clamping for the
asymmetric int8 range. Pedals are uint8 / 255.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Config — add input.game flag and parser selection in src/index.ts

Adds `"game": "fh5"` (default) to the input config. Selects parser at startup. FH6 enum value is reserved.

**Files:**
- Modify: `src/core/config/types.ts`
- Modify: `src/core/config/schema.ts`
- Modify: `src/core/config/loadConfig.test.ts` (extend if it exists; check first)
- Modify: `src/index.ts`

- [ ] **Step 1: Inspect existing config test**

```bash
ls src/core/config/
```

If `loadConfig.test.ts` exists, read it. If not, skip — schema validation is exercised indirectly via integration tests later.

- [ ] **Step 2: Write a failing schema test**

If `src/core/config/loadConfig.test.ts` exists, append:

```ts
  it("accepts input.game: 'fh5'", () => {
    const cfg = loadValid({
      input: { type: "udp", port: 9999, game: "fh5" },
      http: { port: 5780 },
      logging: { level: "info", dir: "./logs" },
      modules: {},
      rawOutputs: [],
    });
    expect((cfg.input as any).game).toBe("fh5");
  });

  it("rejects unknown input.game", () => {
    expect(() =>
      loadValid({
        input: { type: "udp", port: 9999, game: "fh99" },
        http: { port: 5780 },
        logging: { level: "info", dir: "./logs" },
        modules: {},
        rawOutputs: [],
      }),
    ).toThrow(/game/);
  });
```

Where `loadValid` is the helper the existing tests use; mirror their pattern. If no test file exists, skip this step.

- [ ] **Step 3: Run, expect FAIL**

```bash
npx vitest run src/core/config/loadConfig.test.ts
```

Expected: FAIL (schema accepts the unknown value, or types reject it).

- [ ] **Step 4: Add `game` to config types**

Edit `src/core/config/types.ts`. Both input config interfaces:

```ts
export type ForzaGame = "fh5" | "fh6";

export interface UDPInputConfig {
  type: "udp";
  port: number;
  host?: string;
  game?: ForzaGame;
}

export interface MockInputConfig {
  type: "mock";
  file: string;
  loop?: boolean;
  speed?: number;
  game?: ForzaGame;
}
```

- [ ] **Step 5: Add `game` enum to JSON schema**

Edit `src/core/config/schema.ts`. In both `input.oneOf` branches' `properties`, add:

```ts
            game: { enum: ["fh5", "fh6"] },
```

The `udp` branch becomes:

```ts
        {
          type: "object",
          required: ["type", "port"],
          properties: {
            type: { const: "udp" },
            port: { type: "integer", minimum: 1, maximum: 65535 },
            host: { type: "string" },
            game: { enum: ["fh5", "fh6"] },
          },
          additionalProperties: false,
        },
```

The `mock` branch:

```ts
        {
          type: "object",
          required: ["type", "file"],
          properties: {
            type: { const: "mock" },
            file: { type: "string", minLength: 1 },
            loop: { type: "boolean" },
            speed: { type: "number", exclusiveMinimum: 0 },
            game: { enum: ["fh5", "fh6"] },
          },
          additionalProperties: false,
        },
```

- [ ] **Step 6: Run config test, expect PASS**

```bash
npx vitest run src/core/config/loadConfig.test.ts
```

Expected: PASS.

- [ ] **Step 7: Implement parser selection in src/index.ts**

Edit `src/index.ts`. Change the import:

From:
```ts
import { fh5DashParser } from "./core/parser/parsers/fh5DashParser.js";
```

To:
```ts
import { fh5DashParser } from "./core/parser/parsers/fh5DashParser.js";
import type { ForzaDashParser } from "./core/parser/parsers/ForzaDashParser.js";
```

Add a helper function above `main()`:

```ts
function createParser(cfg: FtsConfig): ForzaDashParser {
  const game = cfg.input.game ?? "fh5";
  switch (game) {
    case "fh5":
      return fh5DashParser;
    case "fh6":
      throw new Error("FH6 parser not yet implemented; set input.game to 'fh5'.");
    default:
      throw new Error(`Unknown input.game: ${game}`);
  }
}
```

In `main()`, after the config + logger setup, construct the parser:

```ts
  const parser = createParser(cfg);
```

Replace the existing parse call inside the input start callback:

From:
```ts
      const pkt = fh5DashParser.parse(raw, Date.now());
```

To:
```ts
      const pkt = parser.parse(raw, Date.now());
```

And update the log line at the bottom of `main()` to include the game:

```ts
  log.info(
    { input: cfg.input.type, game: cfg.input.game ?? "fh5", httpPort: cfg.http.port, modules: moduleRegistry.length },
    "FTS started",
  );
```

- [ ] **Step 8: Run full suite + typecheck**

```bash
npm run typecheck && npm test
```

Expected: green.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(config): add input.game enum, select parser at startup

Defaults to 'fh5'. 'fh6' is reserved in the schema; selecting it throws
until the FH6 parser lands.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Server.registerOverlay with path-traversal protection (TDD)

Adds the core overlay-serving handler. Resolution: user dir wins; built-in is the fallback. Traversal blocked. Disabled module returns 503.

**Files:**
- Modify: `src/core/http/Server.ts`
- Modify: `src/core/http/Server.test.ts`

- [ ] **Step 1: Read existing Server.test.ts**

```bash
npx vitest --reporter=verbose run src/core/http/Server.test.ts
```

Note the test bootstrap helpers (how it constructs a `Server`, the `bus`, the port-zero pattern). Reuse them in step 2.

- [ ] **Step 2: Write failing tests for registerOverlay**

Append to `src/core/http/Server.test.ts` (adapt the helper imports to match what the file already has at top):

```ts
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

describe("Server.registerOverlay", () => {
  let server: Server;
  let bus: TelemetryBus;
  let log: Logger;
  let builtIn: string;
  let userDir: string;
  let port: number;

  beforeEach(async () => {
    builtIn = mkdtempSync(path.join(tmpdir(), "fts-builtin-"));
    userDir = mkdtempSync(path.join(tmpdir(), "fts-user-"));
    mkdirSync(path.join(builtIn, "assets"), { recursive: true });
    writeFileSync(path.join(builtIn, "index.html"), "<html>built-in</html>");
    writeFileSync(path.join(builtIn, "assets", "wheel.svg"), "<svg>builtin-wheel</svg>");
    writeFileSync(path.join(builtIn, "assets", "pedal_fill.svg"), "<svg>builtin-pedal</svg>");

    bus = new TelemetryBus();
    log = makeTestLogger();   // use whatever helper the existing tests use
    server = new Server({ port: 0, bus, log });
    await server.start();
    port = (server.address() as { port: number }).port;
  });

  afterEach(async () => {
    await server.stop();
    rmSync(builtIn, { recursive: true, force: true });
    rmSync(userDir, { recursive: true, force: true });
  });

  it("serves index.html from built-in when no user dir", async () => {
    server.registerOverlay("test-mod", { builtInDir: builtIn });
    server.updateModuleState([{
      id: "test-mod", displayName: "Test", enabled: true, status: "running",
      errorCount: 0, lastError: null, customStatus: null,
    }]);
    const res = await fetch(`http://127.0.0.1:${port}/overlays/test-mod/`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<html>built-in</html>");
  });

  it("user dir overrides built-in per-file", async () => {
    mkdirSync(path.join(userDir, "assets"), { recursive: true });
    writeFileSync(path.join(userDir, "assets", "wheel.svg"), "<svg>USER</svg>");
    server.registerOverlay("test-mod", { builtInDir: builtIn, userDir });
    server.updateModuleState([{
      id: "test-mod", displayName: "Test", enabled: true, status: "running",
      errorCount: 0, lastError: null, customStatus: null,
    }]);

    const userRes = await fetch(`http://127.0.0.1:${port}/overlays/test-mod/assets/wheel.svg`);
    expect(await userRes.text()).toBe("<svg>USER</svg>");

    // Pedal not in user dir, falls back to built-in
    const builtinRes = await fetch(`http://127.0.0.1:${port}/overlays/test-mod/assets/pedal_fill.svg`);
    expect(await builtinRes.text()).toBe("<svg>builtin-pedal</svg>");
  });

  it("returns 404 when file missing from both dirs", async () => {
    server.registerOverlay("test-mod", { builtInDir: builtIn });
    server.updateModuleState([{
      id: "test-mod", displayName: "Test", enabled: true, status: "running",
      errorCount: 0, lastError: null, customStatus: null,
    }]);
    const res = await fetch(`http://127.0.0.1:${port}/overlays/test-mod/assets/nope.svg`);
    expect(res.status).toBe(404);
  });

  it("blocks literal '..' traversal", async () => {
    server.registerOverlay("test-mod", { builtInDir: builtIn });
    server.updateModuleState([{
      id: "test-mod", displayName: "Test", enabled: true, status: "running",
      errorCount: 0, lastError: null, customStatus: null,
    }]);
    const res = await fetch(`http://127.0.0.1:${port}/overlays/test-mod/../../etc/passwd`);
    expect(res.status).toBe(404);
  });

  it("blocks URL-encoded '..' traversal", async () => {
    server.registerOverlay("test-mod", { builtInDir: builtIn });
    server.updateModuleState([{
      id: "test-mod", displayName: "Test", enabled: true, status: "running",
      errorCount: 0, lastError: null, customStatus: null,
    }]);
    const res = await fetch(
      `http://127.0.0.1:${port}/overlays/test-mod/%2e%2e/%2e%2e/etc/passwd`,
    );
    expect(res.status).toBe(404);
  });

  it("returns 503 when module disabled", async () => {
    server.registerOverlay("test-mod", { builtInDir: builtIn });
    server.updateModuleState([{
      id: "test-mod", displayName: "Test", enabled: false, status: "stopped",
      errorCount: 0, lastError: null, customStatus: null,
    }]);
    const res = await fetch(`http://127.0.0.1:${port}/overlays/test-mod/`);
    expect(res.status).toBe(503);
  });

  it("returns 404 after unregisterOverlay", async () => {
    server.registerOverlay("test-mod", { builtInDir: builtIn });
    server.updateModuleState([{
      id: "test-mod", displayName: "Test", enabled: true, status: "running",
      errorCount: 0, lastError: null, customStatus: null,
    }]);
    server.unregisterOverlay("test-mod");
    const res = await fetch(`http://127.0.0.1:${port}/overlays/test-mod/`);
    expect(res.status).toBe(404);
  });
});
```

If `makeTestLogger` doesn't exist, replace with the existing pattern (probably `createRootLogger({ level: "error", pretty: false })`).

- [ ] **Step 3: Run, expect FAIL**

```bash
npx vitest run src/core/http/Server.test.ts
```

Expected: FAIL — `server.registerOverlay is not a function`.

- [ ] **Step 4: Implement registerOverlay in Server.ts**

Edit `src/core/http/Server.ts`. Add imports at the top:

```ts
import { existsSync, statSync } from "node:fs";
import path from "node:path";
```

Add private state alongside `moduleRoutes`:

```ts
  private overlays = new Map<string, { builtInDir: string; userDir?: string }>();
```

Add public methods to the class (before `private setupRoutes`):

```ts
  registerOverlay(moduleId: string, opts: { builtInDir: string; userDir?: string }): void {
    this.overlays.set(moduleId, { builtInDir: opts.builtInDir, userDir: opts.userDir });
  }

  unregisterOverlay(moduleId: string): void {
    this.overlays.delete(moduleId);
  }
```

In `setupRoutes()`, **before** the existing module-routes catch-all `this.app.use(...)` block, insert the overlay handler:

```ts
    this.app.get("/overlays/:moduleId/*", (req, res) => {
      const moduleId = req.params.moduleId;
      const entry = this.overlays.get(moduleId);
      if (!entry) { res.status(404).end(); return; }
      if (this.disabledModules.has(moduleId)) {
        res.status(503).json({ error: `Module ${moduleId} is disabled` });
        return;
      }

      const wildcard = (req.params as Record<string, string>)[0] ?? "";
      let requested: string;
      try {
        requested = decodeURIComponent(wildcard);
      } catch {
        res.status(404).end();
        return;
      }
      if (requested === "" || requested.endsWith("/")) {
        requested = path.join(requested, "index.html");
      }

      const dirs = entry.userDir ? [entry.userDir, entry.builtInDir] : [entry.builtInDir];
      for (const dir of dirs) {
        const rootResolved = path.resolve(dir);
        const candidate = path.resolve(rootResolved, requested);
        if (!candidate.startsWith(rootResolved + path.sep) && candidate !== rootResolved) {
          continue; // traversal — try next dir (which would fail the same check)
        }
        try {
          if (existsSync(candidate) && statSync(candidate).isFile()) {
            res.sendFile(candidate);
            return;
          }
        } catch {
          // permission / IO — skip to next dir
        }
      }
      res.status(404).end();
    });
```

Note: `this.app.get` registers this route before the module-routes `app.use` runs (Express matches in registration order). The `:moduleId` capture combined with `*` works in Express 4.

- [ ] **Step 5: Run tests, expect PASS**

```bash
npx vitest run src/core/http/Server.test.ts
```

Expected: PASS (all overlay tests + existing).

- [ ] **Step 6: Run full suite + typecheck**

```bash
npm run typecheck && npm test
```

Expected: green.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(core): Server.registerOverlay with user-dir override + traversal guard

New GET /overlays/:moduleId/* handler resolves user dir first, falls back
to built-in. Returns 503 for disabled modules, 404 for unknown modules
or missing files, 404 (not 403) for traversal attempts.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: PluginContext.registerOverlay wiring + bootstrap

Threads the new `registerOverlay` method through `Plugin.ts`, `PluginHost.ts`, and `src/index.ts`. Module disable now unregisters the overlay alongside routes.

**Files:**
- Modify: `src/core/plugin-host/Plugin.ts`
- Modify: `src/core/plugin-host/PluginHost.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Extend PluginContext interface**

Edit `src/core/plugin-host/Plugin.ts`. Add to `PluginContext`:

```ts
  /** Register a static-file overlay served at GET /overlays/<plugin.id>/* */
  registerOverlay(opts: { builtInDir: string; userDir?: string }): void;
```

- [ ] **Step 2: Extend PluginHost with overlay forwarding**

Edit `src/core/plugin-host/PluginHost.ts`.

Add new function-prop types near the top alongside the existing ones:

```ts
export type RegisterOverlayFn = (
  moduleId: string,
  opts: { builtInDir: string; userDir?: string },
) => void;

export type UnregisterOverlayFn = (moduleId: string) => void;
```

Extend `PluginHostOptions` with two new fields:

```ts
  registerOverlay?: RegisterOverlayFn;
  unregisterOverlay?: UnregisterOverlayFn;
```

In the constructor body, store them (default to no-ops):

```ts
    this.registerOverlay = opts.registerOverlay ?? (() => {});
    this.unregisterOverlay = opts.unregisterOverlay ?? (() => {});
```

And add the matching private fields near the existing `private unregisterRoutes` line:

```ts
  private registerOverlay: RegisterOverlayFn;
  private unregisterOverlay: UnregisterOverlayFn;
```

In `makeContext`, add a property after `registerRoute`:

```ts
      registerOverlay: (opts) => {
        this.registerOverlay(plugin.id, opts);
      },
```

In `stopPlugin`, after `this.unregisterRoutes(plugin.id);` add:

```ts
    this.unregisterOverlay(plugin.id);
```

- [ ] **Step 3: Wire src/index.ts to pass the new callbacks**

Edit `src/index.ts`. In the `PluginHost` constructor call (currently has `emit`, `registerRoute`, `unregisterRoutes`, `onStateChange`), add:

```ts
    registerOverlay: (moduleId, opts) => server.registerOverlay(moduleId, opts),
    unregisterOverlay: (moduleId) => server.unregisterOverlay(moduleId),
```

- [ ] **Step 4: Typecheck + tests**

```bash
npm run typecheck && npm test
```

Expected: green. Existing tests don't exercise the new API; that's fine — we'll cover it from the plugin and integration tests.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(plugin-host): expose registerOverlay through PluginContext

PluginHost forwards registerOverlay/unregisterOverlay to the Server.
Module stop unregisters the overlay alongside routes.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: handPose pure state machine

Pure function. Decides right-hand pose from inputs + timing. Tested in isolation with synthetic sequences.

**Files:**
- Create: `src/modules/driver-inputs/handPose.ts`
- Create: `src/modules/driver-inputs/handPose.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/modules/driver-inputs/handPose.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { handPose, type HandPoseInputs } from "./handPose.js";

const base: HandPoseInputs = {
  currGear: 3,
  handbrake: 0,
  throttle: 0.4,
  brake: 0,
  clutch: 0,
  nowMs: 1000,
  lastGearChangeMs: 0,
  shifterPoseDurationMs: 350,
  handbrakeEngageThreshold: 0.1,
};

describe("handPose", () => {
  it("returns 'shifter' within the duration after a gear change", () => {
    expect(handPose({ ...base, lastGearChangeMs: 800, nowMs: 1000 })).toBe("shifter");
    expect(handPose({ ...base, lastGearChangeMs: 800, nowMs: 1149 })).toBe("shifter");
  });

  it("returns 'steering' once the shifter duration elapses", () => {
    expect(handPose({ ...base, lastGearChangeMs: 800, nowMs: 1151 })).toBe("steering");
  });

  it("returns 'ebrake' while handbrake exceeds threshold", () => {
    expect(handPose({ ...base, handbrake: 0.5, lastGearChangeMs: 0, nowMs: 5000 })).toBe("ebrake");
  });

  it("'shifter' wins over 'ebrake' when both apply (priority)", () => {
    expect(
      handPose({ ...base, handbrake: 0.5, lastGearChangeMs: 4900, nowMs: 5000 }),
    ).toBe("shifter");
  });

  it("returns 'floating' when in neutral with no pedal input", () => {
    expect(
      handPose({
        ...base,
        currGear: 0,
        throttle: 0,
        brake: 0,
        clutch: 0,
        handbrake: 0,
        lastGearChangeMs: 0,
        nowMs: 5000,
      }),
    ).toBe("floating");
  });

  it("returns 'steering' as default", () => {
    expect(handPose({ ...base, lastGearChangeMs: 0, nowMs: 5000 })).toBe("steering");
  });

  it("does not return 'floating' if any pedal is non-zero in neutral", () => {
    expect(
      handPose({
        ...base,
        currGear: 0,
        throttle: 0.1,
        lastGearChangeMs: 0,
        nowMs: 5000,
      }),
    ).toBe("steering");
  });

  it("handbrake exactly at threshold is NOT 'ebrake'", () => {
    expect(
      handPose({ ...base, handbrake: 0.1, lastGearChangeMs: 0, nowMs: 5000 }),
    ).toBe("steering");
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
npx vitest run src/modules/driver-inputs/handPose.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement handPose**

Create `src/modules/driver-inputs/handPose.ts`:

```ts
export type HandPose = "shifter" | "ebrake" | "floating" | "steering";

export interface HandPoseInputs {
  currGear: number;
  handbrake: number;
  throttle: number;
  brake: number;
  clutch: number;
  nowMs: number;
  lastGearChangeMs: number;
  shifterPoseDurationMs: number;
  handbrakeEngageThreshold: number;
}

export function handPose(i: HandPoseInputs): HandPose {
  if (i.nowMs - i.lastGearChangeMs < i.shifterPoseDurationMs) return "shifter";
  if (i.handbrake > i.handbrakeEngageThreshold) return "ebrake";
  if (
    i.currGear === 0 &&
    i.throttle === 0 &&
    i.brake === 0 &&
    i.clutch === 0
  ) {
    return "floating";
  }
  return "steering";
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
npx vitest run src/modules/driver-inputs/handPose.test.ts
```

Expected: PASS (8/8).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(driver-inputs): pure right-hand pose state machine

Inputs in, pose out, no state. Caller (overlay client) tracks
lastGearChangeMs.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: gearGate pure function

Maps `gear` → `{ x, y }` percentage offsets for shifter-knob translation. H-pattern for ≤6 forward gears, sequential vertical for >6.

**Files:**
- Create: `src/modules/driver-inputs/gearGate.ts`
- Create: `src/modules/driver-inputs/gearGate.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/modules/driver-inputs/gearGate.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { gearGate } from "./gearGate.js";

describe("gearGate", () => {
  it("places R bottom-left of the H-pattern", () => {
    const { x, y } = gearGate(0);
    expect(x).toBeLessThan(0);     // left column
    expect(y).toBeGreaterThan(0);  // bottom row
  });

  it("places 1 top-left", () => {
    const { x, y } = gearGate(1);
    expect(x).toBeLessThan(0);
    expect(y).toBeLessThan(0);
  });

  it("places 2 bottom-left", () => {
    const { x, y } = gearGate(2);
    expect(x).toBeLessThan(0);
    expect(y).toBeGreaterThan(0);
  });

  it("places 3 top-middle", () => {
    const { x, y } = gearGate(3);
    expect(x).toBe(0);
    expect(y).toBeLessThan(0);
  });

  it("places 4 bottom-middle", () => {
    const { x, y } = gearGate(4);
    expect(x).toBe(0);
    expect(y).toBeGreaterThan(0);
  });

  it("places 5 top-right", () => {
    const { x, y } = gearGate(5);
    expect(x).toBeGreaterThan(0);
    expect(y).toBeLessThan(0);
  });

  it("places 6 bottom-right", () => {
    const { x, y } = gearGate(6);
    expect(x).toBeGreaterThan(0);
    expect(y).toBeGreaterThan(0);
  });

  it("falls back to sequential vertical for gears > 6", () => {
    const g7 = gearGate(7);
    const g8 = gearGate(8);
    expect(g7.x).toBe(0);
    expect(g8.x).toBe(0);
    expect(g8.y).toBeLessThan(g7.y);   // higher gear → higher on screen
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
npx vitest run src/modules/driver-inputs/gearGate.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement gearGate**

Create `src/modules/driver-inputs/gearGate.ts`:

```ts
export interface GatePosition {
  /** Horizontal offset from center, in percent (-X = left). */
  x: number;
  /** Vertical offset from center, in percent (+Y = down). */
  y: number;
}

const COL_OFFSET = 40;
const ROW_OFFSET = 30;

const H_PATTERN: Record<number, GatePosition> = {
  0: { x: -COL_OFFSET, y:  ROW_OFFSET }, // R
  1: { x: -COL_OFFSET, y: -ROW_OFFSET },
  2: { x: -COL_OFFSET, y:  ROW_OFFSET },
  3: { x: 0,            y: -ROW_OFFSET },
  4: { x: 0,            y:  ROW_OFFSET },
  5: { x:  COL_OFFSET, y: -ROW_OFFSET },
  6: { x:  COL_OFFSET, y:  ROW_OFFSET },
};

export function gearGate(gear: number): GatePosition {
  const fixed = H_PATTERN[gear];
  if (fixed) return fixed;
  // Sequential for >6: gear 7 at top of bar, climbing further up per gear.
  return { x: 0, y: -ROW_OFFSET - (gear - 6) * 10 };
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
npx vitest run src/modules/driver-inputs/gearGate.test.ts
```

Expected: PASS (8/8).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(driver-inputs): gearGate pure mapping for shifter knob

H-pattern for gears R..6, sequential for >6.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Driver Inputs plugin shell + config schema + registration test

Plugin shape, JSON schema, and the `onStart` that calls `registerOverlay` and registers the `config.json` route. Built-in SVG assets land in Task 9; this task ships the plugin code and its test.

**Files:**
- Create: `src/modules/driver-inputs/config.schema.json`
- Create: `src/modules/driver-inputs/plugin.ts`
- Create: `src/modules/driver-inputs/plugin.test.ts`
- Create: `src/modules/driver-inputs/README.md`

- [ ] **Step 1: Write the plugin config schema**

Create `src/modules/driver-inputs/config.schema.json`:

```json
{
  "type": "object",
  "properties": {
    "userAssetDir": { "type": ["string", "null"] },
    "wheelRotationRangeDeg": { "type": "number", "exclusiveMinimum": 0, "maximum": 1800 },
    "shifterPoseDurationMs": { "type": "integer", "minimum": 0 },
    "handbrakeEngageThreshold": { "type": "number", "minimum": 0, "maximum": 1 }
  },
  "additionalProperties": false
}
```

- [ ] **Step 2: Write failing plugin test**

Create `src/modules/driver-inputs/plugin.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { driverInputs } from "./plugin.js";

function makeCtx(overrides: Partial<{ config: unknown }> = {}) {
  const registerOverlay = vi.fn();
  const registerRoute = vi.fn();
  const emit = vi.fn();
  return {
    emit,
    registerRoute,
    registerOverlay,
    log: {
      info: vi.fn(), warn: vi.fn(), error: vi.fn(),
      debug: vi.fn(), trace: vi.fn(), fatal: vi.fn(),
    },
    config: overrides.config ?? {},
  };
}

describe("driverInputs plugin", () => {
  it("has the expected metadata", () => {
    expect(driverInputs.id).toBe("driver-inputs");
    expect(driverInputs.displayName).toBeTruthy();
  });

  it("registers the overlay with its public/ dir as builtInDir", async () => {
    const ctx = makeCtx();
    await driverInputs.onStart(ctx as any);
    expect(ctx.registerOverlay).toHaveBeenCalledTimes(1);
    const callArg = ctx.registerOverlay.mock.calls[0][0];
    const expectedBuiltIn = fileURLToPath(new URL("./public", import.meta.url));
    expect(path.resolve(callArg.builtInDir)).toBe(path.resolve(expectedBuiltIn));
    expect(callArg.userDir).toBeUndefined();
  });

  it("forwards a configured userAssetDir to registerOverlay", async () => {
    const ctx = makeCtx({ config: { userAssetDir: "/tmp/my-art" } });
    await driverInputs.onStart(ctx as any);
    const callArg = ctx.registerOverlay.mock.calls[0][0];
    expect(callArg.userDir).toBe("/tmp/my-art");
  });

  it("registers a GET /modules/driver-inputs/config.json route", async () => {
    const ctx = makeCtx({
      config: {
        wheelRotationRangeDeg: 450,
        shifterPoseDurationMs: 350,
        handbrakeEngageThreshold: 0.1,
      },
    });
    await driverInputs.onStart(ctx as any);
    const routeCall = ctx.registerRoute.mock.calls.find(
      (c: unknown[]) => c[0] === "GET" && c[1] === "/modules/driver-inputs/config.json",
    );
    expect(routeCall).toBeDefined();
    const handler = routeCall![2] as (req: unknown, res: unknown) => void;
    const sent: unknown[] = [];
    const res = { json: (b: unknown) => { sent.push(b); } };
    handler({}, res);
    expect(sent[0]).toEqual({
      wheelRotationRangeDeg: 450,
      shifterPoseDurationMs: 350,
      handbrakeEngageThreshold: 0.1,
    });
  });
});
```

- [ ] **Step 3: Run, expect FAIL**

```bash
npx vitest run src/modules/driver-inputs/plugin.test.ts
```

Expected: FAIL — `driverInputs` not found.

- [ ] **Step 4: Implement the plugin**

Create `src/modules/driver-inputs/plugin.ts`:

```ts
import { fileURLToPath } from "node:url";
import type { Plugin, PluginContext } from "../../core/plugin-host/Plugin.js";
import type { Request, Response } from "express";
import schema from "./config.schema.json" with { type: "json" };

interface Config {
  userAssetDir?: string | null;
  wheelRotationRangeDeg?: number;
  shifterPoseDurationMs?: number;
  handbrakeEngageThreshold?: number;
}

const DEFAULTS: Required<Omit<Config, "userAssetDir">> = {
  wheelRotationRangeDeg: 450,
  shifterPoseDurationMs: 350,
  handbrakeEngageThreshold: 0.1,
};

export const driverInputs: Plugin = {
  id: "driver-inputs",
  displayName: "Driver Inputs Overlay",
  description: "Browser-source overlay: wheel, three pedal bars, gear, shifter, e-brake.",
  configSchema: schema as object,

  onStart(ctx: PluginContext) {
    const cfg = (ctx.config ?? {}) as Config;
    const builtInDir = fileURLToPath(new URL("./public", import.meta.url));
    const userDir = cfg.userAssetDir ?? undefined;
    ctx.registerOverlay({ builtInDir, userDir: userDir ?? undefined });

    ctx.registerRoute(
      "GET",
      "/modules/driver-inputs/config.json",
      (_req: Request, res: Response) => {
        res.json({
          wheelRotationRangeDeg: cfg.wheelRotationRangeDeg ?? DEFAULTS.wheelRotationRangeDeg,
          shifterPoseDurationMs: cfg.shifterPoseDurationMs ?? DEFAULTS.shifterPoseDurationMs,
          handbrakeEngageThreshold:
            cfg.handbrakeEngageThreshold ?? DEFAULTS.handbrakeEngageThreshold,
        });
      },
    );

    ctx.log.info({ builtInDir, userDir }, "driver-inputs overlay registered");
  },

  onStop() {
    // No persistent state; overlay/routes are unmounted by the host.
  },
};
```

Note: `import ... with { type: "json" }` is the ES2025 JSON import attribute, supported by Node 22+/tsx. If your TS config rejects this, fall back to `JSON.parse(readFileSync(...))` at the top of the file.

- [ ] **Step 5: Run, expect PASS**

```bash
npx vitest run src/modules/driver-inputs/plugin.test.ts
```

Expected: PASS (4/4).

- [ ] **Step 6: Write the module README**

Create `src/modules/driver-inputs/README.md`:

```md
# Driver Inputs Overlay

Browser-source overlay served at `GET /overlays/driver-inputs/`. Visualizes wheel, three pedal bars, gear, shifter, and e-brake from Forza Horizon telemetry.

## Use in OBS

Add a Browser Source pointing at `http://localhost:5780/overlays/driver-inputs/`. Sizes via CSS to its viewport — pick whatever browser-source dimensions you like.

## Configuration (`config.jsonc`)

```jsonc
"driver-inputs": {
  "enabled": true,
  "config": {
    "userAssetDir": null,                  // or "C:/.../my-assets"
    "wheelRotationRangeDeg": 450,          // visual degrees each way at steer = ±1
    "shifterPoseDurationMs": 350,          // right-hand 'shifter' pose duration after a gear change
    "handbrakeEngageThreshold": 0.1        // handbrake above this → right-hand 'ebrake' pose
  }
}
```

## Replacing the placeholder art

The overlay ships with neutral SVG placeholders so it works out of the box. To use your own art, set `userAssetDir` to a directory containing an `assets/` subfolder with any of:

- `wheel.png`
- `hand_left.png`
- `hand_right_steering.png`, `hand_right_shifter.png`, `hand_right_ebrake.png`, `hand_right_floating.png`
- `shifter_base.png`, `shifter_knob.png`
- `ebrake.png`, `ebrake_base.png`, `ebrake_effect.png`
- `pedal_base.png`, `pedal_fill.png`
- `foot_left.png`, `foot_right.png`

Any slot you don't provide falls back to the built-in SVG placeholder. Reload the OBS browser source after dropping new files in.
```

- [ ] **Step 7: Run full suite + typecheck**

```bash
npm run typecheck && npm test
```

Expected: green.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(driver-inputs): plugin shell + config schema + onStart wiring

Registers the overlay (with optional user-dir override) and the
/modules/driver-inputs/config.json route. Placeholder SVG assets land
in the next task.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Built-in SVG placeholder assets

Ship 15 neutral SVGs covering every slot the overlay can render. Keeps the overlay visible zero-config.

**Files:**
- Create: `src/modules/driver-inputs/public/assets/wheel.svg`
- Create: `src/modules/driver-inputs/public/assets/hand_left.svg`
- Create: `src/modules/driver-inputs/public/assets/hand_right_steering.svg`
- Create: `src/modules/driver-inputs/public/assets/hand_right_shifter.svg`
- Create: `src/modules/driver-inputs/public/assets/hand_right_ebrake.svg`
- Create: `src/modules/driver-inputs/public/assets/hand_right_floating.svg`
- Create: `src/modules/driver-inputs/public/assets/shifter_base.svg`
- Create: `src/modules/driver-inputs/public/assets/shifter_knob.svg`
- Create: `src/modules/driver-inputs/public/assets/ebrake.svg`
- Create: `src/modules/driver-inputs/public/assets/ebrake_base.svg`
- Create: `src/modules/driver-inputs/public/assets/ebrake_effect.svg`
- Create: `src/modules/driver-inputs/public/assets/pedal_base.svg`
- Create: `src/modules/driver-inputs/public/assets/pedal_fill.svg`
- Create: `src/modules/driver-inputs/public/assets/foot_left.svg`
- Create: `src/modules/driver-inputs/public/assets/foot_right.svg`

- [ ] **Step 1: Create wheel.svg**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
  <circle cx="100" cy="100" r="90" fill="none" stroke="#ddd" stroke-width="14"/>
  <circle cx="100" cy="100" r="14" fill="#ddd"/>
  <line x1="100" y1="14" x2="100" y2="34" stroke="#ddd" stroke-width="6"/>
  <line x1="20" y1="100" x2="186" y2="100" stroke="#ddd" stroke-width="6" opacity="0.5"/>
</svg>
```

- [ ] **Step 2: Create the two hand SVGs (left + steering pose)**

`hand_left.svg`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 80">
  <ellipse cx="30" cy="40" rx="22" ry="34" fill="#e8c9a0" stroke="#7a6249" stroke-width="3"/>
</svg>
```

`hand_right_steering.svg`: copy the same content as `hand_left.svg`. (Identical for the placeholder set — user replaces with proper art.)

- [ ] **Step 3: Create the three other right-hand poses**

`hand_right_shifter.svg`, `hand_right_ebrake.svg`, `hand_right_floating.svg`: each is the same ellipse SVG as `hand_left.svg`, but use different stroke colors so a developer can visually confirm the pose-swap state machine is firing:

- `hand_right_shifter.svg`: stroke `#3a7a49` (green tint)
- `hand_right_ebrake.svg`: stroke `#a04030` (red tint)
- `hand_right_floating.svg`: stroke `#3060a0` (blue tint)

Example for `hand_right_shifter.svg`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 80">
  <ellipse cx="30" cy="40" rx="22" ry="34" fill="#e8c9a0" stroke="#3a7a49" stroke-width="3"/>
</svg>
```

- [ ] **Step 4: Create shifter assets**

`shifter_base.svg`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
  <rect x="20" y="20" width="160" height="160" fill="none" stroke="#888" stroke-width="3"/>
  <line x1="100" y1="20" x2="100" y2="180" stroke="#888" stroke-width="2"/>
  <line x1="20" y1="100" x2="180" y2="100" stroke="#888" stroke-width="2"/>
</svg>
```

`shifter_knob.svg`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">
  <circle cx="20" cy="20" r="16" fill="#333" stroke="#aaa" stroke-width="2"/>
</svg>
```

- [ ] **Step 5: Create e-brake assets**

`ebrake_base.svg`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 120">
  <rect x="20" y="100" width="20" height="16" fill="#555" stroke="#888" stroke-width="2"/>
</svg>
```

`ebrake.svg` (the lever):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 120">
  <rect x="26" y="10" width="8" height="100" fill="#888" stroke="#bbb" stroke-width="2"/>
  <circle cx="30" cy="14" r="10" fill="#bbb"/>
</svg>
```

`ebrake_effect.svg` (engaged glow):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 120">
  <circle cx="30" cy="14" r="16" fill="#ff5050" opacity="0.4"/>
</svg>
```

- [ ] **Step 6: Create pedal assets**

`pedal_base.svg`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 200" preserveAspectRatio="none">
  <rect x="2" y="2" width="36" height="196" fill="none" stroke="#888" stroke-width="2"/>
</svg>
```

`pedal_fill.svg`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 200" preserveAspectRatio="none">
  <rect x="4" y="4" width="32" height="192" fill="#4caa6a"/>
</svg>
```

- [ ] **Step 7: Create foot assets**

`foot_left.svg`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 60">
  <ellipse cx="40" cy="30" rx="34" ry="22" fill="#5d4a35" stroke="#8a7050" stroke-width="3"/>
</svg>
```

`foot_right.svg`: same content as `foot_left.svg`.

- [ ] **Step 8: Verify file count**

```bash
ls src/modules/driver-inputs/public/assets/ | wc -l
```

Expected: `15`.

- [ ] **Step 9: Commit**

```bash
git add src/modules/driver-inputs/public/assets/
git commit -m "feat(driver-inputs): built-in SVG placeholder asset set

15 neutral placeholders so the overlay is visible zero-config. Right-hand
pose variants use distinct stroke colors (green/red/blue) so the pose
state machine is visually verifiable.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Overlay HTML, CSS, and JS

Static files served from the module's `public/` dir. No build step. `overlay.js` opens the WS, runs the rAF loop, swaps right-hand pose via the state machine, applies CSS transforms.

**Files:**
- Create: `src/modules/driver-inputs/public/index.html`
- Create: `src/modules/driver-inputs/public/overlay.css`
- Create: `src/modules/driver-inputs/public/overlay.js`

- [ ] **Step 1: Create index.html**

Create `src/modules/driver-inputs/public/index.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Driver Inputs</title>
  <link rel="stylesheet" href="overlay.css">
</head>
<body>
  <div id="root">
    <div id="wheel-wrap">
      <img id="wheel" data-slot="wheel" src="assets/wheel.png">
      <img id="hand-left" data-slot="hand_left" src="assets/hand_left.png">
      <img id="hand-right" data-slot="hand_right_steering" src="assets/hand_right_steering.png">
    </div>

    <div id="pedals">
      <div class="pedal">
        <img class="pedal-base" data-slot="pedal_base" src="assets/pedal_base.png">
        <img class="pedal-fill" data-slot="pedal_fill" data-pedal="throttle" src="assets/pedal_fill.png">
        <div class="pedal-label">T</div>
      </div>
      <div class="pedal">
        <img class="pedal-base" data-slot="pedal_base" src="assets/pedal_base.png">
        <img class="pedal-fill" data-slot="pedal_fill" data-pedal="brake" src="assets/pedal_fill.png">
        <div class="pedal-label">B</div>
      </div>
      <div class="pedal">
        <img class="pedal-base" data-slot="pedal_base" src="assets/pedal_base.png">
        <img class="pedal-fill" data-slot="pedal_fill" data-pedal="clutch" src="assets/pedal_fill.png">
        <div class="pedal-label">C</div>
      </div>
    </div>

    <div id="feet">
      <img id="foot-left" data-slot="foot_left" src="assets/foot_left.png">
      <img id="foot-right" data-slot="foot_right" src="assets/foot_right.png">
    </div>

    <div id="shifter">
      <img id="shifter-base" data-slot="shifter_base" src="assets/shifter_base.png">
      <img id="shifter-knob" data-slot="shifter_knob" src="assets/shifter_knob.png">
    </div>

    <div id="ebrake">
      <img id="ebrake-base" data-slot="ebrake_base" src="assets/ebrake_base.png">
      <img id="ebrake-lever" data-slot="ebrake" src="assets/ebrake.png">
      <img id="ebrake-effect" data-slot="ebrake_effect" src="assets/ebrake_effect.png">
    </div>

    <div id="gear">N</div>
  </div>
  <script src="overlay.js" type="module"></script>
</body>
</html>
```

- [ ] **Step 2: Create overlay.css**

Create `src/modules/driver-inputs/public/overlay.css`:

```css
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: transparent; overflow: hidden; }
body { font-family: system-ui, sans-serif; color: #ddd; }

#root {
  position: relative;
  width: 100vw;
  height: 100vh;
}

#wheel-wrap {
  position: absolute;
  left: 50%;
  top: 35%;
  transform: translate(-50%, -50%);
  width: 36vmin;
  height: 36vmin;
  transition: transform 30ms linear;
}
#wheel-wrap img { position: absolute; left: 0; top: 0; width: 100%; height: 100%; }
#hand-left  { transform: translate(-20%, -10%); }
#hand-right { transform: translate( 20%, -10%); }

#pedals {
  position: absolute;
  left: 6%;
  bottom: 6%;
  display: flex;
  gap: 1.5vmin;
  height: 36vmin;
}
.pedal {
  position: relative;
  width: 6vmin;
  height: 100%;
}
.pedal-base, .pedal-fill {
  position: absolute;
  left: 0; bottom: 0;
  width: 100%;
  height: 100%;
}
.pedal-fill {
  transform-origin: bottom;
  transform: scaleY(0);
  transition: transform 50ms linear;
}
.pedal-label {
  position: absolute;
  bottom: -2.2vmin;
  width: 100%;
  text-align: center;
  font-size: 1.6vmin;
  opacity: 0.7;
}

#feet {
  position: absolute;
  left: 4%;
  bottom: 2%;
  width: 24vmin;
  height: 8vmin;
}
#feet img {
  position: absolute;
  width: 50%;
  height: 100%;
  opacity: 0;
  transition: opacity 50ms linear;
}
#foot-left  { left: 0; }
#foot-right { left: 50%; }

#shifter {
  position: absolute;
  right: 6%;
  bottom: 12%;
  width: 16vmin;
  height: 16vmin;
}
#shifter img { position: absolute; left: 0; top: 0; width: 100%; height: 100%; }
#shifter-knob {
  width: 18%;
  height: 18%;
  left: 41% !important;
  top: 41% !important;
  transition: transform 80ms linear;
}

#ebrake {
  position: absolute;
  right: 28%;
  bottom: 8%;
  width: 5vmin;
  height: 18vmin;
}
#ebrake img { position: absolute; left: 0; top: 0; width: 100%; height: 100%; }
#ebrake-lever {
  transform-origin: 50% 90%;
  transition: transform 80ms linear;
}
#ebrake-effect { opacity: 0; transition: opacity 80ms linear; }

#gear {
  position: absolute;
  top: 3%;
  right: 3%;
  font-size: 12vmin;
  font-weight: 700;
  text-shadow: 0 2px 6px rgba(0,0,0,0.6);
}
```

- [ ] **Step 3: Create overlay.js**

Create `src/modules/driver-inputs/public/overlay.js`:

```js
// Static client. Fetches its own config, opens a WS, paints via rAF.

const SLOTS_WITH_PNG_FIRST = true; // built-in ships .svg; user can drop .png that wins

function installFallback(img) {
  // PNG → SVG fallback once per img.
  let triedSvg = false;
  img.addEventListener("error", () => {
    if (triedSvg) return;
    triedSvg = true;
    const slot = img.dataset.slot;
    if (!slot) return;
    img.src = `assets/${slot}.svg`;
  });
}

function setupFallbacks() {
  document.querySelectorAll("img[data-slot]").forEach((img) => {
    if (SLOTS_WITH_PNG_FIRST) {
      const slot = img.dataset.slot;
      img.src = `assets/${slot}.png`;
    }
    installFallback(img);
  });
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function gearLabel(g) {
  if (g === 0) return "R";
  if (g < 0 || g === undefined || g === null) return "N";
  return String(g);
}

function gearGate(gear) {
  const COL = 40, ROW = 30;
  const map = {
    0: { x: -COL, y:  ROW },
    1: { x: -COL, y: -ROW },
    2: { x: -COL, y:  ROW },
    3: { x: 0,     y: -ROW },
    4: { x: 0,     y:  ROW },
    5: { x:  COL, y: -ROW },
    6: { x:  COL, y:  ROW },
  };
  if (gear in map) return map[gear];
  return { x: 0, y: -ROW - (gear - 6) * 10 };
}

function handPose(i) {
  if (i.nowMs - i.lastGearChangeMs < i.shifterPoseDurationMs) return "shifter";
  if (i.handbrake > i.handbrakeEngageThreshold) return "ebrake";
  if (i.currGear === 0 && i.throttle === 0 && i.brake === 0 && i.clutch === 0) return "floating";
  return "steering";
}

async function loadConfig() {
  try {
    const r = await fetch("/modules/driver-inputs/config.json");
    if (r.ok) return await r.json();
  } catch {}
  return {
    wheelRotationRangeDeg: 450,
    shifterPoseDurationMs: 350,
    handbrakeEngageThreshold: 0.1,
  };
}

function connectWS(onPacket) {
  let backoff = 250;
  const url = `ws://${location.host}/telemetry`;
  function open() {
    const ws = new WebSocket(url);
    ws.addEventListener("open", () => { backoff = 250; });
    ws.addEventListener("message", (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === "telemetry" && msg.data) onPacket(msg.data);
      } catch {}
    });
    ws.addEventListener("close", () => {
      setTimeout(open, backoff);
      backoff = Math.min(5000, backoff * 2);
    });
    ws.addEventListener("error", () => { try { ws.close(); } catch {} });
  }
  open();
}

async function main() {
  setupFallbacks();
  const cfg = await loadConfig();

  const $wheel = document.getElementById("wheel-wrap");
  const $handRight = document.getElementById("hand-right");
  const $shifterKnob = document.getElementById("shifter-knob");
  const $ebrakeLever = document.getElementById("ebrake-lever");
  const $ebrakeEffect = document.getElementById("ebrake-effect");
  const $gear = document.getElementById("gear");
  const $fills = {
    throttle: document.querySelector('.pedal-fill[data-pedal="throttle"]'),
    brake: document.querySelector('.pedal-fill[data-pedal="brake"]'),
    clutch: document.querySelector('.pedal-fill[data-pedal="clutch"]'),
  };
  const $footLeft = document.getElementById("foot-left");
  const $footRight = document.getElementById("foot-right");

  let latest = null;
  let prevGear = null;
  let lastGearChangeMs = 0;
  let currentPose = "steering";

  connectWS((pkt) => { latest = pkt; });

  function paint() {
    requestAnimationFrame(paint);
    const p = latest;
    if (!p) return;

    if (prevGear !== null && p.gear !== prevGear) {
      lastGearChangeMs = performance.now();
    }
    prevGear = p.gear;

    $wheel.style.transform =
      `translate(-50%, -50%) rotate(${clamp(p.steer, -1, 1) * cfg.wheelRotationRangeDeg}deg)`;

    $fills.throttle.style.transform = `scaleY(${clamp(p.throttle, 0, 1)})`;
    $fills.brake.style.transform    = `scaleY(${clamp(p.brake, 0, 1)})`;
    $fills.clutch.style.transform   = `scaleY(${clamp(p.clutch, 0, 1)})`;

    const pose = handPose({
      currGear: p.gear,
      handbrake: p.handbrake,
      throttle: p.throttle,
      brake: p.brake,
      clutch: p.clutch,
      nowMs: performance.now(),
      lastGearChangeMs,
      shifterPoseDurationMs: cfg.shifterPoseDurationMs,
      handbrakeEngageThreshold: cfg.handbrakeEngageThreshold,
    });
    if (pose !== currentPose) {
      currentPose = pose;
      const slot = `hand_right_${pose}`;
      $handRight.dataset.slot = slot;
      // reset triedSvg-style state by re-installing on this src swap
      $handRight.src = `assets/${slot}.png`;
    }

    const gate = gearGate(p.gear);
    $shifterKnob.style.transform = `translate(${gate.x}%, ${gate.y}%)`;

    $ebrakeLever.style.transform = `rotate(${clamp(p.handbrake, 0, 1) * -25}deg)`;
    $ebrakeEffect.style.opacity = p.handbrake > cfg.handbrakeEngageThreshold ? "1" : "0";

    $footLeft.style.opacity  = p.brake > 0 ? "1" : "0";
    $footRight.style.opacity = p.throttle > 0 ? "1" : "0";

    $gear.textContent = gearLabel(p.gear);
  }
  requestAnimationFrame(paint);
}

main();
```

Note: when right-hand pose swaps, we reset `data-slot` and `src` directly. The `installFallback` listener fires on the new src's load failure, falling back to `.svg`. Each pose's image is browser-cached after first load, so subsequent swaps don't re-fetch.

- [ ] **Step 4: Smoke check — full suite + typecheck**

```bash
npm run typecheck && npm test
```

Expected: green (HTML/CSS/JS aren't typechecked or unit-tested directly; integration test in Task 11 exercises them).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(driver-inputs): overlay HTML/CSS/JS

Static files: index.html shells out the layered <img> elements;
overlay.css positions and sizes them; overlay.js opens WS /telemetry,
runs a rAF loop, applies CSS transforms, swaps right-hand pose, falls
back PNG→SVG per slot on load error.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Register module + integration test

Wires `driverInputs` into `src/modules/index.ts`, updates `config.example.jsonc`, and adds an end-to-end integration test driven by MockInput.

**Files:**
- Modify: `src/modules/index.ts`
- Modify: `config.example.jsonc`
- Create: `test/integration/driver-inputs.test.ts`

- [ ] **Step 1: Inspect config.example.jsonc and existing integration test layout**

```bash
ls test/integration/ 2>/dev/null || true
```

Read whichever integration test file exists (if any) to mirror its bootstrap pattern. If none exist, the test below is self-contained.

- [ ] **Step 2: Write failing integration test**

Create `test/integration/driver-inputs.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { WebSocket } from "ws";

const HTTP_PORT = 57801;     // chosen to avoid collision with dev runs
const UDP_PORT  = 57802;

let proc: ChildProcess;
let workDir: string;

function writeConfig(file: string) {
  const cfg = {
    input: { type: "mock", file, loop: true, game: "fh5" },
    rawOutputs: [],
    http: { port: HTTP_PORT },
    logging: { level: "error", dir: path.join(workDir, "logs"), pretty: false },
    modules: {
      "backseat-speedometer": { enabled: false },
      "redline-alert": { enabled: false },
      "driver-inputs": {
        enabled: true,
        config: {
          userAssetDir: null,
          wheelRotationRangeDeg: 450,
          shifterPoseDurationMs: 350,
          handbrakeEngageThreshold: 0.1,
        },
      },
    },
  };
  writeFileSync(path.join(workDir, "config.jsonc"), JSON.stringify(cfg));
}

async function waitForReady() {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${HTTP_PORT}/health`);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("FTS did not become ready in time");
}

beforeAll(async () => {
  workDir = mkdtempSync(path.join(tmpdir(), "fts-itest-"));
  // Copy the existing fixture into workDir so mock input can read it
  const fixtureSrc = path.resolve("test/fixtures/skateboard-smoke.fzt");
  const fixtureDst = path.join(workDir, "smoke.fzt");
  writeFileSync(fixtureDst, require("node:fs").readFileSync(fixtureSrc));
  writeConfig(fixtureDst);

  proc = spawn("npx", ["tsx", "src/index.ts"], {
    env: { ...process.env, FTS_CONFIG_PATH: path.join(workDir, "config.jsonc"), FTS_EXAMPLE_PATH: path.join(workDir, "config.jsonc") },
    stdio: "ignore",
    shell: process.platform === "win32",
  });
  await waitForReady();
}, 20_000);

afterAll(async () => {
  if (proc && !proc.killed) {
    proc.kill();
    await new Promise((r) => setTimeout(r, 500));
  }
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

describe("driver-inputs overlay (integration)", () => {
  it("serves overlay index.html from built-in dir", async () => {
    const r = await fetch(`http://127.0.0.1:${HTTP_PORT}/overlays/driver-inputs/`);
    expect(r.status).toBe(200);
    const body = await r.text();
    expect(body).toContain("wheel-wrap");
  });

  it("serves a placeholder SVG asset", async () => {
    const r = await fetch(`http://127.0.0.1:${HTTP_PORT}/overlays/driver-inputs/assets/wheel.svg`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type") ?? "").toContain("svg");
  });

  it("serves config.json with the configured values", async () => {
    const r = await fetch(`http://127.0.0.1:${HTTP_PORT}/modules/driver-inputs/config.json`);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.wheelRotationRangeDeg).toBe(450);
    expect(body.shifterPoseDurationMs).toBe(350);
    expect(body.handbrakeEngageThreshold).toBe(0.1);
  });

  it("returns 404 on traversal attempt", async () => {
    const r = await fetch(
      `http://127.0.0.1:${HTTP_PORT}/overlays/driver-inputs/%2e%2e/%2e%2e/etc/passwd`,
    );
    expect(r.status).toBe(404);
  });

  it("WS /telemetry emits packets with the new input fields", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${HTTP_PORT}/telemetry`);
    const pkt = await new Promise<any>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("no telemetry within 5s")), 5000);
      ws.on("message", (data) => {
        try {
          const msg = JSON.parse(String(data));
          if (msg.type === "telemetry" && msg.data) {
            clearTimeout(t);
            resolve(msg.data);
          }
        } catch {}
      });
      ws.on("error", reject);
    });
    ws.close();
    expect(typeof pkt.steer).toBe("number");
    expect(typeof pkt.throttle).toBe("number");
    expect(typeof pkt.brake).toBe("number");
    expect(typeof pkt.clutch).toBe("number");
    expect(typeof pkt.handbrake).toBe("number");
  });

  it("returns 503 from overlay after the module is disabled", async () => {
    const dis = await fetch(`http://127.0.0.1:${HTTP_PORT}/modules/driver-inputs/disable`, {
      method: "POST",
    });
    expect(dis.ok).toBe(true);
    const r = await fetch(`http://127.0.0.1:${HTTP_PORT}/overlays/driver-inputs/`);
    expect(r.status).toBe(503);
    // re-enable for any subsequent tests
    await fetch(`http://127.0.0.1:${HTTP_PORT}/modules/driver-inputs/enable`, {
      method: "POST",
    });
  });
});
```

If the existing fixture path differs (verify in the repo), adjust `test/fixtures/skateboard-smoke.fzt` to the actual location. If `tsx` is not the entrypoint command in this repo (it is, per `package.json`), match `npm start`'s command.

- [ ] **Step 3: Run, expect FAIL**

```bash
npx vitest run test/integration/driver-inputs.test.ts
```

Expected: FAIL — `driver-inputs` not registered as a module yet.

- [ ] **Step 4: Register the module**

Edit `src/modules/index.ts`:

```ts
import type { Plugin } from "../core/plugin-host/Plugin.js";
import { backseatSpeedometer } from "./backseat-speedometer/plugin.js";
import { redlineAlert } from "./redline-alert/plugin.js";
import { driverInputs } from "./driver-inputs/plugin.js";

export const modules: Plugin[] = [
  backseatSpeedometer,
  redlineAlert,
  driverInputs,
];
```

- [ ] **Step 5: Update config.example.jsonc**

Edit `config.example.jsonc`. Inside the `input` block, add the game field:

```jsonc
  "input": {
    "type": "udp",
    "port": 9999,
    "game": "fh5"        // "fh5" today; "fh6" reserved
  },
```

Inside the `modules` block, add the driver-inputs slice:

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

- [ ] **Step 6: Run, expect PASS**

```bash
npx vitest run test/integration/driver-inputs.test.ts
```

Expected: PASS (6/6).

If a vitest config excludes `test/integration/**`, add it to the include glob, or move the file into the existing co-located test layout. Check `vitest.config.ts` or `vite.config.ts` if present.

- [ ] **Step 7: Full suite + typecheck**

```bash
npm run typecheck && npm test
```

Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(driver-inputs): register module, add integration test, update example config

End-to-end MockInput-driven integration test covers overlay serving,
asset fallback, config.json, traversal protection, telemetry WS payload
includes new input fields, and module disable returns 503.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Docs + TODO.md

Project-level documentation closes the loop.

**Files:**
- Modify: `TESTING.md` (create if it doesn't exist)
- Modify: `TODO.md`

- [ ] **Step 1: Check whether TESTING.md exists**

```bash
ls TESTING.md 2>/dev/null && echo EXISTS || echo MISSING
```

- [ ] **Step 2: Add (or create) TESTING.md driver-inputs section**

Append to `TESTING.md` (or create it with this content if missing):

```md
## Driver Inputs Overlay

1. Start FTS: `start-fts.bat` (or `npm start`).
2. Add OBS Browser Source at `http://localhost:5780/overlays/driver-inputs/` (1920×1080, transparent).
3. With Forza Horizon 5 running (Pithouse relaying to FTS port 9999), drive for 60 seconds and confirm:
   - Wheel rotates left/right with steering input.
   - Throttle / brake / clutch bars fill 0–100% with pedal pressure.
   - Gear text updates on each gear change; gear 0 displays as `R`.
   - Right-hand image swaps to `hand_right_shifter` briefly on each gear change, returning to `hand_right_steering`.
   - With handbrake engaged: right-hand swaps to `hand_right_ebrake`; e-brake lever rises; e-brake effect flashes.
4. Custom-art smoke: drop a single `wheel.png` into your configured `userAssetDir/assets/` and reload the OBS source. The wheel should swap while every other slot stays on the built-in SVG.
5. **Pithouse assumption check** (run once, after first setup): in Forza, reconfigure Data Out to send directly to FTS port 9999 (bypassing Pithouse). Drive for 30s. Note packet count via `http://localhost:5780/health`. Re-enable Pithouse-in-chain. Repeat. Packet counts should be comparable; parsed values should look the same.
```

- [ ] **Step 3: Update TODO.md**

Edit `TODO.md`. Add a new entry at the top of `## Last shipped` (cap to ~3 entries):

```md
- **2026-05-10** — Driver Inputs Overlay shipped: wheel + 3 pedal bars + gear + shifter + e-brake overlay served at `/overlays/driver-inputs/`, FH5 parser extended with steer/throttle/brake/clutch/handbrake, new `PluginContext.registerOverlay` helper (branch `feat/driver-inputs-overlay`)
```

Trim the oldest entry to keep `## Last shipped` at 3 entries.

Update `## Up next`:

```md
**Pick the next item from the backlog.** With the Driver Inputs Overlay in place, the next call is between the remaining Bicycle items (G-Force Meter, Near Death Counter, Smooth Brain) and the Car-phase items (persistence, StreamDeck, Moza activation, CLI). See [`docs/superpowers/specs/2026-04-18-stream-telemetry-suite-design.md`](docs/superpowers/specs/2026-04-18-stream-telemetry-suite-design.md) §10.
```

Update the `_Last updated:_` date to `2026-05-10`.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs: TESTING.md driver-inputs section + TODO.md last-shipped

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: Open the pull request

Per CLAUDE.md, never merge without explicit approval. Open the PR and stop.

- [ ] **Step 1: Push the branch**

```bash
git push -u origin feat/driver-inputs-overlay
```

- [ ] **Step 2: Open the PR**

```bash
gh pr create --title "feat: Driver Inputs Overlay" --body "$(cat <<'EOF'
## Summary
- New `driver-inputs` module serving a browser-source overlay at `GET /overlays/driver-inputs/`: wheel (with hands at 10-and-2), three vertical pedal bars (throttle/brake/clutch), gear text, shifter, e-brake.
- Extends FH5 parser with `steer`, `throttle`, `brake`, `clutch`, `handbrake` and refactors parsing behind a `ForzaDashParser` interface (FH6-ready).
- Adds `PluginContext.registerOverlay({ builtInDir, userDir })` so future Bicycle overlays inherit user-dir-overrides-built-in asset serving + path-traversal protection.

## Test plan
- [ ] `npm run typecheck` clean
- [ ] `npm test` green (unit + integration)
- [ ] Manual smoke per `TESTING.md` § Driver Inputs Overlay
- [ ] Pithouse-in-chain assumption check (one-time setup verification)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Report the PR URL and stop**

Print the PR URL returned by `gh pr create`. Do **not** run `gh pr merge`.

---

## Self-review (run after completing this plan, before execution starts)

**Spec coverage:**
- §3 Upstream data flow → covered implicitly by integration test + `TESTING.md` Pithouse step ✓
- §4 Tech-stack decisions → embedded in code throughout ✓
- §5.1 Parser changes → Tasks 1, 2 ✓
- §5.2 `registerOverlay` → Tasks 4, 5 ✓
- §5.3 Module layout → Task 8 ✓ (assets in Task 9; static files in Task 10)
- §5.4 `handPose` → Task 6 ✓
- §5.5 `gearGate` → Task 7 ✓
- §5.6 Overlay client → Task 10 ✓
- §5.7 config.json route → Task 8 (route registration + test) ✓
- §5.8 Directory layout summary → reflected in file map ✓
- §6 Configuration → Tasks 3, 11 ✓
- §7 Error handling → Task 4 covers traversal + 503; Task 10 covers WS reconnect; Task 8 covers `onStop` cleanup; other rows are existing-mechanism behavior ✓
- §8 Testing → Tasks 1, 2, 4, 6, 7, 8, 11; manual smoke in Task 12 ✓
- §9 Acceptance criteria → All items covered by the listed tasks ✓
- §10 Decision log → Reference only, no implementation items ✓

**Placeholders:** None — every code step contains complete code.

**Type consistency:**
- `ForzaDashParser` interface defined Task 1, used Task 3 ✓
- `HandPoseInputs` defined Task 6, consumed Task 10 ✓
- `GatePosition` defined Task 7, consumed Task 10 ✓
- `PluginContext.registerOverlay` signature defined Task 5 (`{ builtInDir, userDir? }`), called identically in Task 8 ✓
- `Server.registerOverlay`/`unregisterOverlay` signatures defined Task 4, called identically in Task 5 ✓

**Scope:** Single cohesive feature, single PR. No decomposition needed.
