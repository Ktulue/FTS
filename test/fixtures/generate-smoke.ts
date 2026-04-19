// test/fixtures/generate-smoke.ts
// Run via: npx tsx test/fixtures/generate-smoke.ts
import { writeRecording } from "../../src/core/input/recordingFormat.js";
import { DASH_PACKET_SIZE } from "../../src/core/parser/PacketParser.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

function buildPacket(opts: {
  rpm: number; maxRpm: number; speed: number; gear: number; isRaceOn: boolean;
}): Buffer {
  const buf = Buffer.alloc(DASH_PACKET_SIZE);
  buf.writeInt32LE(opts.isRaceOn ? 1 : 0, 0);
  buf.writeUInt32LE(0, 4);
  buf.writeFloatLE(opts.maxRpm, 8);
  buf.writeFloatLE(opts.rpm, 16);
  buf.writeInt32LE(1, 212); // carOrdinal
  buf.writeInt32LE(3, 216); // carClass
  buf.writeInt32LE(1, 224); // drivetrain
  buf.writeFloatLE(opts.speed, 244);
  buf.writeUInt8(opts.gear, 307);
  return buf;
}

const entries: { relativeMs: number; packet: Buffer }[] = [];

// Phase 1: 500ms warmup, low RPM
for (let t = 0; t < 500; t += 16) {
  entries.push({
    relativeMs: t,
    packet: buildPacket({ rpm: 2000, maxRpm: 7500, speed: 20, gear: 2, isRaceOn: true }),
  });
}
// Phase 2: sustained redline for 1500ms (should trigger Redline Alert at default 1200ms threshold)
for (let t = 500; t < 2000; t += 16) {
  entries.push({
    relativeMs: t,
    packet: buildPacket({ rpm: 7400, maxRpm: 7500, speed: 80, gear: 5, isRaceOn: true }),
  });
}
// Phase 3: 500ms cooldown
for (let t = 2000; t < 2500; t += 16) {
  entries.push({
    relativeMs: t,
    packet: buildPacket({ rpm: 5000, maxRpm: 7500, speed: 60, gear: 4, isRaceOn: true }),
  });
}

const outPath = join(__dirname, "skateboard-smoke.fzt");
writeRecording(outPath, entries);
console.log(`Wrote ${entries.length} packets to ${outPath}`);
