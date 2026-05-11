// test/integration/driver-inputs.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import WebSocket from "ws";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");

// Disjoint from skateboard.test.ts which uses [15780, 16779].
const HTTP_PORT = 16800 + Math.floor(Math.random() * 200);  // [16800, 16999]

let proc: ChildProcess | undefined;
let workDir: string;

function makeConfig(fixturePath: string): string {
  return JSON.stringify({
    input: { type: "mock", file: fixturePath, loop: true, speed: 2.0, game: "fh5" },
    rawOutputs: [],
    http: { port: HTTP_PORT },
    logging: { level: "error", dir: join(workDir, "logs"), pretty: false },
    modules: {
      "backseat-speedometer": { enabled: false, config: { defaultUnits: "mph" } },
      "redline-alert": {
        enabled: false,
        config: { thresholdRatio: 0.96, minDurationMs: 1200, cooldownMs: 8000 },
      },
      "driver-inputs": {
        enabled: true,
        config: {
          userAssetDir: null,
          wheelRotationRangeDeg: 450,
          shifterPoseDurationMs: 350,
          handbrakeEngageThreshold: 0.1,
        },
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

// Subprocess cleanup note: child.kill() with shell:true on Windows doesn't
// cascade through cmd.exe → npx → node → tsx, so the FTS process can orphan.
// Same issue exists in skateboard.test.ts. The fix would be a shared helper
// using tree-kill or `taskkill /F /T /PID`. Tracked as future maintenance.
beforeAll(async () => {
  workDir = mkdtempSync(join(tmpdir(), "fts-di-int-"));
  // Copy fixture into workDir so MockInput can read it under our temp tree
  const fixtureSrc = resolve(ROOT, "test/fixtures/skateboard-smoke.fzt");
  const fixtureDst = join(workDir, "smoke.fzt");
  writeFileSync(fixtureDst, readFileSync(fixtureSrc));
  const cfgPath = join(workDir, "config.jsonc");
  writeFileSync(cfgPath, makeConfig(fixtureDst));

  proc = spawn("npx", ["tsx", resolve(ROOT, "src/index.ts")], {
    cwd: ROOT,
    env: { ...process.env, FTS_CONFIG_PATH: cfgPath, FTS_EXAMPLE_PATH: cfgPath },
    stdio: ["ignore", "pipe", "pipe"],
    shell: true,
  });
  proc.stderr?.on("data", (d) => console.error("[fts-stderr]", d.toString()));

  await waitFor(async () => {
    const res = await fetch(`http://127.0.0.1:${HTTP_PORT}/health`);
    if (res.status !== 200) throw new Error(`status ${res.status}`);
  }, 8000);
}, 20_000);

afterAll(async () => {
  if (proc && !proc.killed) {
    proc.kill();
    await new Promise((r) => setTimeout(r, 300));
  }
  if (workDir) {
    try { rmSync(workDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

describe("driver-inputs overlay (integration)", () => {
  it("serves overlay index.html from built-in dir", async () => {
    const r = await fetch(`http://127.0.0.1:${HTTP_PORT}/overlays/driver-inputs/`);
    expect(r.status).toBe(200);
    const body = await r.text();
    expect(body).toContain("wheel-wrap");
  });

  it("serves a built-in SVG asset", async () => {
    const r = await fetch(`http://127.0.0.1:${HTTP_PORT}/overlays/driver-inputs/assets/wheel.svg`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type") ?? "").toContain("svg");
  });

  it("serves config.json with the configured values", async () => {
    const r = await fetch(`http://127.0.0.1:${HTTP_PORT}/modules/driver-inputs/config.json`);
    expect(r.status).toBe(200);
    const body = await r.json() as {
      wheelRotationRangeDeg: number;
      shifterPoseDurationMs: number;
      handbrakeEngageThreshold: number;
    };
    expect(body.wheelRotationRangeDeg).toBe(450);
    expect(body.shifterPoseDurationMs).toBe(350);
    expect(body.handbrakeEngageThreshold).toBe(0.1);
  });

  it("returns 404 on traversal attempt", async () => {
    const r = await fetch(
      `http://127.0.0.1:${HTTP_PORT}/overlays/driver-inputs/%2e%2e/%2e%2e/etc/passwd`,
    );
    expect(r.status).toBe(404);
  });

  it("WS /telemetry emits packets with the input fields", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${HTTP_PORT}/telemetry`);
    try {
      const pkt = await new Promise<Record<string, unknown>>((resolveP, rejectP) => {
        const t = setTimeout(() => rejectP(new Error("no telemetry within 5s")), 5000);
        ws.on("message", (data) => {
          try {
            const msg = JSON.parse(String(data)) as { type?: string; data?: Record<string, unknown> };
            if (msg.type === "telemetry" && msg.data) {
              clearTimeout(t);
              resolveP(msg.data);
            }
          } catch { /* ignore parse errors */ }
        });
        ws.on("error", rejectP);
      });
      expect(typeof pkt.steer).toBe("number");
      expect(typeof pkt.throttle).toBe("number");
      expect(typeof pkt.brake).toBe("number");
      expect(typeof pkt.clutch).toBe("number");
      expect(typeof pkt.handbrake).toBe("number");
    } finally {
      ws.close();
    }
  }, 8000);

  it("overlay becomes unavailable after the module is disabled (and recovers on enable)", async () => {
    // Disable: PluginHost.stopPlugin() → unregisterOverlay() → 404 in e2e.
    // (Server unit tests cover the in-window 503 path; here we observe the
    // post-stop state, which is overlay-gone → 404.)
    const dis = await fetch(`http://127.0.0.1:${HTTP_PORT}/modules/driver-inputs/disable`, {
      method: "POST",
    });
    expect(dis.ok).toBe(true);
    const downRes = await fetch(`http://127.0.0.1:${HTTP_PORT}/overlays/driver-inputs/`);
    expect([404, 503]).toContain(downRes.status);
    expect(downRes.status).not.toBe(200);

    // Re-enable so subsequent test runs / later assertions still work.
    const en = await fetch(`http://127.0.0.1:${HTTP_PORT}/modules/driver-inputs/enable`, {
      method: "POST",
    });
    expect(en.ok).toBe(true);
    // Poll until overlay is back up
    await waitFor(async () => {
      const res = await fetch(`http://127.0.0.1:${HTTP_PORT}/overlays/driver-inputs/`);
      if (res.status !== 200) throw new Error(`status ${res.status}`);
    }, 3000);
  });
});
