// src/core/raw-outputs/RawOutputChain.test.ts
import { describe, it, expect, vi } from "vitest";
import { RawOutputChain } from "./RawOutputChain.js";
import type { RawOutput } from "./RawOutput.js";

function fakeOutput(name: string, enabled = true): RawOutput & { sendSpy: ReturnType<typeof vi.fn> } {
  const spy = vi.fn();
  return {
    name,
    enabled,
    send: spy,
    stats: () => ({ sent: 0, errors: 0, lastError: null }),
    shutdown: async () => {},
    sendSpy: spy,
  } as never;
}

describe("RawOutputChain", () => {
  it("fans send() out to all outputs", () => {
    const a = fakeOutput("a");
    const b = fakeOutput("b");
    const chain = new RawOutputChain([a, b]);
    const pkt = Buffer.from("x");
    chain.send(pkt);
    expect(a.sendSpy).toHaveBeenCalledWith(pkt);
    expect(b.sendSpy).toHaveBeenCalledWith(pkt);
  });

  it("a thrown output error is caught and does not break the chain", () => {
    const a = fakeOutput("a");
    a.send = vi.fn(() => { throw new Error("boom"); });
    const b = fakeOutput("b");
    const chain = new RawOutputChain([a, b]);
    chain.send(Buffer.from("x"));
    expect(b.sendSpy).toHaveBeenCalled();
  });
});
