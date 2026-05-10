export type HandPose = "shifter" | "ebrake" | "floating" | "steering";

export interface HandPoseInputs {
  currGear: number;
  handbrake: number;
  throttle: number;
  brake: number;
  clutch: number;
  nowMs: number;
  lastGearChangeMs: number;
  shifterPoseDurationMs: number;
  handbrakeEngageThreshold: number;
}

export function handPose(i: HandPoseInputs): HandPose {
  if (i.nowMs - i.lastGearChangeMs < i.shifterPoseDurationMs) return "shifter";
  if (i.handbrake > i.handbrakeEngageThreshold) return "ebrake";
  if (
    i.currGear === 0 &&
    i.throttle === 0 &&
    i.brake === 0 &&
    i.clutch === 0
  ) {
    return "floating";
  }
  return "steering";
}
