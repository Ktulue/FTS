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
