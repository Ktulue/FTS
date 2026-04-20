// src/core/bus/TelemetryBus.ts
import type { TelemetryPacket } from "../parser/TelemetryPacket.js";

export type TelemetryHandler = (pkt: TelemetryPacket) => void;

export class TelemetryBus {
  private handlers = new Set<TelemetryHandler>();
  private _last: TelemetryPacket | null = null;

  subscribe(handler: TelemetryHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  publish(pkt: TelemetryPacket): void {
    this._last = pkt;
    for (const h of this.handlers) h(pkt);
  }

  lastPacket(): TelemetryPacket | null {
    return this._last;
  }
}
