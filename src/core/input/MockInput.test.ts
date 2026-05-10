// src/core/input/MockInput.test.ts
import { describe, it, expect } from "vitest";
import { MockInput } from "./MockInput.js";
import { writeRecording } from "./recordingFormat.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

function tempRecordingPath(): string {
  return join(tmpdir(), `fts-test-${randomBytes(4).toString("hex")}.fzt`);
}

describe("MockInput", () => {
  it("replays recorded packets in order", async () => {
    const path = tempRecordingPath();
    writeRecording(path, [
      { relativeMs: 0,  packet: Buffer.from([1, 2, 3]) },
      { relativeMs: 10, packet: Buffer.from([4, 5, 6]) },
      { relativeMs: 20, packet: Buffer.from([7, 8, 9]) },
    ]);

    const input = new MockInput({ file: path, loop: false, speed: 100.0 }); // 100x = near-instant
    const got: Buffer[] = [];
    await input.start((raw) => got.push(raw));

    // Wait for playback to finish (20ms / 100 = 0.2ms, give generous buffer)
    await new Promise((r) => setTimeout(r, 100));
    await input.stop();

    expect(got.length).toBe(3);
    expect(got[0]!.equals(Buffer.from([1, 2, 3]))).toBe(true);
    expect(got[2]!.equals(Buffer.from([7, 8, 9]))).toBe(true);
  });

  it("loops when loop: true", async () => {
    const path = tempRecordingPath();
    writeRecording(path, [{ relativeMs: 0, packet: Buffer.from([0xaa]) }]);

    const input = new MockInput({ file: path, loop: true, speed: 1000.0 });
    const got: Buffer[] = [];
    await input.start((raw) => got.push(raw));
    await new Promise((r) => setTimeout(r, 50));
    await input.stop();

    expect(got.length).toBeGreaterThan(1);
  });
});
