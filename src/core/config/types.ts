// src/core/config/types.ts
export interface UDPInputConfig {
  type: "udp";
  port: number;
  host?: string;
}

export interface MockInputConfig {
  type: "mock";
  file: string;
  loop?: boolean;
  speed?: number;
}

export type InputConfig = UDPInputConfig | MockInputConfig;

export interface UDPForwardConfigEntry {
  name: string;
  type: "udp-forward";
  host: string;
  port: number;
  enabled: boolean;
}

export type RawOutputConfig = UDPForwardConfigEntry;

export interface HttpConfig {
  port: number;
}

export interface LoggingConfig {
  level: "trace" | "debug" | "info" | "warn" | "error";
  dir: string;
  pretty?: boolean;
}

export interface ModuleEntryConfig {
  enabled: boolean;
  config?: unknown;
}

export interface FstsConfig {
  input: InputConfig;
  rawOutputs: RawOutputConfig[];
  http: HttpConfig;
  logging: LoggingConfig;
  modules: Record<string, ModuleEntryConfig>;
}
