// src/core/raw-outputs/UDPForwardOutput.ts
import { createSocket, Socket } from "node:dgram";
import type { RawOutput, RawOutputStats } from "./RawOutput.js";

export interface UDPForwardOutputConfig {
  name: string;
  host: string;
  port: number;
  enabled: boolean;
}

export class UDPForwardOutput implements RawOutput {
  readonly name: string;
  enabled: boolean;
  private socket: Socket;
  private _stats: RawOutputStats = { sent: 0, errors: 0, lastError: null };
  private cfg: UDPForwardOutputConfig;

  constructor(cfg: UDPForwardOutputConfig) {
    this.cfg = cfg;
    this.name = cfg.name;
    this.enabled = cfg.enabled;
    this.socket = createSocket("udp4");
    this.socket.on("error", (err) => {
      this._stats.errors++;
      this._stats.lastError = err.message;
    });
  }

  send(raw: Buffer): void {
    if (!this.enabled) return;
    this.socket.send(raw, this.cfg.port, this.cfg.host, (err) => {
      if (err) {
        this._stats.errors++;
        this._stats.lastError = err.message;
      } else {
        this._stats.sent++;
      }
    });
  }

  stats(): RawOutputStats {
    return { ...this._stats };
  }

  async shutdown(): Promise<void> {
    await new Promise<void>((resolve) => this.socket.close(() => resolve()));
  }
}
