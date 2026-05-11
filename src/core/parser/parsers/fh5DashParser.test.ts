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
});
