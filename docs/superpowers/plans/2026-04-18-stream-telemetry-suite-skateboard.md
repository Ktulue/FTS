# Forza Stream Telemetry Suite — Skateboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Skateboard phase of FSTS: a single TypeScript/Node process that parses Forza UDP telemetry, exposes HTTP + WebSocket consumer surfaces, hosts an in-process plugin system with a browser-based Admin Panel, forwards raw UDP to configurable downstream consumers, supports offline development via recorded-telemetry replay, and delivers two validator modules proving both architectural paths (pull via HTTP, push via WS events).

**Architecture:** One Node process. `InputSource` → `RawOutputChain` (fire-and-forget forwarders) + `PacketParser` → `TelemetryBus` → `PluginHost` + HTTP/WS `Server`. Modules implement a unified `Plugin` contract and plug in via an explicit registry file. Admin Panel is a static page served from the same HTTP server. Crash-isolation wraps every plugin hot-path call.

**Tech Stack:** TypeScript 5, Node 20+, Express, `ws`, `pino`/`pino-pretty`, `ajv` + `jsonc-parser`, `tsx` (no build step), Vitest. Windows `.bat` launchers.

**Spec reference:** `docs/superpowers/specs/2026-04-18-stream-telemetry-suite-design.md`

---

## Phase 1 — Scaffolding & Foundations

### Task 1: Bootstrap the TypeScript project

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `vitest.config.ts`

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "fsts",
  "version": "0.1.0",
  "description": "Forza Stream Telemetry Suite",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "tsx src/index.ts",
    "dev": "tsx watch src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "engines": {
    "node": ">=20"
  },
  "dependencies": {
    "ajv": "^8.17.1",
    "express": "^4.21.1",
    "jsonc-parser": "^3.3.1",
    "pino": "^9.5.0",
    "pino-pretty": "^11.3.0",
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@types/express": "^5.0.0",
    "@types/node": "^22.9.0",
    "@types/ws": "^8.5.13",
    "tsx": "^4.19.2",
    "typescript": "^5.6.3",
    "vitest": "^2.1.5"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "allowImportingTsExtensions": false
  },
  "include": ["src/**/*", "test/**/*"]
}
```

- [ ] **Step 3: Write `.gitignore`**

```
node_modules/
logs/
dist/
config.jsonc
*.log
.DS_Store
```

Note: `config.jsonc` is gitignored (user-specific); `config.example.jsonc` is tracked.

- [ ] **Step 4: Write `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    testTimeout: 5000,
  },
});
```

- [ ] **Step 5: Install dependencies**

Run: `npm install`
Expected: installs without errors, creates `node_modules/` and `package-lock.json`.

- [ ] **Step 6: Verify scaffolding**

Run: `npx tsc --noEmit` — Expected: no output (no TS errors on empty source)
Run: `npx vitest run` — Expected: "No test files found" (exits 0)

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .gitignore
git commit -m "feat: bootstrap TypeScript project with vitest"
```

---

### Task 2: Define `TelemetryPacket` type

**Files:**
- Create: `src/core/parser/TelemetryPacket.ts`

- [ ] **Step 1: Write the type definition**

```ts
// src/core/parser/TelemetryPacket.ts
export interface TelemetryPacket {
  /** Unix epoch ms when FSTS received/parsed the packet */
  timestamp: number;
  /** False when in menus / paused */
  isRaceOn: boolean;
  /** Speed in m/s */
  speed: number;
  /** Current engine RPM */
  rpm: number;
  /** Peak engine RPM for this car */
  maxRpm: number;
  /** Gear: 0 = reverse, 1+ = forward gears */
  gear: number;
  /** Lateral acceleration in G (positive = right) */
  accelLateral: number;
  /** Longitudinal acceleration in G (positive = forward) */
  accelLongitudinal: number;
  /** Tire slip ratios, -1..1ish per wheel */
  tireSlipRatio: {
    fl: number;
    fr: number;
    rl: number;
    rr: number;
  };
  /** Unique car identifier (for Car Report Card, Bicycle/Car phases) */
  carOrdinal: number;
  /** Car class: 0=D, 1=C, 2=B, 3=A, 4=S, 5=R, 6=P, 7=X */
  carClass: number;
  /** Drivetrain: 0=FWD, 1=RWD, 2=AWD */
  drivetrainType: number;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/core/parser/TelemetryPacket.ts
git commit -m "feat(parser): add TelemetryPacket type"
```

---

### Task 3: Implement `PacketParser` (TDD)

The FH5 "Dash" UDP packet is 324 bytes, little-endian. We parse a subset of fields — enough for Skateboard and near-future modules. Unused offsets are left for later expansion.

**Files:**
- Create: `src/core/parser/PacketParser.ts`
- Create: `src/core/parser/PacketParser.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/core/parser/PacketParser.test.ts
import { describe, it, expect } from "vitest";
import { parseDashPacket, DASH_PACKET_SIZE } from "./PacketParser";

function buildDashBuffer(overrides: Partial<Record<string, number>> = {}): Buffer {
  const buf = Buffer.alloc(DASH_PACKET_SIZE);
  // Defaults
  buf.writeInt32LE(1, 0);                 // isRaceOn = 1 (true)
  buf.writeUInt32LE(12345, 4);            // TimestampMS
  buf.writeFloatLE(7500, 8);              // EngineMaxRpm
  buf.writeFloatLE(6800, 16);             // CurrentEngineRpm
  buf.writeFloatLE(0.12, 20);             // AccelerationX (lateral)
  buf.writeFloatLE(0.00, 28);             // AccelerationZ (longitudinal)
  buf.writeFloatLE(0.01, 84);             // TireSlipRatioFL
  buf.writeFloatLE(0.02, 88);             // TireSlipRatioFR
  buf.writeFloatLE(0.03, 92);             // TireSlipRatioRL
  buf.writeFloatLE(0.04, 96);             // TireSlipRatioRR
  buf.writeInt32LE(2345, 212);            // CarOrdinal
  buf.writeInt32LE(3, 216);               // CarClass (A)
  buf.writeInt32LE(1, 224);               // DrivetrainType (RWD)
  buf.writeFloatLE(52.3, 244);            // Speed m/s
  buf.writeUInt8(4, 307);                 // Gear
  // Apply overrides by offset name
  return buf;
}

describe("parseDashPacket", () => {
  it("parses a complete Dash packet", () => {
    const buf = buildDashBuffer();
    const pkt = parseDashPacket(buf, 1700000000000);
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
    const pkt = parseDashPacket(buf, 1700000000000);
    expect(pkt.isRaceOn).toBe(false);
  });

  it("throws on wrong-sized buffer", () => {
    const buf = Buffer.alloc(100);
    expect(() => parseDashPacket(buf, 1700000000000)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run src/core/parser/PacketParser.test.ts`
Expected: FAIL — `Cannot find module './PacketParser'`.

- [ ] **Step 3: Implement the parser**

```ts
// src/core/parser/PacketParser.ts
import type { TelemetryPacket } from "./TelemetryPacket";

export const DASH_PACKET_SIZE = 324;

/**
 * Parse a Forza Horizon 5 "Dash" UDP packet. All fields are little-endian.
 * Offsets documented against Microsoft's published Forza Data Out format.
 */
export function parseDashPacket(buf: Buffer, receiveTimestamp: number): TelemetryPacket {
  if (buf.length < DASH_PACKET_SIZE) {
    throw new Error(
      `Invalid packet size: got ${buf.length}, expected at least ${DASH_PACKET_SIZE}`
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
}
```

- [ ] **Step 4: Run tests — verify pass**

Run: `npx vitest run src/core/parser/PacketParser.test.ts`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/parser/PacketParser.ts src/core/parser/PacketParser.test.ts
git commit -m "feat(parser): parse FH5 Dash UDP packets (TDD)"
```

---

### Task 4: Implement `TelemetryBus` (TDD)

**Files:**
- Create: `src/core/bus/TelemetryBus.ts`
- Create: `src/core/bus/TelemetryBus.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/core/bus/TelemetryBus.test.ts
import { describe, it, expect, vi } from "vitest";
import { TelemetryBus } from "./TelemetryBus";
import type { TelemetryPacket } from "../parser/TelemetryPacket";

function packet(overrides: Partial<TelemetryPacket> = {}): TelemetryPacket {
  return {
    timestamp: 1,
    isRaceOn: true,
    speed: 10,
    rpm: 3000,
    maxRpm: 7000,
    gear: 2,
    accelLateral: 0,
    accelLongitudinal: 0,
    tireSlipRatio: { fl: 0, fr: 0, rl: 0, rr: 0 },
    carOrdinal: 1,
    carClass: 0,
    drivetrainType: 0,
    ...overrides,
  };
}

