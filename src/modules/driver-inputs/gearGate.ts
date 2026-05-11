// Mirrored verbatim in src/modules/driver-inputs/public/overlay.js (no build step).
// Keep both implementations in sync — same H-pattern table, same fallback math.

export interface GatePosition {
  /** Horizontal offset from center, in percent (-X = left). */
  x: number;
  /** Vertical offset from center, in percent (+Y = down). */
  y: number;
}

const COL_OFFSET = 40;
const ROW_OFFSET = 30;

const H_PATTERN: Record<number, GatePosition> = {
  0: { x: -COL_OFFSET, y:  ROW_OFFSET }, // R
  1: { x: -COL_OFFSET, y: -ROW_OFFSET },
  2: { x: -COL_OFFSET, y:  ROW_OFFSET },
  3: { x: 0,            y: -ROW_OFFSET },
  4: { x: 0,            y:  ROW_OFFSET },
  5: { x:  COL_OFFSET, y: -ROW_OFFSET },
  6: { x:  COL_OFFSET, y:  ROW_OFFSET },
};

export function gearGate(gear: number): GatePosition {
  const fixed = H_PATTERN[gear];
  if (fixed) return fixed;
  // Sequential for >6: gear 7 at top of bar, climbing further up per gear.
  return { x: 0, y: -ROW_OFFSET - (gear - 6) * 10 };
}
