// src/core/logging/logger.ts
import pino, { type Logger, type LoggerOptions } from "pino";

export type { Logger } from "pino";

export interface LoggerConfig {
  level: "trace" | "debug" | "info" | "warn" | "error";
  pretty: boolean;
}

export function createRootLogger(cfg: LoggerConfig): Logger {
  const opts: LoggerOptions = {
    level: cfg.level,
    base: { pid: process.pid },
    timestamp: pino.stdTimeFunctions.isoTime,
  };
  if (cfg.pretty) {
    return pino({
      ...opts,
      transport: {
        target: "pino-pretty",
        options: { colorize: true, translateTime: "HH:MM:ss.l" },
      },
    });
  }
  return pino(opts);
}

export function childLogger(parent: Logger, module: string): Logger {
  return parent.child({ module });
}