describe("TelemetryBus", () => {
  it("delivers packets to all subscribers synchronously", () => {
    const bus = new TelemetryBus();
    const a = vi.fn();
    const b = vi.fn();
    bus.subscribe(a);
    bus.subscribe(b);
    const p = packet({ speed: 42 });
    bus.publish(p);
    expect(a).toHaveBeenCalledWith(p);
    expect(b).toHaveBeenCalledWith(p);
  });

  it("unsubscribe stops delivery", () => {
    const bus = new TelemetryBus();
    const handler = vi.fn();
    const unsub = bus.subscribe(handler);
    bus.publish(packet());
    unsub();
    bus.publish(packet());
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("lastPacket returns null before any publish", () => {
    const bus = new TelemetryBus();
    expect(bus.lastPacket()).toBeNull();
  });

  it("lastPacket returns most recent packet", () => {
    const bus = new TelemetryBus();
    bus.publish(packet({ speed: 10 }));
    bus.publish(packet({ speed: 20 }));
    expect(bus.lastPacket()?.speed).toBe(20);
  });
});
```

- [ ] **Step 2: Run test — verify failure**

Run: `npx vitest run src/core/bus/TelemetryBus.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `TelemetryBus`**

```ts
// src/core/bus/TelemetryBus.ts
import type { TelemetryPacket } from "../parser/TelemetryPacket";

export type TelemetryHandler = (pkt: TelemetryPacket) => void;

export class TelemetryBus {
  private handlers = new Set<TelemetryHandler>();
  private _last: TelemetryPacket | null = null;

  subscribe(handler: TelemetryHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  publish(pkt: TelemetryPacket): void {
    this._last = pkt;
    for (const h of this.handlers) h(pkt);
  }

  lastPacket(): TelemetryPacket | null {
    return this._last;
  }
}
```

Note: `publish` does **not** wrap handler calls in try/catch — that's the `PluginHost`'s job (Task 15). Keeping the bus unopinionated about error handling lets us make tighter guarantees at a higher layer.

- [ ] **Step 4: Run tests — verify pass**

Run: `npx vitest run src/core/bus/TelemetryBus.test.ts`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/bus/TelemetryBus.ts src/core/bus/TelemetryBus.test.ts
git commit -m "feat(bus): TelemetryBus pub/sub with lastPacket cache (TDD)"
```

---

## Phase 2 — Input & Output Layers

### Task 5: Define `InputSource` interface

**Files:**
- Create: `src/core/input/InputSource.ts`

- [ ] **Step 1: Write the interface**

```ts
// src/core/input/InputSource.ts
export type PacketHandler = (raw: Buffer) => void;

export interface InputSource {
  readonly name: string;
  start(onPacket: PacketHandler): Promise<void>;
  stop(): Promise<void>;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/core/input/InputSource.ts
git commit -m "feat(input): InputSource interface"
```

---

### Task 6: Implement `DirectUDPInput` (TDD via loopback)

**Files:**
- Create: `src/core/input/DirectUDPInput.ts`
- Create: `src/core/input/DirectUDPInput.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/core/input/DirectUDPInput.test.ts
import { describe, it, expect } from "vitest";
import { createSocket } from "node:dgram";
import { DirectUDPInput } from "./DirectUDPInput";

describe("DirectUDPInput", () => {
  it("receives datagrams from loopback", async () => {
    const input = new DirectUDPInput({ port: 0 }); // 0 = ephemeral port
    const received: Buffer[] = [];
    await input.start((raw) => received.push(raw));

    // Discover the bound port
    const port = input.port();
    expect(port).toBeGreaterThan(0);

    // Send test packet
    const sender = createSocket("udp4");
    const payload = Buffer.from("hello forza");
    await new Promise<void>((resolve, reject) =>
      sender.send(payload, port, "127.0.0.1", (err) => (err ? reject(err) : resolve()))
    );

    // Wait up to 1s for delivery
    for (let i = 0; i < 20 && received.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    sender.close();
    await input.stop();

    expect(received.length).toBe(1);
    expect(received[0]!.toString()).toBe("hello forza");
  });
});
```

- [ ] **Step 2: Run test — verify failure**

Run: `npx vitest run src/core/input/DirectUDPInput.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `DirectUDPInput`**

```ts
// src/core/input/DirectUDPInput.ts
import { createSocket, Socket } from "node:dgram";
import type { InputSource, PacketHandler } from "./InputSource";

export interface DirectUDPInputConfig {
  port: number;
  host?: string; // default 0.0.0.0
}

export class DirectUDPInput implements InputSource {
  readonly name = "udp";
  private socket: Socket | null = null;
  private cfg: DirectUDPInputConfig;

  constructor(cfg: DirectUDPInputConfig) {
    this.cfg = cfg;
  }

  async start(onPacket: PacketHandler): Promise<void> {
    this.socket = createSocket({ type: "udp4", reuseAddr: true });
    this.socket.on("message", (raw) => onPacket(raw));
    await new Promise<void>((resolve, reject) => {
      this.socket!.once("error", reject);
      this.socket!.bind(this.cfg.port, this.cfg.host ?? "0.0.0.0", () => resolve());
    });
  }

  async stop(): Promise<void> {
    if (!this.socket) return;
    await new Promise<void>((resolve) => this.socket!.close(() => resolve()));
    this.socket = null;
  }

  /** Returns the actual bound port (useful when started with port=0). */
  port(): number {
    return this.socket?.address().port ?? 0;
  }
}
```

- [ ] **Step 4: Run test — verify pass**

Run: `npx vitest run src/core/input/DirectUDPInput.test.ts`
Expected: 1 test passes.

- [ ] **Step 5: Commit**

```bash
git add src/core/input/DirectUDPInput.ts src/core/input/DirectUDPInput.test.ts
git commit -m "feat(input): DirectUDPInput loopback-tested (TDD)"
```

---

### Task 7: Implement `MockInput` with recording format (TDD)

Recording format: repeated records of `[relativeMs: u32 LE][packetLength: u16 LE][packetBytes: N]`.

**Files:**
- Create: `src/core/input/MockInput.ts`
- Create: `src/core/input/recordingFormat.ts`
- Create: `src/core/input/MockInput.test.ts`

- [ ] **Step 1: Write the recording format helper (writer + reader)**

```ts
// src/core/input/recordingFormat.ts
import { writeFileSync, readFileSync } from "node:fs";

export interface RecordingEntry {
  relativeMs: number;
  packet: Buffer;
}

export function writeRecording(filePath: string, entries: RecordingEntry[]): void {
  const chunks: Buffer[] = [];
  for (const e of entries) {
    const header = Buffer.alloc(6);
    header.writeUInt32LE(e.relativeMs, 0);
    header.writeUInt16LE(e.packet.length, 4);
    chunks.push(header, e.packet);
  }
  writeFileSync(filePath, Buffer.concat(chunks));
}

export function readRecording(filePath: string): RecordingEntry[] {
  const buf = readFileSync(filePath);
  const entries: RecordingEntry[] = [];
  let off = 0;
  while (off + 6 <= buf.length) {
    const relativeMs = buf.readUInt32LE(off);
    const pktLen = buf.readUInt16LE(off + 4);
    if (off + 6 + pktLen > buf.length) {
      throw new Error(`Truncated recording at offset ${off}`);
    }
    const packet = Buffer.from(buf.subarray(off + 6, off + 6 + pktLen));
    entries.push({ relativeMs, packet });
    off += 6 + pktLen;
  }
  return entries;
}
```

- [ ] **Step 2: Write the failing MockInput test**

```ts
// src/core/input/MockInput.test.ts
import { describe, it, expect } from "vitest";
import { MockInput } from "./MockInput";
import { writeRecording } from "./recordingFormat";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

function tempRecordingPath(): string {
  return join(tmpdir(), `fsts-test-${randomBytes(4).toString("hex")}.fzt`);
}

describe("MockInput", () => {
  it("replays recorded packets in order", async () => {
    const path = tempRecordingPath();
    writeRecording(path, [
      { relativeMs: 0,  packet: Buffer.from([1, 2, 3]) },
      { relativeMs: 10, packet: Buffer.from([4, 5, 6]) },
      { relativeMs: 20, packet: Buffer.from([7, 8, 9]) },
    ]);

    const input = new MockInput({ file: path, loop: false, speed: 100.0 }); // 100x = near-instant
    const got: Buffer[] = [];
    await input.start((raw) => got.push(raw));

    // Wait for playback to finish (20ms / 100 = 0.2ms, give generous buffer)
    await new Promise((r) => setTimeout(r, 100));
    await input.stop();

    expect(got.length).toBe(3);
    expect(got[0]!.equals(Buffer.from([1, 2, 3]))).toBe(true);
    expect(got[2]!.equals(Buffer.from([7, 8, 9]))).toBe(true);
  });

  it("loops when loop: true", async () => {
    const path = tempRecordingPath();
    writeRecording(path, [{ relativeMs: 0, packet: Buffer.from([0xaa]) }]);

    const input = new MockInput({ file: path, loop: true, speed: 1000.0 });
    const got: Buffer[] = [];
    await input.start((raw) => got.push(raw));
    await new Promise((r) => setTimeout(r, 50));
    await input.stop();

    expect(got.length).toBeGreaterThan(1);
  });
});
```

- [ ] **Step 3: Run tests — verify failure**

Run: `npx vitest run src/core/input/MockInput.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `MockInput`**

```ts
// src/core/input/MockInput.ts
import type { InputSource, PacketHandler } from "./InputSource";
import { readRecording, type RecordingEntry } from "./recordingFormat";

export interface MockInputConfig {
  file: string;
  loop?: boolean;   // default false
  speed?: number;   // default 1.0 (real-time); 2.0 = 2x faster
}

export class MockInput implements InputSource {
  readonly name = "mock";
  private cfg: MockInputConfig;
  private entries: RecordingEntry[] = [];
  private stopped = false;
  private pending: ReturnType<typeof setTimeout> | null = null;

  constructor(cfg: MockInputConfig) {
    this.cfg = cfg;
  }

  async start(onPacket: PacketHandler): Promise<void> {
    this.entries = readRecording(this.cfg.file);
    this.stopped = false;
    this.playOnce(onPacket, 0);
  }

  private playOnce(onPacket: PacketHandler, iterationStartMs: number): void {
    if (this.entries.length === 0) return;
    const speed = this.cfg.speed ?? 1.0;
    const startWall = Date.now();
    let idx = 0;

    const schedule = () => {
      if (this.stopped) return;
      if (idx >= this.entries.length) {
        if (this.cfg.loop) {
          this.playOnce(onPacket, iterationStartMs + this.entries[this.entries.length - 1]!.relativeMs);
        }
        return;
      }
      const e = this.entries[idx]!;
      const targetWall = startWall + e.relativeMs / speed;
      const delay = Math.max(0, targetWall - Date.now());
      this.pending = setTimeout(() => {
        if (this.stopped) return;
        onPacket(e.packet);
        idx++;
        schedule();
      }, delay);
    };

    schedule();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.pending) {
      clearTimeout(this.pending);
      this.pending = null;
    }
  }
}
```

- [ ] **Step 5: Run tests — verify pass**

Run: `npx vitest run src/core/input/MockInput.test.ts`
Expected: 2 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/core/input/MockInput.ts src/core/input/recordingFormat.ts src/core/input/MockInput.test.ts
git commit -m "feat(input): MockInput with .fzt recording format (TDD)"
```

---

### Task 8: Implement `RawOutput` interface + `UDPForwardOutput` (TDD)

**Files:**
- Create: `src/core/raw-outputs/RawOutput.ts`
- Create: `src/core/raw-outputs/UDPForwardOutput.ts`
- Create: `src/core/raw-outputs/UDPForwardOutput.test.ts`

- [ ] **Step 1: Write the `RawOutput` interface**

```ts
// src/core/raw-outputs/RawOutput.ts
export interface RawOutputStats {
  sent: number;
  errors: number;
  lastError: string | null;
}

export interface RawOutput {
  readonly name: string;
  enabled: boolean;
  /** Fire-and-forget. Must not throw. Errors increment the error counter. */
  send(raw: Buffer): void;
  stats(): RawOutputStats;
  shutdown(): Promise<void>;
}
```

- [ ] **Step 2: Write the failing `UDPForwardOutput` test**

```ts
// src/core/raw-outputs/UDPForwardOutput.test.ts
import { describe, it, expect } from "vitest";
import { createSocket } from "node:dgram";
import { UDPForwardOutput } from "./UDPForwardOutput";

describe("UDPForwardOutput", () => {
  it("forwards bytes to the configured host:port", async () => {
    const receiver = createSocket("udp4");
    const received: Buffer[] = [];
    receiver.on("message", (raw) => received.push(raw));
    await new Promise<void>((r) => receiver.bind(0, "127.0.0.1", () => r()));
    const port = receiver.address().port;

    const fwd = new UDPForwardOutput({
      name: "test",
      host: "127.0.0.1",
      port,
      enabled: true,
    });

    fwd.send(Buffer.from("hello"));
    await new Promise((r) => setTimeout(r, 50));
    expect(received.length).toBe(1);
    expect(received[0]!.toString()).toBe("hello");
    expect(fwd.stats().sent).toBe(1);
    expect(fwd.stats().errors).toBe(0);

    await fwd.shutdown();
    receiver.close();
  });

  it("skips sending when disabled", async () => {
    const fwd = new UDPForwardOutput({
      name: "t", host: "127.0.0.1", port: 1, enabled: false,
    });
    fwd.send(Buffer.from("x"));
    expect(fwd.stats().sent).toBe(0);
    await fwd.shutdown();
  });
});
```

- [ ] **Step 3: Run test — verify failure**

Run: `npx vitest run src/core/raw-outputs/UDPForwardOutput.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `UDPForwardOutput`**

```ts
// src/core/raw-outputs/UDPForwardOutput.ts
import { createSocket, Socket } from "node:dgram";
import type { RawOutput, RawOutputStats } from "./RawOutput";

export interface UDPForwardOutputConfig {
  name: string;
  host: string;
  port: number;
  enabled: boolean;
}

export class UDPForwardOutput implements RawOutput {
  readonly name: string;
  enabled: boolean;
  private socket: Socket;
  private _stats: RawOutputStats = { sent: 0, errors: 0, lastError: null };
  private cfg: UDPForwardOutputConfig;

  constructor(cfg: UDPForwardOutputConfig) {
    this.cfg = cfg;
    this.name = cfg.name;
    this.enabled = cfg.enabled;
    this.socket = createSocket("udp4");
    this.socket.on("error", (err) => {
      this._stats.errors++;
      this._stats.lastError = err.message;
    });
  }

  send(raw: Buffer): void {
    if (!this.enabled) return;
    this.socket.send(raw, this.cfg.port, this.cfg.host, (err) => {
      if (err) {
        this._stats.errors++;
        this._stats.lastError = err.message;
      } else {
        this._stats.sent++;
      }
    });
  }

  stats(): RawOutputStats {
    return { ...this._stats };
  }

  async shutdown(): Promise<void> {
    await new Promise<void>((resolve) => this.socket.close(() => resolve()));
  }
}
```

- [ ] **Step 5: Run tests — verify pass**

Run: `npx vitest run src/core/raw-outputs/UDPForwardOutput.test.ts`
Expected: 2 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/core/raw-outputs/RawOutput.ts src/core/raw-outputs/UDPForwardOutput.ts src/core/raw-outputs/UDPForwardOutput.test.ts
git commit -m "feat(raw-output): UDPForwardOutput fire-and-forget (TDD)"
```

---

### Task 9: Implement `RawOutputChain` (TDD)

Simple composite — holds N outputs, `send()` calls each in sequence.

**Files:**
- Create: `src/core/raw-outputs/RawOutputChain.ts`
- Create: `src/core/raw-outputs/RawOutputChain.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/core/raw-outputs/RawOutputChain.test.ts
import { describe, it, expect, vi } from "vitest";
import { RawOutputChain } from "./RawOutputChain";
import type { RawOutput } from "./RawOutput";

function fakeOutput(name: string, enabled = true): RawOutput & { sendSpy: ReturnType<typeof vi.fn> } {
  const spy = vi.fn();
  return {
    name,
    enabled,
    send: spy,
    stats: () => ({ sent: 0, errors: 0, lastError: null }),
    shutdown: async () => {},
    sendSpy: spy,
  } as never;
}

describe("RawOutputChain", () => {
  it("fans send() out to all outputs", () => {
    const a = fakeOutput("a");
    const b = fakeOutput("b");
    const chain = new RawOutputChain([a, b]);
    const pkt = Buffer.from("x");
    chain.send(pkt);
    expect(a.sendSpy).toHaveBeenCalledWith(pkt);
    expect(b.sendSpy).toHaveBeenCalledWith(pkt);
  });

  it("a thrown output error is caught and does not break the chain", () => {
    const a = fakeOutput("a");
    a.send = vi.fn(() => { throw new Error("boom"); });
    const b = fakeOutput("b");
    const chain = new RawOutputChain([a, b]);
    chain.send(Buffer.from("x"));
    expect(b.sendSpy).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test — verify failure**

Run: `npx vitest run src/core/raw-outputs/RawOutputChain.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `RawOutputChain`**

```ts
// src/core/raw-outputs/RawOutputChain.ts
import type { RawOutput } from "./RawOutput";

export class RawOutputChain {
  constructor(private outputs: RawOutput[]) {}

  send(raw: Buffer): void {
    for (const out of this.outputs) {
      try {
        out.send(raw);
      } catch {
        // RawOutput.send is documented fire-and-forget + must-not-throw.
        // A buggy implementation throwing is still not allowed to break
        // the hot path.
      }
    }
  }

  async shutdown(): Promise<void> {
    await Promise.all(this.outputs.map((o) => o.shutdown()));
  }

  all(): ReadonlyArray<RawOutput> {
    return this.outputs;
  }
}
```

- [ ] **Step 4: Run tests — verify pass**

Run: `npx vitest run src/core/raw-outputs/RawOutputChain.test.ts`
Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/raw-outputs/RawOutputChain.ts src/core/raw-outputs/RawOutputChain.test.ts
git commit -m "feat(raw-output): RawOutputChain fan-out with try-catch safety (TDD)"
```

---

## Phase 3 — Logging & Config

### Task 10: Logger module

**Files:**
- Create: `src/core/logging/logger.ts`

- [ ] **Step 1: Write the logger factory**

```ts
// src/core/logging/logger.ts
import pino, { type Logger, type LoggerOptions } from "pino";

export type { Logger } from "pino";

export interface LoggerConfig {
  level: "trace" | "debug" | "info" | "warn" | "error";
  pretty: boolean;
}

export function createRootLogger(cfg: LoggerConfig): Logger {
  const opts: LoggerOptions = {
    level: cfg.level,
    base: { pid: process.pid },
    timestamp: pino.stdTimeFunctions.isoTime,
  };
  if (cfg.pretty) {
    return pino({
      ...opts,
      transport: {
        target: "pino-pretty",
        options: { colorize: true, translateTime: "HH:MM:ss.l" },
      },
    });
  }
  return pino(opts);
}

export function childLogger(parent: Logger, module: string): Logger {
  return parent.child({ module });
}
```

No test — this is a thin wrapper around pino. The behavior is validated implicitly by integration tests.

- [ ] **Step 2: Commit**

```bash
git add src/core/logging/logger.ts
git commit -m "feat(logging): pino logger factory with per-module child loggers"
```

---

### Task 11: Config loader & schema (TDD)

**Files:**
- Create: `src/core/config/types.ts`
- Create: `src/core/config/schema.ts`
- Create: `src/core/config/loadConfig.ts`
- Create: `src/core/config/loadConfig.test.ts`

- [ ] **Step 1: Define config types**

```ts
// src/core/config/types.ts
export interface UDPInputConfig {
  type: "udp";
  port: number;
  host?: string;
}

export interface MockInputConfig {
  type: "mock";
  file: string;
  loop?: boolean;
  speed?: number;
}

export type InputConfig = UDPInputConfig | MockInputConfig;

export interface UDPForwardConfigEntry {
  name: string;
  type: "udp-forward";
  host: string;
  port: number;
  enabled: boolean;
}

export type RawOutputConfig = UDPForwardConfigEntry;

export interface HttpConfig {
  port: number;
}

export interface LoggingConfig {
  level: "trace" | "debug" | "info" | "warn" | "error";
  dir: string;
  pretty?: boolean;
}

export interface ModuleEntryConfig {
  enabled: boolean;
  config?: unknown;
}

export interface FstsConfig {
  input: InputConfig;
  rawOutputs: RawOutputConfig[];
  http: HttpConfig;
  logging: LoggingConfig;
  modules: Record<string, ModuleEntryConfig>;
}
```

- [ ] **Step 2: Define the core JSON schema**

```ts
// src/core/config/schema.ts
export const coreConfigSchema = {
  type: "object",
  required: ["input", "http", "logging"],
  properties: {
    input: {
      oneOf: [
        {
          type: "object",
          required: ["type", "port"],
          properties: {
            type: { const: "udp" },
            port: { type: "integer", minimum: 1, maximum: 65535 },
            host: { type: "string" },
          },
          additionalProperties: false,
        },
        {
          type: "object",
          required: ["type", "file"],
          properties: {
            type: { const: "mock" },
            file: { type: "string", minLength: 1 },
            loop: { type: "boolean" },
            speed: { type: "number", exclusiveMinimum: 0 },
          },
          additionalProperties: false,
        },
      ],
    },
    rawOutputs: {
      type: "array",
      items: {
        type: "object",
        required: ["name", "type", "host", "port", "enabled"],
        properties: {
          name: { type: "string", minLength: 1 },
          type: { const: "udp-forward" },
          host: { type: "string", minLength: 1 },
          port: { type: "integer", minimum: 1, maximum: 65535 },
          enabled: { type: "boolean" },
        },
        additionalProperties: false,
      },
    },
    http: {
      type: "object",
      required: ["port"],
      properties: {
        port: { type: "integer", minimum: 1, maximum: 65535 },
      },
      additionalProperties: false,
    },
    logging: {
      type: "object",
      required: ["level", "dir"],
      properties: {
        level: { enum: ["trace", "debug", "info", "warn", "error"] },
        dir: { type: "string", minLength: 1 },
        pretty: { type: "boolean" },
      },
      additionalProperties: false,
    },
    modules: {
      type: "object",
      additionalProperties: {
        type: "object",
        required: ["enabled"],
        properties: {
          enabled: { type: "boolean" },
          config: {},
        },
      },
    },
  },
  additionalProperties: false,
} as const;
```

- [ ] **Step 3: Write the failing loader test**

```ts
// src/core/config/loadConfig.test.ts
import { describe, it, expect } from "vitest";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, ConfigValidationError } from "./loadConfig";

function writeTempConfig(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), "fsts-cfg-"));
  const path = join(dir, "config.jsonc");
  writeFileSync(path, contents);
  return path;
}

