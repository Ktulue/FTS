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
