// src/core/http/Server.test.ts
import { describe, it, expect } from "vitest";
import { Server } from "./Server.js";
import { TelemetryBus } from "../bus/TelemetryBus.js";
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
