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
