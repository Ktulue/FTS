// test/integration/skateboard.test.ts
import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import WebSocket from "ws";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");

function makeConfig(httpPort: number, fixturePath: string): string {
  return JSON.stringify({
    input: { type: "mock", file: fixturePath, loop: false, speed: 2.0 },
    rawOutputs: [],
    http: { port: httpPort },
    logging: { level: "error", dir: "./logs", pretty: false },
    modules: {
      "backseat-speedometer": { enabled: true, config: { defaultUnits: "mph" } },
      "redline-alert": {
        enabled: true,
        // Tuned for 2x replay: 1500ms fixture redline → 750ms wall-clock window
        config: { thresholdRatio: 0.96, minDurationMs: 300, cooldownMs: 1000 },
      },
    },
  });
}

async function waitFor<T>(fn: () => Promise<T>, timeoutMs: number): Promise<T> {
  const start = Date.now();
  let lastErr: unknown;
  while (Date.now() - start < timeoutMs) {
    try { return await fn(); } catch (err) { lastErr = err; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw lastErr;
}

describe("Skateboard integration", () => {
  it("boots, replays fixture, validates both pull and push paths", async () => {
    const httpPort = 15780 + Math.floor(Math.random() * 1000);
    const tmp = mkdtempSync(join(tmpdir(), "fts-int-"));
    const fixture = resolve(ROOT, "test/fixtures/skateboard-smoke.fzt");
    const cfgPath = join(tmp, "config.jsonc");
    writeFileSync(cfgPath, makeConfig(httpPort, fixture));

    // Spawn FTS pointed at the temp config via env vars (no cwd gymnastics).
    // shell: true needed on Windows where `npx` is npx.cmd.
    const child = spawn("npx", ["tsx", resolve(ROOT, "src/index.ts")], {
      cwd: ROOT,
      env: { ...process.env, FTS_CONFIG_PATH: cfgPath, FTS_EXAMPLE_PATH: cfgPath },
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
    });
    child.stderr?.on("data", (d) => console.error("[fts-stderr]", d.toString()));

    try {
      // Wait for /health to come up
      await waitFor(async () => {
        const res = await fetch(`http://127.0.0.1:${httpPort}/health`);
        if (res.status !== 200) throw new Error(`status ${res.status}`);
      }, 5000);

      // Subscribe to /events before replay finishes
      const events: unknown[] = [];
      const ws = new WebSocket(`ws://127.0.0.1:${httpPort}/events`);
      await new Promise((r) => ws.on("open", r));
      ws.on("message", (d) => events.push(JSON.parse(d.toString())));

      // Let MockInput at 2x speed finish (2500ms / 2 = 1250ms; buffer generously)
      await new Promise((r) => setTimeout(r, 2000));

      // PUSH PATH: Redline Alert fired at least once during the redline segment
      const redlineEvents = events.filter(
        (e) => (e as { source?: string }).source === "redline-alert",
      );
      expect(redlineEvents.length).toBeGreaterThanOrEqual(1);

      // PULL PATH: backseat-speedometer endpoint responds with formatted payload
      const res = await fetch(
        `http://127.0.0.1:${httpPort}/modules/backseat-speedometer/latest?units=mph`,
      );
      expect(res.status).toBe(200);
      const body = await res.json() as { formatted: { speed: number; units: string } };
      expect(body.formatted.units).toBe("mph");

      // Module registry is exposed
      const modulesRes = await fetch(`http://127.0.0.1:${httpPort}/modules`);
      const modulesList = await modulesRes.json() as { id: string; status: string }[];
      expect(modulesList.find((m) => m.id === "redline-alert")?.status).toBe("running");

      // Admin toggle disable works
      await fetch(`http://127.0.0.1:${httpPort}/modules/redline-alert/disable`, { method: "POST" });
      const modulesRes2 = await fetch(`http://127.0.0.1:${httpPort}/modules`);
      const modulesList2 = await modulesRes2.json() as { id: string; enabled: boolean }[];
      expect(modulesList2.find((m) => m.id === "redline-alert")?.enabled).toBe(false);

      ws.close();
    } finally {
      child.kill();
      await new Promise((r) => setTimeout(r, 200));
    }
  }, 15_000);
});
