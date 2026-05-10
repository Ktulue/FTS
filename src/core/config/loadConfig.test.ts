// src/core/config/loadConfig.test.ts
import { describe, it, expect } from "vitest";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, ConfigValidationError } from "./loadConfig.js";

function writeTempConfig(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), "fts-cfg-"));
  const path = join(dir, "config.jsonc");
  writeFileSync(path, contents);
  return path;
}

const VALID = `{
  // JSONC comments are allowed
  "input": { "type": "udp", "port": 9999 },
  "rawOutputs": [],
  "http": { "port": 5780 },
  "logging": { "level": "info", "dir": "./logs" },
  "modules": {}
}`;

describe("loadConfig", () => {
  it("parses a valid JSONC config", () => {
    const path = writeTempConfig(VALID);
    const cfg = loadConfig(path);
    expect(cfg.http.port).toBe(5780);
    expect(cfg.input.type).toBe("udp");
  });

  it("throws ConfigValidationError for missing required fields", () => {
    const path = writeTempConfig(`{ "http": { "port": 5780 } }`);
    expect(() => loadConfig(path)).toThrow(ConfigValidationError);
  });

  it("throws ConfigValidationError for invalid port", () => {
    const path = writeTempConfig(
      VALID.replace(`"port": 9999`, `"port": 99999`)
    );
    expect(() => loadConfig(path)).toThrow(ConfigValidationError);
  });

  it("accepts input.game: 'fh5'", () => {
    const path = writeTempConfig(
      VALID.replace(
        `"input": { "type": "udp", "port": 9999 }`,
        `"input": { "type": "udp", "port": 9999, "game": "fh5" }`
      )
    );
    const cfg = loadConfig(path);
    expect(cfg.input.game).toBe("fh5");
  });

  it("rejects unknown input.game", () => {
    const path = writeTempConfig(
      VALID.replace(
        `"input": { "type": "udp", "port": 9999 }`,
        `"input": { "type": "udp", "port": 9999, "game": "fh99" }`
      )
    );
    expect(() => loadConfig(path)).toThrow(ConfigValidationError);
  });
});
