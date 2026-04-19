// scripts/inspect.ts
// Pretty-prints parsed packets from a .fzt recording so you can compare against
// what Forza was showing on screen.
// Usage:
//   npm run inspect -- my-drive.fzt
//   npm run inspect -- my-drive.fzt --every 30        (sample every 30th packet)
//   npm run inspect -- my-drive.fzt --limit 20        (cap output rows)
//   npm run inspect -- my-drive.fzt --json            (raw JSON dump instead of table)
import { readRecording } from "../src/core/input/recordingFormat.js";
import { parseDashPacket } from "../src/core/parser/PacketParser.js";
import { resolve } from "node:path";

interface Args {
  file: string;
  every: number;
  limit: number;
  json: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { file: "", every: 1, limit: 0, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--every") args.every = Math.max(1, Number(argv[++i]));
    else if (a === "--limit") args.limit = Number(argv[++i]);
    else if (a === "--json") args.json = true;
    else if (a === "--help" || a === "-h") {
      console.log("Usage: npm run inspect -- <file.fzt> [--every N] [--limit N] [--json]");
      process.exit(0);
    } else if (!args.file && !a!.startsWith("--")) {
      args.file = a!;
    }
  }
  if (!args.file) {
    console.error("Missing recording file path. Try: npm run inspect -- my-drive.fzt");
    process.exit(1);
  }
  return args;
}

const CAR_CLASS = ["D", "C", "B", "A", "S", "R", "P", "X"];
const DRIVETRAIN = ["FWD", "RWD", "AWD"];

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const filePath = resolve(args.file);
  const entries = readRecording(filePath);
  if (entries.length === 0) {
    console.error("Recording is empty.");
    process.exit(1);
  }

  console.log(`File:     ${filePath}`);
  console.log(`Packets:  ${entries.length}`);
  const totalMs = entries[entries.length - 1]!.relativeMs;
  console.log(`Duration: ${(totalMs / 1000).toFixed(1)}s`);
  const avgHz = entries.length / Math.max(0.001, totalMs / 1000);
  console.log(`Rate:     ${avgHz.toFixed(1)} Hz (avg)`);
  console.log("");

  const sampled = entries.filter((_, i) => i % args.every === 0);
  const limited = args.limit > 0 ? sampled.slice(0, args.limit) : sampled;

  if (args.json) {
    for (const e of limited) {
      const pkt = parseDashPacket(e.packet, e.relativeMs);
      console.log(JSON.stringify({ relativeMs: e.relativeMs, ...pkt }));
    }
    return;
  }

  // Tabular: time, race, mph, kph, gear, rpm/max, ratio, lat-G, long-G, car class, drivetrain
  const rows = limited.map((e) => {
    const p = parseDashPacket(e.packet, e.relativeMs);
    return {
      "t(s)":   (e.relativeMs / 1000).toFixed(2),
      race:     p.isRaceOn ? "Y" : "N",
      mph:      (p.speed * 2.2369362921).toFixed(1),
      kph:      (p.speed * 3.6).toFixed(1),
      gear:     p.gear,
      rpm:      Math.round(p.rpm),
      maxRpm:   Math.round(p.maxRpm),
      ratio:    p.maxRpm > 0 ? (p.rpm / p.maxRpm).toFixed(3) : "-",
      "latG":   p.accelLateral.toFixed(2),
      "longG":  p.accelLongitudinal.toFixed(2),
      class:    CAR_CLASS[p.carClass] ?? `?${p.carClass}`,
      drive:    DRIVETRAIN[p.drivetrainType] ?? `?${p.drivetrainType}`,
      ordinal:  p.carOrdinal,
    };
  });
  console.table(rows);
  console.log(`(showed ${limited.length} of ${entries.length} packets; --every ${args.every}, --limit ${args.limit || "none"})`);
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(2);
});
