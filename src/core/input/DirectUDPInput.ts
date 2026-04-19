// src/core/input/DirectUDPInput.ts
import { createSocket, Socket } from "node:dgram";
import type { InputSource, PacketHandler } from "./InputSource.js";

export interface DirectUDPInputConfig {
  port: number;
  host?: string; // default 0.0.0.0
}

export class DirectUDPInput implements InputSource {
  readonly name = "udp";
  private socket: Socket | null = null;
  private cfg: DirectUDPInputConfig;

  constructor(cfg: DirectUDPInputConfig) {
    this.cfg = cfg;
  }

  async start(onPacket: PacketHandler): Promise<void> {
    this.socket = createSocket({ type: "udp4", reuseAddr: true });
    this.socket.on("message", (raw) => onPacket(raw));
    await new Promise<void>((resolve, reject) => {
      this.socket!.once("error", reject);
      this.socket!.bind(this.cfg.port, this.cfg.host ?? "0.0.0.0", () => resolve());
    });
  }

  async stop(): Promise<void> {
    if (!this.socket) return;
    await new Promise<void>((resolve) => this.socket!.close(() => resolve()));
    this.socket = null;
  }

  /** Returns the actual bound port (useful when started with port=0). */
  port(): number {
    return this.socket?.address().port ?? 0;
  }
}
