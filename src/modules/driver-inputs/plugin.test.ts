import { describe, it, expect, vi } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { driverInputs } from "./plugin.js";

function makeCtx(overrides: Partial<{ config: unknown }> = {}) {
  const registerOverlay = vi.fn();
  const registerRoute = vi.fn();
  const emit = vi.fn();
  return {
    emit,
    registerRoute,
    registerOverlay,
    log: {
      info: vi.fn(), warn: vi.fn(), error: vi.fn(),
      debug: vi.fn(), trace: vi.fn(), fatal: vi.fn(),
    },
    config: overrides.config ?? {},
  };
}

describe("driverInputs plugin", () => {
  it("has the expected metadata", () => {
    expect(driverInputs.id).toBe("driver-inputs");
    expect(driverInputs.displayName).toBeTruthy();
  });

  it("registers the overlay with its public/ dir as builtInDir", async () => {
    const ctx = makeCtx();
    await driverInputs.onStart(ctx as any);
    expect(ctx.registerOverlay).toHaveBeenCalledTimes(1);
    const callArg = ctx.registerOverlay.mock.calls[0][0];
    const expectedBuiltIn = fileURLToPath(new URL("./public", import.meta.url));
    expect(path.resolve(callArg.builtInDir)).toBe(path.resolve(expectedBuiltIn));
    expect(callArg.userDir).toBeUndefined();
  });

  it("forwards a configured userAssetDir to registerOverlay", async () => {
    const ctx = makeCtx({ config: { userAssetDir: "/tmp/my-art" } });
    await driverInputs.onStart(ctx as any);
    const callArg = ctx.registerOverlay.mock.calls[0][0];
    expect(callArg.userDir).toBe("/tmp/my-art");
  });

  it("registers a GET /modules/driver-inputs/config.json route", async () => {
    const ctx = makeCtx({
      config: {
        wheelRotationRangeDeg: 450,
        shifterPoseDurationMs: 350,
        handbrakeEngageThreshold: 0.1,
      },
    });
    await driverInputs.onStart(ctx as any);
    const routeCall = ctx.registerRoute.mock.calls.find(
      (c: unknown[]) => c[0] === "GET" && c[1] === "/modules/driver-inputs/config.json",
    );
    expect(routeCall).toBeDefined();
    const handler = routeCall![2] as (req: unknown, res: unknown) => void;
    const sent: unknown[] = [];
    const res = { json: (b: unknown) => { sent.push(b); } };
    handler({}, res);
    expect(sent[0]).toEqual({
      wheelRotationRangeDeg: 450,
      shifterPoseDurationMs: 350,
      handbrakeEngageThreshold: 0.1,
    });
  });
});
