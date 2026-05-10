import type { TelemetryPacket } from "../TelemetryPacket.js";
import type { ForzaDashParser } from "./ForzaDashParser.js";

const DASH_PACKET_SIZE = 324;

export const fh5DashParser: ForzaDashParser = {
  id: "fh5",
  minPacketSize: DASH_PACKET_SIZE,
  parse(buf: Buffer, receiveTimestamp: number): TelemetryPacket {
    if (buf.length < DASH_PACKET_SIZE) {
      throw new Error(
        `Invalid packet size: got ${buf.length}, expected at least ${DASH_PACKET_SIZE}`,
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
      steer: Math.max(-1, Math.min(1, buf.readInt8(308) / 127)),
      throttle: buf.readUInt8(303) / 255,
      brake: buf.readUInt8(304) / 255,
      clutch: buf.readUInt8(305) / 255,
      handbrake: buf.readUInt8(306) / 255,
    };
  },
};
