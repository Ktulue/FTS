import { describe, it, expect } from "vitest";
import { gearGate } from "./gearGate.js";

describe("gearGate", () => {
  it("places R bottom-left of the H-pattern", () => {
    const { x, y } = gearGate(0);
    expect(x).toBeLessThan(0);     // left column
    expect(y).toBeGreaterThan(0);  // bottom row
  });

  it("places 1 top-left", () => {
    const { x, y } = gearGate(1);
    expect(x).toBeLessThan(0);
    expect(y).toBeLessThan(0);
  });

  it("places 2 bottom-left", () => {
    const { x, y } = gearGate(2);
    expect(x).toBeLessThan(0);
    expect(y).toBeGreaterThan(0);
  });

  it("places 3 top-middle", () => {
    const { x, y } = gearGate(3);
    expect(x).toBe(0);
    expect(y).toBeLessThan(0);
  });

  it("places 4 bottom-middle", () => {
    const { x, y } = gearGate(4);
    expect(x).toBe(0);
    expect(y).toBeGreaterThan(0);
  });

  it("places 5 top-right", () => {
    const { x, y } = gearGate(5);
    expect(x).toBeGreaterThan(0);
    expect(y).toBeLessThan(0);
  });

  it("places 6 bottom-right", () => {
    const { x, y } = gearGate(6);
    expect(x).toBeGreaterThan(0);
    expect(y).toBeGreaterThan(0);
  });

  it("falls back to sequential vertical for gears > 6", () => {
    const g7 = gearGate(7);
    const g8 = gearGate(8);
    expect(g7.x).toBe(0);
    expect(g8.x).toBe(0);
    expect(g8.y).toBeLessThan(g7.y);   // higher gear → higher on screen
  });
});
