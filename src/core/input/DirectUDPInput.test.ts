// src/core/input/DirectUDPInput.test.ts
import { describe, it, expect } from "vitest";
import { createSocket } from "node:dgram";
import { DirectUDPInput } from "./DirectUDPInput.js";

describe("DirectUDPInput", () => {
  it("receives datagrams from loopback", async () => {
    const input = new DirectUDPInput({ port: 0 }); // 0 = ephemeral port
    const received: Buffer[] = [];
    await input.start((raw) => received.push(raw));

    // Discover the bound port
    const port = input.port();
    expect(port).toBeGreaterThan(0);

    // Send test packet
    const sender = createSocket("udp4");
    const payload = Buffer.from("hello forza");
    await new Promise<void>((resolve, reject) =>
      sender.send(payload, port, "127.0.0.1", (err) => (err ? reject(err) : resolve()))
    );

    // Wait up to 1s for delivery
    for (let i = 0; i < 20 && received.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    sender.close();
    await input.stop();

    expect(received.length).toBe(1);
    expect(received[0]!.toString()).toBe("hello forza");
  });
});
