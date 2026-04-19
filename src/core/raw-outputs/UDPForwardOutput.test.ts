// src/core/raw-outputs/UDPForwardOutput.test.ts
import { describe, it, expect } from "vitest";
import { createSocket } from "node:dgram";
import { UDPForwardOutput } from "./UDPForwardOutput.js";

describe("UDPForwardOutput", () => {
  it("forwards bytes to the configured host:port", async () => {
    const receiver = createSocket("udp4");
    const received: Buffer[] = [];
    receiver.on("message", (raw) => received.push(raw));
    await new Promise<void>((r) => receiver.bind(0, "127.0.0.1", () => r()));
    const port = receiver.address().port;

    const fwd = new UDPForwardOutput({
      name: "test",
      host: "127.0.0.1",
      port,
      enabled: true,
    });

    fwd.send(Buffer.from("hello"));
    await new Promise((r) => setTimeout(r, 50));
    expect(received.length).toBe(1);
    expect(received[0]!.toString()).toBe("hello");
    expect(fwd.stats().sent).toBe(1);
    expect(fwd.stats().errors).toBe(0);

    await fwd.shutdown();
    receiver.close();
  });

  it("skips sending when disabled", async () => {
    const fwd = new UDPForwardOutput({
      name: "t", host: "127.0.0.1", port: 1, enabled: false,
    });
    fwd.send(Buffer.from("x"));
    expect(fwd.stats().sent).toBe(0);
    await fwd.shutdown();
  });
});
