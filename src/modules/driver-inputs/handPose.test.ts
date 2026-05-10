import { describe, it, expect } from "vitest";
import { handPose, type HandPoseInputs } from "./handPose.js";

const base: HandPoseInputs = {
  currGear: 3,
  handbrake: 0,
  throttle: 0.4,
  brake: 0,
  clutch: 0,
  nowMs: 1000,
  lastGearChangeMs: 0,
  shifterPoseDurationMs: 350,
  handbrakeEngageThreshold: 0.1,
};

describe("handPose", () => {
  it("returns 'shifter' within the duration after a gear change", () => {
    expect(handPose({ ...base, lastGearChangeMs: 800, nowMs: 1000 })).toBe("shifter");
    expect(handPose({ ...base, lastGearChangeMs: 800, nowMs: 1149 })).toBe("shifter");
  });

  it("returns 'steering' once the shifter duration elapses", () => {
    expect(handPose({ ...base, lastGearChangeMs: 800, nowMs: 1151 })).toBe("steering");
  });

  it("returns 'ebrake' while handbrake exceeds threshold", () => {
    expect(handPose({ ...base, handbrake: 0.5, lastGearChangeMs: 0, nowMs: 5000 })).toBe("ebrake");
  });

  it("'shifter' wins over 'ebrake' when both apply (priority)", () => {
    expect(
      handPose({ ...base, handbrake: 0.5, lastGearChangeMs: 4900, nowMs: 5000 }),
    ).toBe("shifter");
  });

  it("returns 'floating' when in neutral with no pedal input", () => {
    expect(
      handPose({
        ...base,
        currGear: 0,
        throttle: 0,
        brake: 0,
        clutch: 0,
        handbrake: 0,
        lastGearChangeMs: 0,
        nowMs: 5000,
      }),
    ).toBe("floating");
  });

  it("returns 'steering' as default", () => {
    expect(handPose({ ...base, lastGearChangeMs: 0, nowMs: 5000 })).toBe("steering");
  });

  it("does not return 'floating' if any pedal is non-zero in neutral", () => {
    expect(
      handPose({
        ...base,
        currGear: 0,
        throttle: 0.1,
        lastGearChangeMs: 0,
        nowMs: 5000,
      }),
    ).toBe("steering");
  });

  it("handbrake exactly at threshold is NOT 'ebrake'", () => {
    expect(
      handPose({ ...base, handbrake: 0.1, lastGearChangeMs: 0, nowMs: 5000 }),
    ).toBe("steering");
  });
});
