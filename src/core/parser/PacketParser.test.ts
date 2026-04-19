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
