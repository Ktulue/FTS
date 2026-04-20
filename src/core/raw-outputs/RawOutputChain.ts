// src/core/raw-outputs/RawOutputChain.ts
import type { RawOutput } from "./RawOutput.js";

export class RawOutputChain {
  constructor(private outputs: RawOutput[]) {}

  send(raw: Buffer): void {
    for (const out of this.outputs) {
      try {
        out.send(raw);
      } catch {
        // RawOutput.send is documented fire-and-forget + must-not-throw.
        // A buggy implementation throwing is still not allowed to break
        // the hot path.
      }
    }
  }

  async shutdown(): Promise<void> {
    await Promise.all(this.outputs.map((o) => o.shutdown()));
  }

  all(): ReadonlyArray<RawOutput> {
    return this.outputs;
  }
}
