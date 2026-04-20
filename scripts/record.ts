// scripts/record.ts
// Captures live Forza UDP telemetry to a .fzt recording for later inspection/replay.
// Usage:
//   npm run record -- --port 9999 --out my-drive.fzt --duration 30
//   npm run record -- --out forever.fzt   (no duration -> records until Ctrl+C)
import { DirectUDPInput } from "../src/core/input/DirectUDPInput.js";
import { writeRecording, type RecordingEntry } from "../src/core/input/recordingFormat.js";
import { resolve } from "node:path";

interface Args {
  port: number;
  out: string;
  duration: number; // seconds; 0 = until SIGINT
}

function parseArgs(argv: string[]): Args {
  const args: Args = { port: 9999, out: "", duration: 30 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--port") args.port = Number(argv[++i]);
    else if (a === "--out") args.out = argv[++i]!;
    else if (a === "--duration") args.duration = Number(argv[++i]);
    else if (a === "--help" || a === "-h") {
      console.log("Usage: npm run record -- --port <p> --out <file.fzt> [--duration <seconds>]");
      process.exit(0);
    }
  }
  if (!args.out) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    args.out = `recording-${stamp}.fzt`;
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const outPath = resolve(args.out);

  const entries: RecordingEntry[] = [];
  const input = new DirectUDPInput({ port: args.port });
  let startMs = 0;

  await input.start((raw) => {
    const now = Date.now();
    if (entries.length === 0) startMs = now;
    entries.push({
      relativeMs: now - startMs,
      packet: Buffer.from(raw),
    });
  });

  const durationMsg = args.duration > 0 ? `for ${args.duration}s` : "until Ctrl+C";
  console.log(`Recording UDP :${args.port} -> ${outPath} ${durationMsg}`);

  const reportTimer = setInterval(() => {
    console.log(`  ${entries.length} packets`);
  }, 5000);

  const finish = async (reason: string) => {
    clearInterval(reportTimer);
    await input.stop();
    if (entries.length === 0) {
      console.error(`No packets received. Is Forza running with Data Out -> UDP -> 127.0.0.1:${args.port}?`);
      process.exit(1);
    }
    writeRecording(outPath, entries);
    const lastMs = entries[entries.length - 1]!.relativeMs;
    console.log(`Done (${reason}): wrote ${entries.length} packets spanning ${(lastMs / 1000).toFixed(1)}s -> ${outPath}`);
    process.exit(0);
  };

  if (args.duration > 0) {
    setTimeout(() => void finish("timeout"), args.duration * 1000);
  }
  process.on("SIGINT", () => void finish("SIGINT"));
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(2);
});
