// src/core/raw-outputs/RawOutput.ts
export interface RawOutputStats {
  sent: number;
  errors: number;
  lastError: string | null;
}

export interface RawOutput {
  readonly name: string;
  enabled: boolean;
  /** Fire-and-forget. Must not throw. Errors increment the error counter. */
  send(raw: Buffer): void;
  stats(): RawOutputStats;
  shutdown(): Promise<void>;
}
