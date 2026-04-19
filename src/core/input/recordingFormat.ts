// src/core/input/recordingFormat.ts
import { writeFileSync, readFileSync } from "node:fs";

export interface RecordingEntry {
  relativeMs: number;
  packet: Buffer;
}

export function writeRecording(filePath: string, entries: RecordingEntry[]): void {
  const chunks: Buffer[] = [];
  for (const e of entries) {
    const header = Buffer.alloc(6);
    header.writeUInt32LE(e.relativeMs, 0);
    header.writeUInt16LE(e.packet.length, 4);
    chunks.push(header, e.packet);
  }
  writeFileSync(filePath, Buffer.concat(chunks));
}

export function readRecording(filePath: string): RecordingEntry[] {
  const buf = readFileSync(filePath);
  const entries: RecordingEntry[] = [];
  let off = 0;
  while (off + 6 <= buf.length) {
    const relativeMs = buf.readUInt32LE(off);
    const pktLen = buf.readUInt16LE(off + 4);
    if (off + 6 + pktLen > buf.length) {
      throw new Error(`Truncated recording at offset ${off}`);
    }
    const packet = Buffer.from(buf.subarray(off + 6, off + 6 + pktLen));
    entries.push({ relativeMs, packet });
    off += 6 + pktLen;
  }
  return entries;
}
