// src/core/plugin-host/PluginHost.test.ts
import { describe, it, expect, vi } from "vitest";
import { PluginHost } from "./PluginHost.js";
import type { Plugin } from "./Plugin.js";
import { TelemetryBus } from "../bus/TelemetryBus.js";
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
