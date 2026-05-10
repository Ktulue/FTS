import type { TelemetryPacket } from "../TelemetryPacket.js";

export interface ForzaDashParser {
  readonly id: "fh5" | "fh6";
  readonly minPacketSize: number;
  parse(buf: Buffer, receiveTimestamp: number): TelemetryPacket;
}