const VALID = `{
  // JSONC comments are allowed
  "input": { "type": "udp", "port": 9999 },
  "rawOutputs": [],
  "http": { "port": 5780 },
  "logging": { "level": "info", "dir": "./logs" },
  "modules": {}
}`;

describe("loadConfig", () => {
  it("parses a valid JSONC config", () => {
    const path = writeTempConfig(VALID);
    const cfg = loadConfig(path);
    expect(cfg.http.port).toBe(5780);
    expect(cfg.input.type).toBe("udp");
  });

  it("throws ConfigValidationError for missing required fields", () => {
    const path = writeTempConfig(`{ "http": { "port": 5780 } }`);
    expect(() => loadConfig(path)).toThrow(ConfigValidationError);
  });

  it("throws ConfigValidationError for invalid port", () => {
    const path = writeTempConfig(
      VALID.replace(`"port": 9999`, `"port": 99999`)
    );
    expect(() => loadConfig(path)).toThrow(ConfigValidationError);
  });
});
```

- [ ] **Step 4: Run test — verify failure**

Run: `npx vitest run src/core/config/loadConfig.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 5: Implement `loadConfig`**

```ts
// src/core/config/loadConfig.ts
import { readFileSync } from "node:fs";
import { parse as parseJsonc, printParseErrorCode } from "jsonc-parser";
import Ajv from "ajv";
import { coreConfigSchema } from "./schema";
import type { FstsConfig } from "./types";

export class ConfigValidationError extends Error {
  constructor(message: string, public readonly details: unknown[] = []) {
    super(message);
    this.name = "ConfigValidationError";
  }
}

const ajv = new Ajv({ allErrors: true });
const validateCore = ajv.compile(coreConfigSchema);

export function loadConfig(path: string): FstsConfig {
  const raw = readFileSync(path, "utf8");
  const errors: { error: number; offset: number; length: number }[] = [];
  const parsed = parseJsonc(raw, errors, { allowTrailingComma: true });
  if (errors.length > 0) {
    const msg = errors
      .map((e) => `${printParseErrorCode(e.error)} at offset ${e.offset}`)
      .join("; ");
    throw new ConfigValidationError(`JSONC parse error: ${msg}`);
  }
  if (!validateCore(parsed)) {
    const details = validateCore.errors ?? [];
    const msg = details
      .map((e) => `${e.instancePath || "<root>"} ${e.message}`)
      .join("; ");
    throw new ConfigValidationError(`Invalid config: ${msg}`, details);
  }
  return parsed as FstsConfig;
}
```

- [ ] **Step 6: Run tests — verify pass**

Run: `npx vitest run src/core/config/loadConfig.test.ts`
Expected: 3 tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/core/config/types.ts src/core/config/schema.ts src/core/config/loadConfig.ts src/core/config/loadConfig.test.ts
git commit -m "feat(config): JSONC loader with ajv schema validation (TDD)"
```

---

## Phase 4 — Plugin System

### Task 12: Define `Plugin` and `PluginContext` interfaces

**Files:**
- Create: `src/core/plugin-host/Plugin.ts`

- [ ] **Step 1: Write the interfaces**

```ts
// src/core/plugin-host/Plugin.ts
import type { TelemetryPacket } from "../parser/TelemetryPacket";
import type { Logger } from "../logging/logger";
import type { Request, Response } from "express";

export type RouteHandler = (req: Request, res: Response) => void | Promise<void>;
export type HttpMethod = "GET" | "POST";
export type EmitChannel = "events" | "admin";

export interface PluginContext {
  /** Emit a WS message on a listener-managed channel. */
  emit(channel: EmitChannel, event: string, payload: unknown): void;
  /** Register an HTTP route scoped under the plugin's id namespace. */
  registerRoute(method: HttpMethod, path: string, handler: RouteHandler): void;
  /** Per-module child logger, pre-tagged with module id. */
  log: Logger;
  /** This plugin's config slice (as loaded from config.jsonc). */
  config: unknown;
}

