// src/core/config/loadConfig.ts
import { readFileSync } from "node:fs";
import { parse as parseJsonc, printParseErrorCode } from "jsonc-parser";
import { Ajv, type ErrorObject } from "ajv";
import { coreConfigSchema } from "./schema.js";
import type { FtsConfig } from "./types.js";

export class ConfigValidationError extends Error {
  constructor(message: string, public readonly details: ErrorObject[] = []) {
    super(message);
    this.name = "ConfigValidationError";
  }
}

const ajv = new Ajv({ allErrors: true });
const validateCore = ajv.compile(coreConfigSchema);

export function loadConfig(path: string): FtsConfig {
  const raw = readFileSync(path, "utf8");
  const errors: { error: number; offset: number; length: number }[] = [];
  const parsed = parseJsonc(raw, errors, { allowTrailingComma: true });
  if (errors.length > 0) {
    const msg = errors
      .map((e) => `${printParseErrorCode(e.error)} at offset ${e.offset}`)
      .join("; ");
    throw new ConfigValidationError(`JSONC parse error: ${msg}`);
  }
  if (!validateCore(parsed)) {
    const details = validateCore.errors ?? [];
    const msg = details
      .map((e) => `${e.instancePath || "<root>"} ${e.message}`)
      .join("; ");
    throw new ConfigValidationError(`Invalid config: ${msg}`, details);
  }
  return parsed as FtsConfig;
}
