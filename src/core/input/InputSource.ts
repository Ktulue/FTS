// src/core/input/InputSource.ts
export type PacketHandler = (raw: Buffer) => void;

export interface InputSource {
  readonly name: string;
  start(onPacket: PacketHandler): Promise<void>;
  stop(): Promise<void>;
}