export interface Plugin {
  readonly id: string;
  readonly displayName: string;
  readonly description?: string;
  readonly configSchema?: object;
  onStart(ctx: PluginContext): Promise<void> | void;
  onTelemetry?(pkt: TelemetryPacket, ctx: PluginContext): void;
  onStop(): Promise<void> | void;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/core/plugin-host/Plugin.ts
git commit -m "feat(plugin-host): Plugin and PluginContext interfaces"
```

---

### Task 13: Implement `PluginHost` lifecycle + config slicing (TDD)

**Files:**
- Create: `src/core/plugin-host/PluginHost.ts`
- Create: `src/core/plugin-host/PluginHost.test.ts`

- [ ] **Step 1: Write the failing test (lifecycle + slicing)**

```ts
// src/core/plugin-host/PluginHost.test.ts
import { describe, it, expect, vi } from "vitest";
import { PluginHost } from "./PluginHost";
import type { Plugin } from "./Plugin";
import { TelemetryBus } from "../bus/TelemetryBus";
import pino from "pino";

function makePlugin(id: string, hooks: Partial<Plugin> = {}): Plugin {
  return {
    id,
    displayName: id,
    onStart: vi.fn(),
    onStop: vi.fn(),
    ...hooks,
  };
}

function silentLogger() {
  return pino({ level: "silent" });
}

describe("PluginHost — lifecycle & config slicing", () => {
  it("calls onStart for enabled plugins only", async () => {
    const bus = new TelemetryBus();
    const log = silentLogger();
    const onStartA = vi.fn();
    const onStartB = vi.fn();
    const host = new PluginHost({
      plugins: [
        makePlugin("a", { onStart: onStartA }),
        makePlugin("b", { onStart: onStartB }),
      ],
      moduleConfig: {
        a: { enabled: true, config: { threshold: 10 } },
        b: { enabled: false },
      },
      bus,
      log,
      emit: () => {},
      registerRoute: () => {},
    });

    await host.start();
    expect(onStartA).toHaveBeenCalledTimes(1);
    expect(onStartB).not.toHaveBeenCalled();

    const aCtx = onStartA.mock.calls[0]![0];
    expect(aCtx.config).toEqual({ threshold: 10 });
  });

  it("subscribes enabled plugin onTelemetry handlers to the bus", async () => {
    const bus = new TelemetryBus();
    const log = silentLogger();
    const onTelemetry = vi.fn();
    const host = new PluginHost({
      plugins: [makePlugin("a", { onTelemetry })],
      moduleConfig: { a: { enabled: true } },
      bus,
      log,
      emit: () => {},
      registerRoute: () => {},
    });
    await host.start();

    bus.publish({
      timestamp: 1, isRaceOn: true, speed: 10, rpm: 3000, maxRpm: 7000, gear: 2,
      accelLateral: 0, accelLongitudinal: 0,
      tireSlipRatio: { fl: 0, fr: 0, rl: 0, rr: 0 },
      carOrdinal: 1, carClass: 0, drivetrainType: 0,
    });

    expect(onTelemetry).toHaveBeenCalledTimes(1);
  });

  it("enable/disable toggles subscription mid-run", async () => {
    const bus = new TelemetryBus();
    const onTelemetry = vi.fn();
    const host = new PluginHost({
      plugins: [makePlugin("a", { onTelemetry })],
      moduleConfig: { a: { enabled: true } },
      bus,
      log: silentLogger(),
      emit: () => {},
      registerRoute: () => {},
    });
    await host.start();
    await host.disable("a");

    bus.publish({
      timestamp: 1, isRaceOn: true, speed: 10, rpm: 3000, maxRpm: 7000, gear: 2,
      accelLateral: 0, accelLongitudinal: 0,
      tireSlipRatio: { fl: 0, fr: 0, rl: 0, rr: 0 },
      carOrdinal: 1, carClass: 0, drivetrainType: 0,
    });
    expect(onTelemetry).not.toHaveBeenCalled();

    await host.enable("a");
    bus.publish({
      timestamp: 2, isRaceOn: true, speed: 10, rpm: 3000, maxRpm: 7000, gear: 2,
      accelLateral: 0, accelLongitudinal: 0,
      tireSlipRatio: { fl: 0, fr: 0, rl: 0, rr: 0 },
      carOrdinal: 1, carClass: 0, drivetrainType: 0,
    });
    expect(onTelemetry).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test — verify failure**

Run: `npx vitest run src/core/plugin-host/PluginHost.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `PluginHost` (lifecycle + slicing + toggle)**

```ts
// src/core/plugin-host/PluginHost.ts
import type { Plugin, PluginContext, EmitChannel, HttpMethod, RouteHandler } from "./Plugin";
import type { TelemetryBus } from "../bus/TelemetryBus";
import type { Logger } from "../logging/logger";
import { childLogger } from "../logging/logger";
import type { ModuleEntryConfig } from "../config/types";
import type { TelemetryPacket } from "../parser/TelemetryPacket";

export type EmitFn = (
  moduleId: string,
  channel: EmitChannel,
  event: string,
  payload: unknown,
) => void;

export type RegisterRouteFn = (
  moduleId: string,
  method: HttpMethod,
  path: string,
  handler: RouteHandler,
) => void;

export type UnregisterRoutesFn = (moduleId: string) => void;

export interface PluginHostOptions {
  plugins: Plugin[];
  moduleConfig: Record<string, ModuleEntryConfig>;
  bus: TelemetryBus;
  log: Logger;
  emit: EmitFn;
  registerRoute: RegisterRouteFn;
  unregisterRoutes?: UnregisterRoutesFn;
  /** Auto-disable thresholds, with sensible defaults */
  errorWindowMs?: number;   // default 10000
  errorThreshold?: number;  // default 5
  onStateChange?: (state: PluginRecord[]) => void;
}

export type PluginStatus = "running" | "stopped" | "errored";

export interface PluginRecord {
  id: string;
  displayName: string;
  description?: string;
  enabled: boolean;           // config + runtime
  status: PluginStatus;
  errorCount: number;
  lastError: string | null;
  customStatus: string | null; // set by module via ctx.emit("admin","status", "...")
}

export class PluginHost {
  private plugins: Plugin[];
  private config: Record<string, ModuleEntryConfig>;
  private bus: TelemetryBus;
  private log: Logger;
  private emit: EmitFn;
  private registerRoute: RegisterRouteFn;
  private unregisterRoutes: UnregisterRoutesFn;
  private records = new Map<string, PluginRecord>();
  private unsubscribers = new Map<string, () => void>();
  private errorTimestamps = new Map<string, number[]>();
  private errorWindowMs: number;
  private errorThreshold: number;
  private onStateChange?: (state: PluginRecord[]) => void;

  constructor(opts: PluginHostOptions) {
    this.plugins = opts.plugins;
    this.config = opts.moduleConfig;
    this.bus = opts.bus;
    this.log = opts.log;
    this.emit = opts.emit;
    this.registerRoute = opts.registerRoute;
    this.unregisterRoutes = opts.unregisterRoutes ?? (() => {});
    this.errorWindowMs = opts.errorWindowMs ?? 10_000;
    this.errorThreshold = opts.errorThreshold ?? 5;
    this.onStateChange = opts.onStateChange;
  }

  async start(): Promise<void> {
    for (const plugin of this.plugins) {
      const entry = this.config[plugin.id] ?? { enabled: false };
      this.records.set(plugin.id, {
        id: plugin.id,
        displayName: plugin.displayName,
        description: plugin.description,
        enabled: entry.enabled,
        status: "stopped",
        errorCount: 0,
        lastError: null,
        customStatus: null,
      });
      if (entry.enabled) {
        await this.startPlugin(plugin);
      }
    }
    this.broadcastState();
  }

  async stop(): Promise<void> {
    for (const plugin of this.plugins) {
      const rec = this.records.get(plugin.id);
      if (rec?.status === "running") {
        await this.stopPlugin(plugin);
      }
    }
  }

  async enable(id: string): Promise<void> {
    const plugin = this.plugins.find((p) => p.id === id);
    const rec = this.records.get(id);
    if (!plugin || !rec) throw new Error(`Unknown module: ${id}`);
    rec.enabled = true;
    if (rec.status !== "running") await this.startPlugin(plugin);
    this.broadcastState();
  }

  async disable(id: string): Promise<void> {
    const plugin = this.plugins.find((p) => p.id === id);
    const rec = this.records.get(id);
    if (!plugin || !rec) throw new Error(`Unknown module: ${id}`);
    rec.enabled = false;
    if (rec.status === "running") await this.stopPlugin(plugin);
    this.broadcastState();
  }

  state(): PluginRecord[] {
    return Array.from(this.records.values()).map((r) => ({ ...r }));
  }

  /** Called by the server when a module emits "admin"/"status". */
  setCustomStatus(moduleId: string, status: string): void {
    const rec = this.records.get(moduleId);
    if (!rec) return;
    rec.customStatus = status;
    this.broadcastState();
  }

  private async startPlugin(plugin: Plugin): Promise<void> {
    const rec = this.records.get(plugin.id)!;
    const ctx = this.makeContext(plugin);
    try {
      await plugin.onStart(ctx);
      if (plugin.onTelemetry) {
        const wrapped = (pkt: TelemetryPacket) => this.callTelemetry(plugin, ctx, pkt);
        const unsub = this.bus.subscribe(wrapped);
        this.unsubscribers.set(plugin.id, unsub);
      }
      rec.status = "running";
      rec.lastError = null;
      this.log.info({ module: plugin.id }, "module started");
    } catch (err) {
      rec.status = "errored";
      rec.lastError = err instanceof Error ? err.message : String(err);
      this.log.error({ module: plugin.id, err }, "module onStart threw");
    }
  }

  private async stopPlugin(plugin: Plugin): Promise<void> {
    const rec = this.records.get(plugin.id)!;
    const unsub = this.unsubscribers.get(plugin.id);
    if (unsub) {
      unsub();
      this.unsubscribers.delete(plugin.id);
    }
    this.unregisterRoutes(plugin.id);
    try {
      await plugin.onStop();
    } catch (err) {
      this.log.error({ module: plugin.id, err }, "module onStop threw");
    }
    rec.status = "stopped";
    this.log.info({ module: plugin.id }, "module stopped");
  }

  private callTelemetry(plugin: Plugin, ctx: PluginContext, pkt: TelemetryPacket): void {
    if (!plugin.onTelemetry) return;
    try {
      plugin.onTelemetry(pkt, ctx);
    } catch (err) {
      this.recordError(plugin, err);
    }
  }

  private recordError(plugin: Plugin, err: unknown): void {
    const rec = this.records.get(plugin.id)!;
    rec.errorCount++;
    rec.lastError = err instanceof Error ? err.message : String(err);
    this.log.error({ module: plugin.id, err }, "module onTelemetry threw");

    const now = Date.now();
    const ts = this.errorTimestamps.get(plugin.id) ?? [];
    ts.push(now);
    const cutoff = now - this.errorWindowMs;
    const recent = ts.filter((t) => t >= cutoff);
    this.errorTimestamps.set(plugin.id, recent);
    if (recent.length >= this.errorThreshold) {
      this.log.warn(
        { module: plugin.id, recentErrors: recent.length },
        "auto-disabling module due to repeated errors",
      );
      void this.disable(plugin.id).catch(() => {});
    }
  }

  private makeContext(plugin: Plugin): PluginContext {
    return {
      emit: (channel, event, payload) => {
        const rec = this.records.get(plugin.id);
        if (!rec?.enabled) return;
        if (channel === "admin" && event === "status" && typeof payload === "string") {
          this.setCustomStatus(plugin.id, payload);
          return;
        }
        this.emit(plugin.id, channel, event, payload);
      },
      registerRoute: (method, path, handler) => {
        this.registerRoute(plugin.id, method, path, handler);
      },
      log: childLogger(this.log, plugin.id),
      config: (this.config[plugin.id]?.config) ?? {},
    };
  }

  private broadcastState(): void {
    this.onStateChange?.(this.state());
  }
}
```

- [ ] **Step 4: Run tests — verify pass**

Run: `npx vitest run src/core/plugin-host/PluginHost.test.ts`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/plugin-host/PluginHost.ts src/core/plugin-host/PluginHost.test.ts
git commit -m "feat(plugin-host): PluginHost lifecycle, enable/disable, config slicing (TDD)"
```

---

### Task 14: PluginHost crash-isolation & auto-disable (TDD)

Extends the test suite to verify the try/catch hot path and the auto-disable threshold.

**Files:**
- Modify: `src/core/plugin-host/PluginHost.test.ts`

- [ ] **Step 1: Add failing tests for crash isolation**

Append to existing `PluginHost.test.ts`:

```ts
describe("PluginHost — crash isolation", () => {
  it("a throwing onTelemetry does not bubble out", async () => {
    const bus = new TelemetryBus();
    const host = new PluginHost({
      plugins: [makePlugin("a", { onTelemetry: () => { throw new Error("boom"); } })],
      moduleConfig: { a: { enabled: true } },
      bus,
      log: silentLogger(),
      emit: () => {},
      registerRoute: () => {},
      errorThreshold: 999, // don't auto-disable for this test
    });
    await host.start();
    // Expect NOT to throw
    bus.publish({
      timestamp: 1, isRaceOn: true, speed: 0, rpm: 0, maxRpm: 7000, gear: 0,
      accelLateral: 0, accelLongitudinal: 0,
      tireSlipRatio: { fl: 0, fr: 0, rl: 0, rr: 0 },
      carOrdinal: 0, carClass: 0, drivetrainType: 0,
    });
    const rec = host.state().find((r) => r.id === "a")!;
    expect(rec.errorCount).toBe(1);
    expect(rec.lastError).toContain("boom");
  });

  it("auto-disables after threshold errors within window", async () => {
    const bus = new TelemetryBus();
    const host = new PluginHost({
      plugins: [makePlugin("a", { onTelemetry: () => { throw new Error("boom"); } })],
      moduleConfig: { a: { enabled: true } },
      bus,
      log: silentLogger(),
      emit: () => {},
      registerRoute: () => {},
      errorWindowMs: 10_000,
      errorThreshold: 3,
    });
    await host.start();
    const pkt = {
      timestamp: 1, isRaceOn: true, speed: 0, rpm: 0, maxRpm: 7000, gear: 0,
      accelLateral: 0, accelLongitudinal: 0,
      tireSlipRatio: { fl: 0, fr: 0, rl: 0, rr: 0 },
      carOrdinal: 0, carClass: 0, drivetrainType: 0,
    };
    bus.publish(pkt);
    bus.publish(pkt);
    bus.publish(pkt); // threshold hit → auto-disable
    // Yield to the event loop so the async disable can run
    await new Promise((r) => setTimeout(r, 10));
    const rec = host.state().find((r) => r.id === "a")!;
    expect(rec.enabled).toBe(false);
    expect(rec.status).toBe("stopped");
  });
});
```

- [ ] **Step 2: Run tests — confirm pass**

Run: `npx vitest run src/core/plugin-host/PluginHost.test.ts`
Expected: 5 tests pass (3 prior + 2 new).

The `PluginHost` implementation in Task 13 already provides this behavior, so no code changes are needed — these tests validate the implementation rather than drive new code.

- [ ] **Step 3: Commit**

```bash
git add src/core/plugin-host/PluginHost.test.ts
git commit -m "test(plugin-host): verify crash isolation and auto-disable"
```

---

## Phase 5 — HTTP + WebSocket Server

### Task 15: Server foundation with `/health` and `/telemetry/latest` (TDD)

**Files:**
- Create: `src/core/http/Server.ts`
- Create: `src/core/http/Server.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/core/http/Server.test.ts
import { describe, it, expect } from "vitest";
import { Server } from "./Server";
import { TelemetryBus } from "../bus/TelemetryBus";
import pino from "pino";
import type { AddressInfo } from "node:net";

function silentLog() { return pino({ level: "silent" }); }

describe("Server — foundation", () => {
  it("serves /health", async () => {
    const bus = new TelemetryBus();
    const server = new Server({ port: 0, bus, log: silentLog() });
    await server.start();
    const port = (server.address() as AddressInfo).port;
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string; packetsReceived: number };
    expect(body.status).toBe("ok");
    expect(typeof body.packetsReceived).toBe("number");
    await server.stop();
  });

  it("/telemetry/latest returns 204 when no packet", async () => {
    const bus = new TelemetryBus();
    const server = new Server({ port: 0, bus, log: silentLog() });
    await server.start();
    const port = (server.address() as AddressInfo).port;
    const res = await fetch(`http://127.0.0.1:${port}/telemetry/latest`);
    expect(res.status).toBe(204);
    await server.stop();
  });

  it("/telemetry/latest returns the cached packet", async () => {
    const bus = new TelemetryBus();
    bus.publish({
      timestamp: 1, isRaceOn: true, speed: 42, rpm: 3000, maxRpm: 7000, gear: 3,
      accelLateral: 0, accelLongitudinal: 0,
      tireSlipRatio: { fl: 0, fr: 0, rl: 0, rr: 0 },
      carOrdinal: 1, carClass: 0, drivetrainType: 0,
    });
    const server = new Server({ port: 0, bus, log: silentLog() });
    await server.start();
    const port = (server.address() as AddressInfo).port;
    const res = await fetch(`http://127.0.0.1:${port}/telemetry/latest`);
    expect(res.status).toBe(200);
    const body = await res.json() as { speed: number };
    expect(body.speed).toBe(42);
    await server.stop();
  });
});
```

- [ ] **Step 2: Run test — verify failure**

Run: `npx vitest run src/core/http/Server.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the `Server` foundation**

```ts
// src/core/http/Server.ts
import express, { type Express } from "express";
import { createServer, type Server as HttpServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { AddressInfo } from "node:net";
import type { TelemetryBus } from "../bus/TelemetryBus";
import type { Logger } from "../logging/logger";
import type { HttpMethod, RouteHandler } from "../plugin-host/Plugin";
import type { PluginRecord } from "../plugin-host/PluginHost";

export interface ServerOptions {
  port: number;
  bus: TelemetryBus;
  log: Logger;
}

type ModuleRoute = { method: HttpMethod; path: string; handler: RouteHandler; moduleId: string };

export class Server {
  private app: Express;
  private http: HttpServer;
  private wss: WebSocketServer;
  private wssEvents: WebSocketServer;
  private wssAdmin: WebSocketServer;
  private bus: TelemetryBus;
  private log: Logger;
  private cfgPort: number;
  private packetsReceived = 0;
  private startedAt = Date.now();
  private moduleRoutes: ModuleRoute[] = [];
  private disabledModules = new Set<string>();
  // State broadcast to admin clients
  private currentModuleState: PluginRecord[] = [];
  // Enable/disable callbacks wired from outside
  onEnable: (id: string) => Promise<void> = async () => {};
  onDisable: (id: string) => Promise<void> = async () => {};

  constructor(opts: ServerOptions) {
    this.app = express();
    this.app.use(express.json());
    this.bus = opts.bus;
    this.log = opts.log;
    this.cfgPort = opts.port;

    this.http = createServer(this.app);
    // Three WS endpoints, attached in the "upgrade" handler below
    this.wss = new WebSocketServer({ noServer: true });       // /telemetry
    this.wssEvents = new WebSocketServer({ noServer: true }); // /events
    this.wssAdmin = new WebSocketServer({ noServer: true });  // /admin

    this.setupRoutes();
    this.setupUpgrade();
    this.setupBusForwarding();
  }

  async start(): Promise<void> {
    await new Promise<void>((resolve) => this.http.listen(this.cfgPort, () => resolve()));
  }

  async stop(): Promise<void> {
    this.wss.clients.forEach((c) => c.terminate());
    this.wssEvents.clients.forEach((c) => c.terminate());
    this.wssAdmin.clients.forEach((c) => c.terminate());
    await new Promise<void>((resolve) => this.http.close(() => resolve()));
  }

  address(): AddressInfo | null {
    return this.http.address() as AddressInfo | null;
  }

  /** Called by bootstrap after PluginHost starts. */
  updateModuleState(state: PluginRecord[]): void {
    this.currentModuleState = state;
    const disabled = new Set<string>();
    for (const r of state) if (!r.enabled || r.status !== "running") disabled.add(r.id);
    this.disabledModules = disabled;
    // Broadcast to admin WS
    const msg = JSON.stringify({ type: "module-state", modules: state });
    this.wssAdmin.clients.forEach((c) => {
      if (c.readyState === WebSocket.OPEN) c.send(msg);
    });
  }

  registerModuleRoute(moduleId: string, method: HttpMethod, path: string, handler: RouteHandler): void {
    const normalized = path.startsWith("/") ? path : `/${path}`;
    this.moduleRoutes.push({ moduleId, method, path: normalized, handler });
  }

  unregisterModuleRoutes(moduleId: string): void {
    this.moduleRoutes = this.moduleRoutes.filter((r) => r.moduleId !== moduleId);
  }

  emitEvent(moduleId: string, event: string, payload: unknown): void {
    if (this.disabledModules.has(moduleId)) return;
    const msg = JSON.stringify({
      type: "event",
      source: moduleId,
      event,
      timestamp: Date.now(),
      payload,
    });
    this.wssEvents.clients.forEach((c) => {
      if (c.readyState === WebSocket.OPEN) c.send(msg);
    });
  }

  private setupRoutes(): void {
    this.app.get("/health", (_req, res) => {
      res.json({
        status: "ok",
        uptimeMs: Date.now() - this.startedAt,
        packetsReceived: this.packetsReceived,
      });
    });

    this.app.get("/telemetry/latest", (_req, res) => {
      const pkt = this.bus.lastPacket();
      if (!pkt) { res.status(204).end(); return; }
      res.json(pkt);
    });

    this.app.get("/modules", (_req, res) => {
      res.json(this.currentModuleState);
    });

    this.app.post("/modules/:id/enable", async (req, res) => {
      try {
        await this.onEnable(req.params.id);
        res.json({ ok: true });
      } catch (err) {
        res.status(400).json({ error: (err as Error).message });
      }
    });

    this.app.post("/modules/:id/disable", async (req, res) => {
      try {
        await this.onDisable(req.params.id);
        res.json({ ok: true });
      } catch (err) {
        res.status(400).json({ error: (err as Error).message });
      }
    });

    // Module-registered routes: match against moduleRoutes
    this.app.use(async (req, res, next) => {
      const route = this.moduleRoutes.find(
        (r) => r.method === req.method && r.path === req.path,
      );
      if (!route) { next(); return; }
      if (this.disabledModules.has(route.moduleId)) {
        res.status(503).json({ error: `Module ${route.moduleId} is disabled` });
        return;
      }
      try {
        await route.handler(req, res);
      } catch (err) {
        this.log.error({ err, moduleId: route.moduleId }, "module route threw");
        if (!res.headersSent) {
          res.status(500).json({ error: `Module ${route.moduleId} route error` });
        }
      }
    });
  }

  private setupUpgrade(): void {
    this.http.on("upgrade", (req, socket, head) => {
      const url = req.url ?? "";
      if (url === "/telemetry") {
        this.wss.handleUpgrade(req, socket, head, (ws) => this.wss.emit("connection", ws, req));
      } else if (url === "/events") {
        this.wssEvents.handleUpgrade(req, socket, head, (ws) => this.wssEvents.emit("connection", ws, req));
      } else if (url === "/admin") {
        this.wssAdmin.handleUpgrade(req, socket, head, (ws) => {
          this.wssAdmin.emit("connection", ws, req);
          // Send initial state snapshot to new admin client
          ws.send(JSON.stringify({ type: "module-state", modules: this.currentModuleState }));
        });
      } else {
        socket.destroy();
      }
    });
  }

  private setupBusForwarding(): void {
    this.bus.subscribe((pkt) => {
      this.packetsReceived++;
      const msg = JSON.stringify({ type: "telemetry", timestamp: pkt.timestamp, data: pkt });
      this.wss.clients.forEach((c) => {
        if (c.readyState === WebSocket.OPEN) c.send(msg);
      });
    });
  }
}
```

- [ ] **Step 4: Run tests — verify pass**

Run: `npx vitest run src/core/http/Server.test.ts`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/http/Server.ts src/core/http/Server.test.ts
git commit -m "feat(http): Server with /health, /telemetry/latest, /modules, WS hooks (TDD)"
```

---

### Task 16: Test `/telemetry` WS broadcast + `/events` WS + module toggle endpoints (TDD)

**Files:**
- Modify: `src/core/http/Server.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `Server.test.ts`:

```ts
import WebSocket from "ws";

describe("Server — WebSocket broadcasts", () => {
  it("broadcasts published packets on /telemetry", async () => {
    const bus = new TelemetryBus();
    const server = new Server({ port: 0, bus, log: silentLog() });
    await server.start();
    const port = (server.address() as AddressInfo).port;

    const ws = new WebSocket(`ws://127.0.0.1:${port}/telemetry`);
    await new Promise((r) => ws.on("open", r));
    const msgs: string[] = [];
    ws.on("message", (data) => msgs.push(data.toString()));

