// src/modules/redline-alert/plugin.test.ts
import { describe, it, expect, vi } from "vitest";
import { redlineAlert } from "./plugin.js";
import pino from "pino";
import type { TelemetryPacket } from "../../core/parser/TelemetryPacket.js";

function pkt(rpm: number, maxRpm: number, timestamp: number, isRaceOn = true): TelemetryPacket {
  return {
    timestamp, isRaceOn, speed: 50, rpm, maxRpm, gear: 3,
    accelLateral: 0, accelLongitudinal: 0,
    tireSlipRatio: { fl: 0, fr: 0, rl: 0, rr: 0 },
    carOrdinal: 1, carClass: 0, drivetrainType: 0,
    steer: 0, throttle: 0, brake: 0, clutch: 0, handbrake: 0,
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

  it("emits on sustained redline (>= minDurationMs)", async () => {
    const { ctx, emit } = mockCtx();
    await redlineAlert.onStart(ctx as never);
    redlineAlert.onTelemetry!(pkt(7400, 7500, 0), ctx as never);
    redlineAlert.onTelemetry!(pkt(7400, 7500, 1250), ctx as never); // 1250ms >= 1200ms threshold
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
