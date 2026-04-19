// src/core/input/MockInput.ts
import type { InputSource, PacketHandler } from "./InputSource.js";
import { readRecording, type RecordingEntry } from "./recordingFormat.js";

export interface MockInputConfig {
  file: string;
  loop?: boolean;   // default false
  speed?: number;   // default 1.0 (real-time); 2.0 = 2x faster
}

export class MockInput implements InputSource {
  readonly name = "mock";
  private cfg: MockInputConfig;
  private entries: RecordingEntry[] = [];
  private stopped = false;
  private pending: ReturnType<typeof setTimeout> | null = null;

  constructor(cfg: MockInputConfig) {
    this.cfg = cfg;
  }

  async start(onPacket: PacketHandler): Promise<void> {
    this.entries = readRecording(this.cfg.file);
    this.stopped = false;
    this.playOnce(onPacket, 0);
  }

  private playOnce(onPacket: PacketHandler, iterationStartMs: number): void {
    if (this.entries.length === 0) return;
    const speed = this.cfg.speed ?? 1.0;
    const startWall = Date.now();
    let idx = 0;

    const schedule = () => {
      if (this.stopped) return;
      if (idx >= this.entries.length) {
        if (this.cfg.loop) {
          this.playOnce(onPacket, iterationStartMs + this.entries[this.entries.length - 1]!.relativeMs);
        }
        return;
      }
      const e = this.entries[idx]!;
      const targetWall = startWall + e.relativeMs / speed;
      const delay = Math.max(0, targetWall - Date.now());
      this.pending = setTimeout(() => {
        if (this.stopped) return;
        onPacket(e.packet);
        idx++;
        schedule();
      }, delay);
    };

    schedule();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.pending) {
      clearTimeout(this.pending);
      this.pending = null;
    }
  }
}