    bus.publish({
      timestamp: 1, isRaceOn: true, speed: 99, rpm: 1, maxRpm: 2, gear: 1,
      accelLateral: 0, accelLongitudinal: 0,
      tireSlipRatio: { fl: 0, fr: 0, rl: 0, rr: 0 },
      carOrdinal: 0, carClass: 0, drivetrainType: 0,
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(msgs.length).toBe(1);
    const parsed = JSON.parse(msgs[0]!);
    expect(parsed.type).toBe("telemetry");
    expect(parsed.data.speed).toBe(99);

    ws.close();
    await server.stop();
  });

  it("emitEvent() broadcasts on /events", async () => {
    const bus = new TelemetryBus();
    const server = new Server({ port: 0, bus, log: silentLog() });
    await server.start();
    const port = (server.address() as AddressInfo).port;
    // Update state so module is considered enabled
    server.updateModuleState([{
      id: "m", displayName: "m", enabled: true, status: "running",
      errorCount: 0, lastError: null, customStatus: null,
    }]);

    const ws = new WebSocket(`ws://127.0.0.1:${port}/events`);
    await new Promise((r) => ws.on("open", r));
    const msgs: string[] = [];
    ws.on("message", (d) => msgs.push(d.toString()));

    server.emitEvent("m", "hello", { x: 1 });
    await new Promise((r) => setTimeout(r, 50));
    expect(msgs.length).toBe(1);
    const parsed = JSON.parse(msgs[0]!);
    expect(parsed.source).toBe("m");
    expect(parsed.event).toBe("hello");
    expect(parsed.payload).toEqual({ x: 1 });

    ws.close();
    await server.stop();
  });

  it("POST /modules/:id/disable invokes onDisable callback", async () => {
    const bus = new TelemetryBus();
    const server = new Server({ port: 0, bus, log: silentLog() });
    let disabled = "";
    server.onDisable = async (id) => { disabled = id; };
    await server.start();
    const port = (server.address() as AddressInfo).port;
    const res = await fetch(`http://127.0.0.1:${port}/modules/redline-alert/disable`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
    expect(disabled).toBe("redline-alert");
    await server.stop();
  });

  it("module route returns 503 when module is disabled", async () => {
    const bus = new TelemetryBus();
    const server = new Server({ port: 0, bus, log: silentLog() });
    server.registerModuleRoute("m", "GET", "/modules/m/data", (_req, res) => {
      res.json({ x: 1 });
    });
    server.updateModuleState([{
      id: "m", displayName: "m", enabled: false, status: "stopped",
      errorCount: 0, lastError: null, customStatus: null,
    }]);
    await server.start();
    const port = (server.address() as AddressInfo).port;
    const res = await fetch(`http://127.0.0.1:${port}/modules/m/data`);
    expect(res.status).toBe(503);
    await server.stop();
  });
});
```

- [ ] **Step 2: Run tests — verify pass**

Run: `npx vitest run src/core/http/Server.test.ts`
Expected: 7 tests pass (3 from Task 15 + 4 new). The Task 15 implementation already covers this; these tests pin down the behavior.

- [ ] **Step 3: Commit**

```bash
git add src/core/http/Server.test.ts
git commit -m "test(http): validate /telemetry WS, /events WS, module toggle endpoints"
```

---

## Phase 6 — Admin Panel UI

### Task 17: Serve the static Admin Panel

**Files:**
- Create: `src/core/hub/index.html`
- Create: `src/core/hub/hub.js`
- Create: `src/core/hub/hub.css`
- Modify: `src/core/http/Server.ts`

- [ ] **Step 1: Write `src/core/hub/index.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>FSTS Admin</title>
  <link rel="stylesheet" href="/hub/static/hub.css" />
</head>
<body>
  <header>
    <h1>FSTS</h1>
    <div class="status">
      <span id="input-label">Input: —</span>
      <span id="uptime">Uptime: —</span>
      <span id="packets">Packets: 0</span>
    </div>
  </header>
  <main>
    <section id="modules">
      <h2>Modules</h2>
      <ul id="module-list"></ul>
    </section>
  </main>
  <script src="/hub/static/hub.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write `src/core/hub/hub.css`**

```css
body { font-family: system-ui, sans-serif; margin: 0; background: #111; color: #eee; }
header { display: flex; justify-content: space-between; padding: 12px 20px; border-bottom: 1px solid #333; }
header h1 { margin: 0; font-size: 18px; }
.status span { margin-left: 14px; font-size: 13px; color: #aaa; }
main { padding: 20px; }
#module-list { list-style: none; padding: 0; }
#module-list li { display: flex; align-items: center; padding: 8px 0; border-bottom: 1px solid #222; }
#module-list li input { margin-right: 12px; }
#module-list li .name { flex: 1; }
#module-list li .status-pill { padding: 2px 8px; border-radius: 10px; font-size: 11px; }
.status-pill.running { background: #0a5; color: #fff; }
.status-pill.stopped { background: #555; color: #ccc; }
.status-pill.errored { background: #a33; color: #fff; }
.error { color: #f77; font-size: 11px; margin-left: 8px; }
.custom-status { color: #9cf; font-size: 12px; margin-left: 8px; }
```

- [ ] **Step 3: Write `src/core/hub/hub.js`**

