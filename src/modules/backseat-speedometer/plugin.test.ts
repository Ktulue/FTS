// src/modules/backseat-speedometer/plugin.test.ts
import { describe, it, expect, vi } from "vitest";
import { backseatSpeedometer } from "./plugin.js";
import type { Request, Response } from "express";
import pino from "pino";

function mockRes() {
  const res: Partial<Response> & { _status?: number; _json?: unknown; _end?: boolean } = {};
  res.status = vi.fn((n: number) => { res._status = n; return res as Response; });
  res.json = vi.fn((body: unknown) => { res._json = body; return res as Response; });
  res.end = vi.fn(() => { res._end = true; return res as Response; });
  return res as Response & { _status?: number; _json?: unknown; _end?: boolean };
}

describe("backseatSpeedometer plugin", () => {
  it("registers a GET /modules/backseat-speedometer/latest route", async () => {
    let capturedHandler: ((req: Request, res: Response) => Promise<void> | void) | null = null;
    const ctx = {
      emit: vi.fn(),
      registerRoute: vi.fn((method, path, handler) => {
        if (method === "GET" && path === "/modules/backseat-speedometer/latest") {
          capturedHandler = handler;
        }
      }),
      log: pino({ level: "silent" }),
      config: {},
    };
    await backseatSpeedometer.onStart(ctx as never);
    expect(ctx.registerRoute).toHaveBeenCalled();
    expect(capturedHandler).not.toBeNull();
  });
});
