// src/core/parser/PacketParser.ts
import type { TelemetryPacket } from "./TelemetryPacket.js";

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