```js
// Served at /hub/static/hub.js
let modules = [];
const list = document.getElementById("module-list");
const packetsEl = document.getElementById("packets");
const uptimeEl = document.getElementById("uptime");
const inputEl = document.getElementById("input-label");

async function fetchModules() {
  const res = await fetch("/modules");
  modules = await res.json();
  render();
}

async function fetchHealth() {
  const res = await fetch("/health");
  const h = await res.json();
  packetsEl.textContent = `Packets: ${h.packetsReceived}`;
  uptimeEl.textContent = `Uptime: ${Math.floor(h.uptimeMs / 1000)}s`;
}

function render() {
  list.innerHTML = "";
  for (const m of modules) {
    const li = document.createElement("li");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = m.enabled;
    cb.addEventListener("change", () => toggle(m.id, cb.checked));

    const name = document.createElement("span");
    name.className = "name";
    name.textContent = m.displayName;

    const pill = document.createElement("span");
    pill.className = `status-pill ${m.status}`;
    pill.textContent = m.status;

    li.append(cb, name, pill);

    if (m.customStatus) {
      const cs = document.createElement("span");
      cs.className = "custom-status";
      cs.textContent = m.customStatus;
      li.append(cs);
    }
    if (m.lastError) {
      const err = document.createElement("span");
      err.className = "error";
      err.textContent = `! ${m.lastError}`;
      li.append(err);
    }
    list.append(li);
  }
}

async function toggle(id, enable) {
  await fetch(`/modules/${id}/${enable ? "enable" : "disable"}`, { method: "POST" });
  // Admin WS will broadcast the updated state; no need to refetch here
}

function connectAdminWs() {
  const ws = new WebSocket(`ws://${location.host}/admin`);
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === "module-state") {
      modules = msg.modules;
      render();
    }
  });
  ws.addEventListener("close", () => setTimeout(connectAdminWs, 1000));
}

fetchModules();
fetchHealth();
setInterval(fetchHealth, 1000);
connectAdminWs();
```

- [ ] **Step 4: Add hub route handlers in `Server.ts`**

Edit `src/core/http/Server.ts` — inside `setupRoutes()`, add AFTER the existing `this.app.get("/modules", ...)` block, BEFORE the `this.app.use(...)` module-routes middleware:

```ts
    // Admin Panel
    const hubDir = new URL("../hub/", import.meta.url);
    this.app.get("/hub", (_req, res) => {
      res.sendFile(new URL("./index.html", hubDir).pathname);
    });
    this.app.use("/hub/static", express.static(new URL("./", hubDir).pathname));
