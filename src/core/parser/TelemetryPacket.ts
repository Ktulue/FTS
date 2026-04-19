// src/core/parser/TelemetryPacket.ts
export interface TelemetryPacket {
  /** Unix epoch ms when FSTS received/parsed the packet */
  timestamp: number;
  /** False when in menus / paused */
  isRaceOn: boolean;
  /** Speed in m/s */
  speed: number;
  /** Current engine RPM */
  rpm: number;
  /** Peak engine RPM for this car */
  maxRpm: number;
  /** Gear: 0 = reverse, 1+ = forward gears */
  gear: number;
  /** Lateral acceleration in G (positive = right) */
  accelLateral: number;
  /** Longitudinal acceleration in G (positive = forward) */
  accelLongitudinal: number;
  /** Tire slip ratios, -1..1ish per wheel */
  tireSlipRatio: {
    fl: number;
    fr: number;
    rl: number;
    rr: number;
  };
  /** Unique car identifier (for Car Report Card, Bicycle/Car phases) */
  carOrdinal: number;
  /** Car class (FH5): 0=D, 1=C, 2=B, 3=A, 4=S1, 5=S2, 6=X */
  carClass: number;
  /** Drivetrain: 0=FWD, 1=RWD, 2=AWD */
  drivetrainType: number;
}