```

Note: `index.html` references `/hub/static/hub.js` and `/hub/static/hub.css` — those resolve into `src/core/hub/hub.js` and `src/core/hub/hub.css` via the static handler.

- [ ] **Step 5: Smoke test via unit test**

Append to `src/core/http/Server.test.ts`:

```ts
describe("Server — hub", () => {
  it("serves /hub HTML", async () => {
    const bus = new TelemetryBus();
    const server = new Server({ port: 0, bus, log: silentLog() });
    await server.start();
    const port = (server.address() as AddressInfo).port;
    const res = await fetch(`http://127.0.0.1:${port}/hub`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("FSTS Admin");
    await server.stop();
  });
});
```

- [ ] **Step 6: Run tests — verify pass**

Run: `npx vitest run src/core/http/Server.test.ts`
Expected: 8 tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/core/hub/index.html src/core/hub/hub.js src/core/hub/hub.css src/core/http/Server.ts src/core/http/Server.test.ts
git commit -m "feat(hub): static Admin Panel served from /hub"
```

---

## Phase 7 — Validator Modules

### Task 18: Backseat Speedometer module (pull path)

Validates the pure-HTTP module pattern: a `Plugin` that implements only `onStart`, registers its own HTTP route, and returns formatted telemetry.

**Files:**
- Create: `src/modules/backseat-speedometer/plugin.ts`
- Create: `src/modules/backseat-speedometer/config.schema.json`
- Create: `src/modules/backseat-speedometer/plugin.test.ts`
- Create: `src/modules/backseat-speedometer/README.md`

- [ ] **Step 1: Write `config.schema.json`**

```json
{
  "type": "object",
  "required": [],
  "properties": {
    "defaultUnits": { "enum": ["mph", "kph"] }
  },
  "additionalProperties": false
}
```

- [ ] **Step 2: Write the failing test**

```ts
// src/modules/backseat-speedometer/plugin.test.ts
import { describe, it, expect, vi } from "vitest";
import { backseatSpeedometer } from "./plugin";
import type { Request, Response } from "express";
import pino from "pino";

function mockRes() {
  const res: Partial<Response> & { _status?: number; _json?: unknown; _end?: boolean } = {};
  res.status = vi.fn((n: number) => { res._status = n; return res as Response; });
  res.json = vi.fn((body: unknown) => { res._json = body; return res as Response; });
  res.end = vi.fn(() => { res._end = true; return res as Response; });
  return res as Response & { _status?: number; _json?: unknown; _end?: boolean };
}

describe("backseatSpeedometer plugin", () => {
  it("registers a GET /modules/backseat-speedometer/latest route", async () => {
    let capturedHandler: ((req: Request, res: Response) => Promise<void> | void) | null = null;
    const ctx = {
      emit: vi.fn(),
      registerRoute: vi.fn((method, path, handler) => {
        if (method === "GET" && path === "/modules/backseat-speedometer/latest") {
          capturedHandler = handler;
        }
      }),
      log: pino({ level: "silent" }),
      config: {},
    };
    await backseatSpeedometer.onStart(ctx as never);
    expect(ctx.registerRoute).toHaveBeenCalled();
    expect(capturedHandler).not.toBeNull();
  });
});
```

- [ ] **Step 3: Run test — verify failure**

Run: `npx vitest run src/modules/backseat-speedometer/plugin.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the module**

```ts
// src/modules/backseat-speedometer/plugin.ts
import type { Plugin, PluginContext } from "../../core/plugin-host/Plugin";
import type { Request, Response } from "express";

interface Config {
  defaultUnits?: "mph" | "kph";
}

// A bus reference is injected via PluginContext extensions — but the spec says
// plugins get telemetry through ctx or direct bus? Re-reading the spec: modules
// can either implement onTelemetry (pushed) or register routes (pull). Pull
// modules need access to the latest packet. We provide it by caching the most
// recent packet in the plugin itself via onTelemetry, since ctx does not expose
// the bus. This keeps the Plugin API minimal.
//
// Strategy: this plugin implements BOTH onTelemetry (to cache) AND onStart (to
// register the route). It still validates the "pull path" from SB's perspective.

let latest: Record<string, unknown> | null = null;
let cfg: Config = {};

export const backseatSpeedometer: Plugin = {
  id: "backseat-speedometer",
  displayName: "Backseat Speedometer",
  description: "Serves GET /modules/backseat-speedometer/latest for chat-command integrations",

  onStart(ctx: PluginContext) {
    cfg = (ctx.config ?? {}) as Config;
    ctx.registerRoute("GET", "/modules/backseat-speedometer/latest", (req: Request, res: Response) => {
      if (!latest) { res.status(204).end(); return; }
      const units = (req.query.units === "kph" || req.query.units === "mph")
        ? req.query.units
        : (cfg.defaultUnits ?? "mph");
      const speedMps = (latest.speed as number) ?? 0;
      const speed = units === "kph" ? speedMps * 3.6 : speedMps * 2.2369362921;
      res.json({
        ...latest,
        formatted: {
          speed: Number(speed.toFixed(1)),
          units,
          gear: latest.gear,
          rpm: Math.round((latest.rpm as number) ?? 0),
        },
      });
    });
    ctx.log.info({}, "backseat-speedometer started");
  },

  onTelemetry(pkt) {
    latest = pkt as unknown as Record<string, unknown>;
  },

  onStop() {
    latest = null;
  },
};
```

- [ ] **Step 5: Run test — verify pass**

Run: `npx vitest run src/modules/backseat-speedometer/plugin.test.ts`
Expected: 1 test passes.

- [ ] **Step 6: Write the `README.md`**

```markdown
# Backseat Speedometer

A pull-style module. Caches the latest telemetry packet and exposes it on:

```
GET /modules/backseat-speedometer/latest?units=mph|kph
```

Response includes the raw packet plus a `formatted` block with speed converted to the requested units, gear, and rounded RPM. Returns 204 when no packet has been received yet.

## Streamer.bot integration (reference)

- Chat command trigger: `!speed`
- Sub-action: Fetch URL `http://localhost:5780/modules/backseat-speedometer/latest?units=mph`
- Extract `formatted.speed`, `formatted.gear`, `formatted.rpm`
- Send Twitch chat reply formatted however you like.

## Config

```jsonc
"backseat-speedometer": {
  "enabled": true,
  "config": { "defaultUnits": "mph" }
}
```
```

- [ ] **Step 7: Commit**

```bash
git add src/modules/backseat-speedometer/
git commit -m "feat(modules): backseat-speedometer (pull path validator)"
```

---

### Task 19: Redline Alert module (push path)

**Files:**
- Create: `src/modules/redline-alert/plugin.ts`
- Create: `src/modules/redline-alert/config.schema.json`
- Create: `src/modules/redline-alert/plugin.test.ts`
- Create: `src/modules/redline-alert/README.md`

- [ ] **Step 1: Write `config.schema.json`**

```json
{
  "type": "object",
  "required": ["thresholdRatio", "minDurationMs", "cooldownMs"],
  "properties": {
    "thresholdRatio": { "type": "number", "minimum": 0.5, "maximum": 1.0 },
    "minDurationMs":  { "type": "integer", "minimum": 100 },
    "cooldownMs":     { "type": "integer", "minimum": 1000 }
  },
  "additionalProperties": false
}
```

- [ ] **Step 2: Write the failing test**

```ts
// src/modules/redline-alert/plugin.test.ts
import { describe, it, expect, vi } from "vitest";
import { redlineAlert } from "./plugin";
import pino from "pino";
import type { TelemetryPacket } from "../../core/parser/TelemetryPacket";

function pkt(rpm: number, maxRpm: number, timestamp: number, isRaceOn = true): TelemetryPacket {
  return {
    timestamp, isRaceOn, speed: 50, rpm, maxRpm, gear: 3,
    accelLateral: 0, accelLongitudinal: 0,
    tireSlipRatio: { fl: 0, fr: 0, rl: 0, rr: 0 },
    carOrdinal: 1, carClass: 0, drivetrainType: 0,
  };
}

function mockCtx() {
  const emit = vi.fn();
  const ctx = {
    emit,
    registerRoute: vi.fn(),
    log: pino({ level: "silent" }),
    config: { thresholdRatio: 0.96, minDurationMs: 1200, cooldownMs: 8000 },
  };
  return { ctx, emit };
}

describe("redlineAlert plugin", () => {
  it("does not emit on brief redline (< minDurationMs)", async () => {
    const { ctx, emit } = mockCtx();
    await redlineAlert.onStart(ctx as never);
    redlineAlert.onTelemetry!(pkt(7200, 7500, 0), ctx as never); // ratio 0.96
    redlineAlert.onTelemetry!(pkt(7200, 7500, 500), ctx as never);
    redlineAlert.onTelemetry!(pkt(6000, 7500, 700), ctx as never); // dropped out
    expect(emit).not.toHaveBeenCalled();
  });

  it("emits on sustained redline (≥ minDurationMs)", async () => {
    const { ctx, emit } = mockCtx();
    await redlineAlert.onStart(ctx as never);
    redlineAlert.onTelemetry!(pkt(7400, 7500, 0), ctx as never);
    redlineAlert.onTelemetry!(pkt(7400, 7500, 1250), ctx as never); // 1250ms ≥ 1200ms threshold
    expect(emit).toHaveBeenCalledTimes(1);
    const [channel, event, payload] = emit.mock.calls[0]!;
    expect(channel).toBe("events");
    expect(event).toBe("triggered");
    expect(payload).toMatchObject({ rpm: 7400, maxRpm: 7500 });
  });

  it("respects cooldown — no second emit within cooldownMs", async () => {
    const { ctx, emit } = mockCtx();
    await redlineAlert.onStart(ctx as never);
    redlineAlert.onTelemetry!(pkt(7400, 7500, 0), ctx as never);
    redlineAlert.onTelemetry!(pkt(7400, 7500, 1250), ctx as never); // fires
    // Drop out and back in — still within cooldown
    redlineAlert.onTelemetry!(pkt(5000, 7500, 2000), ctx as never);
    redlineAlert.onTelemetry!(pkt(7400, 7500, 2500), ctx as never);
    redlineAlert.onTelemetry!(pkt(7400, 7500, 4000), ctx as never); // 4000 - 1250 = 2750ms < 8000ms cooldown
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it("ignores packets when isRaceOn is false", async () => {
    const { ctx, emit } = mockCtx();
    await redlineAlert.onStart(ctx as never);
    redlineAlert.onTelemetry!(pkt(7400, 7500, 0, false), ctx as never);
    redlineAlert.onTelemetry!(pkt(7400, 7500, 1500, false), ctx as never);
    expect(emit).not.toHaveBeenCalled();
  });

  it("ignores when maxRpm is 0 (invalid state)", async () => {
    const { ctx, emit } = mockCtx();
    await redlineAlert.onStart(ctx as never);
    redlineAlert.onTelemetry!(pkt(7400, 0, 0), ctx as never);
    redlineAlert.onTelemetry!(pkt(7400, 0, 1500), ctx as never);
    expect(emit).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run test — verify failure**

Run: `npx vitest run src/modules/redline-alert/plugin.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the module**

```ts
// src/modules/redline-alert/plugin.ts
import type { Plugin, PluginContext } from "../../core/plugin-host/Plugin";
import type { TelemetryPacket } from "../../core/parser/TelemetryPacket";

interface Config {
  thresholdRatio: number;
  minDurationMs: number;
  cooldownMs: number;
}

interface State {
  aboveSince: number | null;
  lastFiredAt: number;
  cfg: Config;
}

let state: State = {
  aboveSince: null,
  lastFiredAt: 0,
  cfg: { thresholdRatio: 0.96, minDurationMs: 1200, cooldownMs: 8000 },
};

export const redlineAlert: Plugin = {
  id: "redline-alert",
  displayName: "Redline Alert",
  description: "Fires a push event when RPM sustains near max for long enough",

  onStart(ctx: PluginContext) {
    state = {
      aboveSince: null,
      lastFiredAt: 0,
      cfg: (ctx.config ?? state.cfg) as Config,
    };
    ctx.log.info({ cfg: state.cfg }, "redline-alert started");
  },

  onTelemetry(pkt: TelemetryPacket, ctx: PluginContext) {
    if (!pkt.isRaceOn || pkt.maxRpm <= 0) {
      state.aboveSince = null;
      return;
    }
    const ratio = pkt.rpm / pkt.maxRpm;
    const now = pkt.timestamp;

    if (ratio >= state.cfg.thresholdRatio) {
      if (state.aboveSince === null) {
        state.aboveSince = now;
      } else if (
        now - state.aboveSince >= state.cfg.minDurationMs &&
        now - state.lastFiredAt >= state.cfg.cooldownMs
      ) {
        ctx.emit("events", "triggered", {
          rpm: pkt.rpm,
          maxRpm: pkt.maxRpm,
          ratio: Number(ratio.toFixed(3)),
          durationMs: now - state.aboveSince,
        });
        state.lastFiredAt = now;
      }
    } else {
      state.aboveSince = null;
    }
  },

  onStop() {
    state.aboveSince = null;
  },
};
```

- [ ] **Step 5: Run tests — verify pass**

Run: `npx vitest run src/modules/redline-alert/plugin.test.ts`
Expected: 5 tests pass.

- [ ] **Step 6: Write the `README.md`**

```markdown
# Redline Alert

A push-style module. Watches RPM and emits a `triggered` event on `/events` WS channel when RPM sustains near max for long enough.

## WS event shape

```json
{
  "type": "event",
  "source": "redline-alert",
  "event": "triggered",
  "timestamp": 1744994123789,
  "payload": { "rpm": 7450, "maxRpm": 7500, "ratio": 0.993, "durationMs": 1250 }
}
```

## Streamer.bot integration (reference)

- WebSocket Client sub-action subscribes to `ws://localhost:5780/events`
- Filter: `$.source == "redline-alert" AND $.event == "triggered"`
- On match: play sound, send chat message

## Config

```jsonc
"redline-alert": {
  "enabled": true,
  "config": {
    "thresholdRatio": 0.96,
    "minDurationMs": 1200,
    "cooldownMs": 8000
  }
}
```
```

- [ ] **Step 7: Commit**

```bash
git add src/modules/redline-alert/
git commit -m "feat(modules): redline-alert (push path validator, TDD)"
```

---

### Task 20: Module registry

**Files:**
- Create: `src/modules/index.ts`

- [ ] **Step 1: Write the registry**

```ts
// src/modules/index.ts
import type { Plugin } from "../core/plugin-host/Plugin";
import { backseatSpeedometer } from "./backseat-speedometer/plugin";
import { redlineAlert } from "./redline-alert/plugin";

export const modules: Plugin[] = [
  backseatSpeedometer,
  redlineAlert,
];
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/index.ts
git commit -m "feat(modules): explicit module registry"
```

---

## Phase 8 — Wiring & Launchers

### Task 21: Main entry point

**Files:**
- Create: `src/index.ts`

- [ ] **Step 1: Write `src/index.ts`**

```ts
// src/index.ts
import { existsSync, copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, ConfigValidationError } from "./core/config/loadConfig";
import { createRootLogger, childLogger } from "./core/logging/logger";
import { DirectUDPInput } from "./core/input/DirectUDPInput";
import { MockInput } from "./core/input/MockInput";
import { parseDashPacket } from "./core/parser/PacketParser";
import { TelemetryBus } from "./core/bus/TelemetryBus";
import { UDPForwardOutput } from "./core/raw-outputs/UDPForwardOutput";
import { RawOutputChain } from "./core/raw-outputs/RawOutputChain";
import { Server } from "./core/http/Server";
import { PluginHost } from "./core/plugin-host/PluginHost";
import { modules as moduleRegistry } from "./modules/index";
import type { InputSource } from "./core/input/InputSource";
import type { FstsConfig } from "./core/config/types";

const CONFIG_PATH = "./config.jsonc";
const EXAMPLE_PATH = "./config.example.jsonc";

async function ensureConfig(): Promise<void> {
  if (!existsSync(CONFIG_PATH)) {
    if (existsSync(EXAMPLE_PATH)) {
      copyFileSync(EXAMPLE_PATH, CONFIG_PATH);
      console.error(`Created default ${CONFIG_PATH} from example — review and restart.`);
    } else {
      console.error(`Missing ${CONFIG_PATH} and no ${EXAMPLE_PATH} to copy from.`);
    }
    process.exit(1);
  }
}

function createInput(cfg: FstsConfig): InputSource {
  if (cfg.input.type === "udp") {
    return new DirectUDPInput({ port: cfg.input.port, host: cfg.input.host });
  }
  return new MockInput({
    file: cfg.input.file, loop: cfg.input.loop, speed: cfg.input.speed,
  });
}

async function main(): Promise<void> {
  await ensureConfig();

  let cfg: FstsConfig;
  try {
    cfg = loadConfig(CONFIG_PATH);
  } catch (err) {
    if (err instanceof ConfigValidationError) {
      console.error(`Invalid config: ${err.message}`);
      process.exit(2);
    }
    throw err;
  }

  mkdirSync(cfg.logging.dir, { recursive: true });
  const rootLog = createRootLogger({ level: cfg.logging.level, pretty: cfg.logging.pretty ?? true });
  const log = childLogger(rootLog, "fsts");

  // Raw outputs
  const rawOutputs = cfg.rawOutputs.map(
    (o) => new UDPForwardOutput({ name: o.name, host: o.host, port: o.port, enabled: o.enabled }),
  );
  const rawChain = new RawOutputChain(rawOutputs);

  // Bus
  const bus = new TelemetryBus();

  // Server
  const server = new Server({ port: cfg.http.port, bus, log: childLogger(rootLog, "http") });

  // Plugin host
  const host = new PluginHost({
    plugins: moduleRegistry,
    moduleConfig: cfg.modules ?? {},
    bus,
    log: childLogger(rootLog, "plugin-host"),
    emit: (moduleId, channel, event, payload) => {
      if (channel === "events") server.emitEvent(moduleId, event, payload);
      // "admin"/"status" handled in PluginHost.makeContext
    },
    registerRoute: (moduleId, method, path, handler) => {
      server.registerModuleRoute(moduleId, method, path, handler);
    },
    unregisterRoutes: (moduleId) => server.unregisterModuleRoutes(moduleId),
    onStateChange: (state) => server.updateModuleState(state),
  });
  server.onEnable = (id) => host.enable(id);
  server.onDisable = (id) => host.disable(id);

  // Input
  const input = createInput(cfg);
  const inputLog = childLogger(rootLog, "input");

  await server.start();
  await host.start();
  await input.start((raw) => {
    rawChain.send(raw);
    try {
      const pkt = parseDashPacket(raw, Date.now());
      bus.publish(pkt);
    } catch (err) {
      inputLog.warn({ err, len: raw.length }, "parse error");
    }
  });

  log.info({ input: cfg.input.type, httpPort: cfg.http.port, modules: moduleRegistry.length }, "FSTS started");

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    log.info({ signal }, "shutting down");
    await input.stop();
    await host.stop();
    await rawChain.shutdown();
    await server.stop();
    rootLog.flush?.();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(3);
});
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: main entry wiring all core components together"
```

---

### Task 22: `config.example.jsonc`

**Files:**
- Create: `config.example.jsonc`

- [ ] **Step 1: Write the example config**

```jsonc
{
  // Forza UDP Data Out — configure FH5: Settings → HUD & Gameplay → Data Out → UDP, target 127.0.0.1:9999
  "input": {
    "type": "udp",
    "port": 9999
  },

  // Forward raw UDP packets to additional destinations. Default: all disabled.
  // Enable 'moza-pit-house' when you install Moza Pit House and configure it
  // to listen on the 'port' below.
  "rawOutputs": [
    { "name": "moza-pit-house", "type": "udp-forward", "host": "127.0.0.1", "port": 5300,  "enabled": false },
    { "name": "simhub",         "type": "udp-forward", "host": "127.0.0.1", "port": 22222, "enabled": false }
  ],

  "http": {
    "port": 5780
  },

  "logging": {
    "level": "info",
    "dir": "./logs",
    "pretty": true
  },

  "modules": {
    "backseat-speedometer": {
      "enabled": true,
      "config": { "defaultUnits": "mph" }
    },
    "redline-alert": {
      "enabled": true,
      "config": {
        "thresholdRatio": 0.96,
        "minDurationMs": 1200,
        "cooldownMs": 8000
      }
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add config.example.jsonc
git commit -m "feat: config.example.jsonc for first-run UX"
```

---

### Task 23: Launchers

**Files:**
- Create: `start-fsts.bat`
- Create: `stop-fsts.bat`

- [ ] **Step 1: Write `start-fsts.bat`**

```bat
@echo off
REM Starts FSTS in a named console window. Close the window to stop cleanly.
title FSTS
cd /d "%~dp0"
echo Starting FSTS...
call npm start
echo FSTS stopped.
pause
```

- [ ] **Step 2: Write `stop-fsts.bat`**

```bat
@echo off
REM Terminates any FSTS process started via start-fsts.bat by title.
taskkill /FI "WINDOWTITLE eq FSTS" /T /F
exit /b 0
```

- [ ] **Step 3: Commit**

```bash
git add start-fsts.bat stop-fsts.bat
git commit -m "feat: Windows bat-file launchers"
```

---

## Phase 9 — Integration Tests & Docs

### Task 24: Test fixture generator + integration smoke

Build a helper that synthesizes a `skateboard-smoke.fzt` fixture programmatically (no Forza needed), then write an end-to-end integration test that replays it through the full stack.

**Files:**
- Create: `test/fixtures/generate-smoke.ts`
- Create: `test/fixtures/skateboard-smoke.fzt` (generated)
- Create: `test/integration/skateboard.test.ts`

- [ ] **Step 1: Write the fixture generator**

```ts
// test/fixtures/generate-smoke.ts
// Run via: npx tsx test/fixtures/generate-smoke.ts
import { writeRecording } from "../../src/core/input/recordingFormat";
import { DASH_PACKET_SIZE } from "../../src/core/parser/PacketParser";
import { join } from "node:path";

function buildPacket(opts: {
  rpm: number; maxRpm: number; speed: number; gear: number; isRaceOn: boolean;
}): Buffer {
  const buf = Buffer.alloc(DASH_PACKET_SIZE);
  buf.writeInt32LE(opts.isRaceOn ? 1 : 0, 0);
  buf.writeUInt32LE(0, 4);
  buf.writeFloatLE(opts.maxRpm, 8);
  buf.writeFloatLE(opts.rpm, 16);
  buf.writeInt32LE(1, 212); // carOrdinal
  buf.writeInt32LE(3, 216); // carClass
  buf.writeInt32LE(1, 224); // drivetrain
  buf.writeFloatLE(opts.speed, 244);
  buf.writeUInt8(opts.gear, 307);
  return buf;
}

const entries: { relativeMs: number; packet: Buffer }[] = [];

// Phase 1: 500ms warmup, low RPM
for (let t = 0; t < 500; t += 16) {
  entries.push({
    relativeMs: t,
    packet: buildPacket({ rpm: 2000, maxRpm: 7500, speed: 20, gear: 2, isRaceOn: true }),
  });
}
// Phase 2: sustained redline for 1500ms (should trigger Redline Alert at default 1200ms threshold)
for (let t = 500; t < 2000; t += 16) {
  entries.push({
    relativeMs: t,
    packet: buildPacket({ rpm: 7400, maxRpm: 7500, speed: 80, gear: 5, isRaceOn: true }),
  });
}
// Phase 3: 500ms cooldown
for (let t = 2000; t < 2500; t += 16) {
  entries.push({
    relativeMs: t,
    packet: buildPacket({ rpm: 5000, maxRpm: 7500, speed: 60, gear: 4, isRaceOn: true }),
  });
}

const outPath = join(__dirname, "skateboard-smoke.fzt");
writeRecording(outPath, entries);
console.log(`Wrote ${entries.length} packets to ${outPath}`);
```

- [ ] **Step 2: Generate the fixture**

Run: `npx tsx test/fixtures/generate-smoke.ts`
Expected: "Wrote N packets to .../skateboard-smoke.fzt"

- [ ] **Step 3: Make `src/index.ts` honor `FSTS_CONFIG_PATH` (needed so tests can point it at a temp config without changing CWD)**

Edit `src/index.ts`. Replace:

```ts
const CONFIG_PATH = "./config.jsonc";
const EXAMPLE_PATH = "./config.example.jsonc";
```

with:

```ts
const CONFIG_PATH = process.env.FSTS_CONFIG_PATH ?? "./config.jsonc";
const EXAMPLE_PATH = process.env.FSTS_EXAMPLE_PATH ?? "./config.example.jsonc";
```

- [ ] **Step 4: Write the integration test**

```ts
// test/integration/skateboard.test.ts
import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import WebSocket from "ws";

const ROOT = resolve(__dirname, "../..");

function makeConfig(httpPort: number, fixturePath: string): string {
  return JSON.stringify({
    input: { type: "mock", file: fixturePath, loop: false, speed: 20.0 },
    rawOutputs: [],
    http: { port: httpPort },
    logging: { level: "error", dir: "./logs", pretty: false },
    modules: {
      "backseat-speedometer": { enabled: true, config: { defaultUnits: "mph" } },
      "redline-alert": {
        enabled: true,
        config: { thresholdRatio: 0.96, minDurationMs: 1200, cooldownMs: 8000 },
      },
    },
  });
}

async function waitFor<T>(fn: () => Promise<T>, timeoutMs: number): Promise<T> {
  const start = Date.now();
  let lastErr: unknown;
  while (Date.now() - start < timeoutMs) {
    try { return await fn(); } catch (err) { lastErr = err; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw lastErr;
}

describe("Skateboard integration", () => {
  it("boots, replays fixture, validates both pull and push paths", async () => {
    const httpPort = 15780 + Math.floor(Math.random() * 1000);
    const tmp = mkdtempSync(join(tmpdir(), "fsts-int-"));
    const fixture = resolve(ROOT, "test/fixtures/skateboard-smoke.fzt");
    const cfgPath = join(tmp, "config.jsonc");
    writeFileSync(cfgPath, makeConfig(httpPort, fixture));

    // Spawn FSTS pointed at the temp config via env vars (no cwd gymnastics)
    const child = spawn("npx", ["tsx", resolve(ROOT, "src/index.ts")], {
      cwd: ROOT,
      env: { ...process.env, FSTS_CONFIG_PATH: cfgPath, FSTS_EXAMPLE_PATH: cfgPath },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stderr?.on("data", (d) => console.error("[fsts-stderr]", d.toString()));

    try {
      // Wait for /health to come up
      await waitFor(async () => {
        const res = await fetch(`http://127.0.0.1:${httpPort}/health`);
        if (res.status !== 200) throw new Error(`status ${res.status}`);
      }, 5000);

      // Subscribe to /events before replay finishes
      const events: unknown[] = [];
      const ws = new WebSocket(`ws://127.0.0.1:${httpPort}/events`);
      await new Promise((r) => ws.on("open", r));
      ws.on("message", (d) => events.push(JSON.parse(d.toString())));

      // Let MockInput at 20x speed finish (2500ms / 20 = 125ms; buffer generously)
      await new Promise((r) => setTimeout(r, 500));

      // PUSH PATH: Redline Alert fired at least once during the redline segment
      const redlineEvents = events.filter(
        (e) => (e as { source?: string }).source === "redline-alert",
      );
      expect(redlineEvents.length).toBeGreaterThanOrEqual(1);

      // PULL PATH: backseat-speedometer endpoint responds with formatted payload
      const res = await fetch(
        `http://127.0.0.1:${httpPort}/modules/backseat-speedometer/latest?units=mph`,
      );
      expect(res.status).toBe(200);
      const body = await res.json() as { formatted: { speed: number; units: string } };
      expect(body.formatted.units).toBe("mph");

      // Module registry is exposed
      const modulesRes = await fetch(`http://127.0.0.1:${httpPort}/modules`);
      const modulesList = await modulesRes.json() as { id: string; status: string }[];
      expect(modulesList.find((m) => m.id === "redline-alert")?.status).toBe("running");

      // Admin toggle disable works
      await fetch(`http://127.0.0.1:${httpPort}/modules/redline-alert/disable`, { method: "POST" });
      const modulesRes2 = await fetch(`http://127.0.0.1:${httpPort}/modules`);
      const modulesList2 = await modulesRes2.json() as { id: string; enabled: boolean }[];
      expect(modulesList2.find((m) => m.id === "redline-alert")?.enabled).toBe(false);

      ws.close();
    } finally {
      child.kill();
      await new Promise((r) => setTimeout(r, 200));
    }
  }, 15_000);
});
```

- [ ] **Step 5: Run integration test**

Run: `npx vitest run test/integration/skateboard.test.ts`
Expected: 1 test passes.

- [ ] **Step 6: Commit**

```bash
git add test/fixtures/generate-smoke.ts test/fixtures/skateboard-smoke.fzt test/integration/skateboard.test.ts src/index.ts
git commit -m "feat: integration test exercising pull and push paths end-to-end"
```

---

### Task 25: Full test suite + typecheck pass

- [ ] **Step 1: Run the whole test suite**

Run: `npm test`
Expected: all tests pass (unit + integration).

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: If any fail** — investigate and fix; do not proceed until both are green.

---

### Task 26: `TESTING.md` manual smoke-test checklist

**Files:**
- Create: `TESTING.md`

- [ ] **Step 1: Write the checklist**

```markdown
# FSTS — Manual Smoke Test

Run this checklist before declaring Skateboard complete.

## Pre-flight

- [ ] `npm install` succeeds
- [ ] `npm test` all green
- [ ] `npm run typecheck` clean

## Startup

- [ ] Delete (or rename) your `config.jsonc`, run `start-fsts.bat` — FSTS copies `config.example.jsonc` → `config.jsonc` and exits with a clear message
- [ ] Run `start-fsts.bat` again — FSTS starts, log shows "FSTS started" with input type, http port, module count
- [ ] Open `http://localhost:5780/hub` — Admin Panel loads, module list shows Backseat Speedometer and Redline Alert
- [ ] Open `http://localhost:5780/health` — returns `{"status":"ok", ...}`

## With Forza running (Data Out configured to 127.0.0.1:9999)

- [ ] Drive for 60 seconds; `/health` packet count increments into the thousands
- [ ] `/telemetry/latest` returns a full packet with your current speed, RPM, gear
- [ ] `/modules/backseat-speedometer/latest?units=mph` returns `formatted.speed` within ±1mph of what the game shows

## Push path

- [ ] Hold redline for >1.2 seconds — Streamer.bot WS Client (or a `wscat ws://localhost:5780/events` session) receives a `{"source":"redline-alert","event":"triggered",...}` message
- [ ] Immediately hold redline again — no duplicate event within 8 seconds (cooldown working)
- [ ] Short taps of redline (<1s) — no event fired

## Admin Panel toggles

- [ ] Uncheck "Redline Alert" in Admin Panel — `/modules` shows `enabled: false`, no more events fire even while redlining
- [ ] Re-check — events resume firing when condition met

## Raw forwarder

- [ ] Edit `config.jsonc`, set `moza-pit-house` raw output `enabled: true` with `port: 55555`; restart FSTS
- [ ] In another terminal: `ncat -ul 127.0.0.1 55555 --recv-only -v | od -An -tx1 -w16 | head -5`
- [ ] Drive in Forza — netcat prints hex-dumped packets matching Forza's UDP output format

## MockInput

- [ ] Edit `config.jsonc` to use `"input": {"type":"mock","file":"./test/fixtures/skateboard-smoke.fzt","loop":true,"speed":1.0}`; restart FSTS
- [ ] `/telemetry/latest` updates even though Forza isn't running
- [ ] Redline Alert fires during the redline segment of the replay

## Shutdown

- [ ] Close the FSTS console window (or run `stop-fsts.bat`) — process exits cleanly, no stuck UDP binding (`netstat -an | findstr :9999` is empty)
```

- [ ] **Step 2: Commit**

```bash
git add TESTING.md
git commit -m "docs: manual smoke-test checklist"
```

---

### Task 27: README update

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Read current README**

Run: view `README.md` (it currently contains: `# FSTS\nForza Telemetry Suite\n`).

- [ ] **Step 2: Rewrite README**

Content:

```markdown
# FSTS — Forza Stream Telemetry Suite

A single TypeScript/Node process that receives Forza Horizon UDP telemetry, parses it, and fans the data out to stream-facing consumers: OBS browser-source overlays, Streamer.bot chat commands and alerts, and (optionally) downstream sim racing software like Moza Pit House or SimHub.

Modules plug in via a unified `Plugin` contract and can be toggled on and off at runtime from a browser-based Admin Panel. The listener itself is Twitch-agnostic; Streamer.bot (or whatever else you point at it) handles the Twitch side.

**Status:** Skateboard phase — core listener, plugin system, Admin Panel, raw UDP forwarder, two validator modules. Bicycle (overlays) and Car (persistence, history, hardware) are captured in the spec for future phases.

## Requirements

- Windows (launchers are `.bat`; rest is cross-platform)
- Node.js 20 or newer
- Forza Horizon 5 (FM7, FH4 also work with the Dash packet format)

## Quick start

```
git clone <repo>
cd FSTS
npm install
# First run will create config.jsonc from config.example.jsonc and exit:
npm start
# Edit config.jsonc if needed (default UDP port 9999, HTTP port 5780)
start-fsts.bat
```

Configure Forza: Settings → HUD & Gameplay → Data Out → UDP, target `127.0.0.1:9999`, format "Dash".

Open `http://localhost:5780/hub` to see the Admin Panel.

## Validator modules

- **Backseat Speedometer** — `GET /modules/backseat-speedometer/latest?units=mph|kph` returns formatted current speed/gear/RPM for chat-command replies via Streamer.bot.
- **Redline Alert** — sustained near-max RPM emits a `triggered` event on `ws://localhost:5780/events`; point Streamer.bot's WebSocket Client at it to play sounds and send chat messages.

## Documentation

- Spec: [`docs/superpowers/specs/2026-04-18-stream-telemetry-suite-design.md`](docs/superpowers/specs/2026-04-18-stream-telemetry-suite-design.md)
- Manual smoke test: [`TESTING.md`](TESTING.md)

## Development

```
npm test          # full test suite (Vitest)
npm run typecheck # tsc --noEmit
npm run dev       # tsx watch src/index.ts
```

## Roadmap

- **Bicycle:** OBS browser-source overlays (G-Force Meter, Near Death Counter, Smooth Brain)
- **Car:** SQLite persistence (Session Stats, Car Report Card), StreamDeck plugin, Moza hardware integration activation

---

## Support

[Buy me a coffee on Ko-fi](http://ko-fi.com/ktulue)

Created by Ktulue | The Water Father
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: comprehensive README with quick-start and roadmap"
```

---

## Phase 10 — Self-Check

### Task 28: Verify Skateboard acceptance criteria

Walk through `docs/superpowers/specs/2026-04-18-stream-telemetry-suite-design.md` §9 and check each item.

- [ ] **Step 1: Infrastructure criteria**
  - `start-fsts.bat` launches, Admin Panel reachable → manual verify
  - `stop-fsts.bat` clean shutdown → manual verify
  - Missing `config.jsonc` auto-copies example → manual verify
  - Invalid config fails startup with schema error → manual verify (corrupt config.jsonc, run, observe)

- [ ] **Step 2: Core data path criteria**
  - `DirectUDPInput` receives from Forza → manual verify
  - `MockInput` parity with `DirectUDPInput` → covered by integration test
  - `/telemetry/latest` → covered by Server tests
  - `/telemetry` WS broadcast → covered by Server tests
  - `/events` WS broadcast → covered by Server + integration test

- [ ] **Step 3: Plugin system criteria**
  - Both modules appear in Admin Panel → covered by integration test (`/modules`)
  - Toggles in <500ms → manual verify
  - 5 errors in 10s auto-disable → covered by PluginHost tests
  - Disabled module HTTP → 503 → covered by Server test
  - Per-module config slicing → covered by PluginHost tests

- [ ] **Step 4: Raw forwarder criteria**
  - `udp-forward` delivers bytes → covered by UDPForwardOutput test
  - Disabling all raw outputs → zero hot-path cost (inspect `RawOutputChain.send`, no sockets opened when array is empty)
  - Unreachable target logs but doesn't block → manual verify (set enabled with invalid host)

- [ ] **Step 5: Validator paths**
  - Pull path validated → integration test
  - Push path validated → integration test

- [ ] **Step 6: Report any gaps**
  If a criterion is unmet, open it as a new task and address it before considering Skateboard done.

---

## Summary of deliverables

When every task above is checked, you will have:

- Working TypeScript project with `npm start` / `npm test` / `npm run typecheck`
- `DirectUDPInput` + `MockInput` + recording format
- `PacketParser` for FH5 Dash format
- `TelemetryBus` pub/sub with last-packet cache
- `RawOutputChain` with `UDPForwardOutput` — generic forwarder, Moza Pit House ready
- Full plugin system: `Plugin` interface, `PluginHost`, lifecycle, config slicing, crash isolation, auto-disable
- `Server` with `/health`, `/telemetry/latest`, `/modules`, `/modules/:id/{enable,disable}`, `/telemetry` WS, `/events` WS, `/admin` WS, module-registered route dispatch with 503 gating
- Admin Panel served from `/hub`, live-updating via `/admin` WS
- Two validator modules proving both architectural paths
- Windows launchers (`start-fsts.bat`, `stop-fsts.bat`)
- Integration test exercising pull and push paths end-to-end
- Manual smoke-test checklist
- User-facing README

**Spec coverage:** every Section 9 acceptance criterion is either covered by automated tests or listed as a manual verification item in `TESTING.md`.
