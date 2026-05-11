// Static client. Fetches its own config, opens a WS, paints via rAF.

const SLOTS_WITH_PNG_FIRST = true; // built-in ships .svg; user can drop .png that wins

function installFallback(img) {
  // PNG → SVG fallback: re-arms naturally across data-slot/src changes.
  img.addEventListener("error", () => {
    const slot = img.dataset.slot;
    if (!slot) return;
    // Only retry if we're currently pointing at the PNG. If we already
    // swapped to .svg and it ALSO failed, leave the broken-image icon as
    // a visible hint — don't loop.
    if (img.src.endsWith(`/assets/${slot}.png`)) {
      img.src = `assets/${slot}.svg`;
    }
  });
}

function setupFallbacks() {
  document.querySelectorAll("img[data-slot]").forEach((img) => {
    if (SLOTS_WITH_PNG_FIRST) {
      const slot = img.dataset.slot;
      img.src = `assets/${slot}.png`;
    }
    installFallback(img);
  });
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function gearLabel(g) {
  if (g === 0) return "R";
  if (g < 0 || g === undefined || g === null) return "N";
  return String(g);
}

// Mirror of src/modules/driver-inputs/gearGate.ts (browser has no build step,
// can't import .ts directly). Keep in sync.
function gearGate(gear) {
  const COL = 40, ROW = 30;
  const map = {
    0: { x: -COL, y:  ROW },
    1: { x: -COL, y: -ROW },
    2: { x: -COL, y:  ROW },
    3: { x: 0,     y: -ROW },
    4: { x: 0,     y:  ROW },
    5: { x:  COL, y: -ROW },
    6: { x:  COL, y:  ROW },
  };
  if (gear in map) return map[gear];
  return { x: 0, y: -ROW - (gear - 6) * 10 };
}

// Mirror of src/modules/driver-inputs/handPose.ts (browser has no build step,
// can't import .ts directly). Keep in sync.
function handPose(i) {
  if (i.nowMs - i.lastGearChangeMs < i.shifterPoseDurationMs) return "shifter";
  if (i.handbrake > i.handbrakeEngageThreshold) return "ebrake";
  if (i.currGear === 0 && i.throttle === 0 && i.brake === 0 && i.clutch === 0) return "floating";
  return "steering";
}

async function loadConfig() {
  try {
    const r = await fetch("/modules/driver-inputs/config.json");
    if (r.ok) return await r.json();
  } catch {}
  return {
    wheelRotationRangeDeg: 450,
    shifterPoseDurationMs: 350,
    handbrakeEngageThreshold: 0.1,
  };
}

function connectWS(onPacket) {
  let backoff = 250;
  const url = `ws://${location.host}/telemetry`;
  function open() {
    const ws = new WebSocket(url);
    ws.addEventListener("open", () => { backoff = 250; });
    ws.addEventListener("message", (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === "telemetry" && msg.data) onPacket(msg.data);
      } catch {}
    });
    ws.addEventListener("close", () => {
      setTimeout(open, backoff);
      backoff = Math.min(5000, backoff * 2);
    });
    ws.addEventListener("error", () => { try { ws.close(); } catch {} });
  }
  open();
}

async function main() {
  setupFallbacks();
  const cfg = await loadConfig();

  const $wheel = document.getElementById("wheel-wrap");
  const $handRight = document.getElementById("hand-right");
  const $shifterKnob = document.getElementById("shifter-knob");
  const $ebrakeLever = document.getElementById("ebrake-lever");
  const $ebrakeEffect = document.getElementById("ebrake-effect");
  const $gear = document.getElementById("gear");
  const $fills = {
    throttle: document.querySelector('.pedal-fill[data-pedal="throttle"]'),
    brake: document.querySelector('.pedal-fill[data-pedal="brake"]'),
    clutch: document.querySelector('.pedal-fill[data-pedal="clutch"]'),
  };
  const $footLeft = document.getElementById("foot-left");
  const $footRight = document.getElementById("foot-right");

  let latest = null;
  let prevGear = null;
  let lastGearChangeMs = 0;
  let currentPose = "steering";

  connectWS((pkt) => { latest = pkt; });

  function paint() {
    requestAnimationFrame(paint);
    const p = latest;
    if (!p) return;

    if (prevGear !== null && p.gear !== prevGear) {
      lastGearChangeMs = performance.now();
    }
    prevGear = p.gear;

    $wheel.style.transform =
      `translate(-50%, -50%) rotate(${clamp(p.steer, -1, 1) * cfg.wheelRotationRangeDeg}deg)`;

    $fills.throttle.style.transform = `scaleY(${clamp(p.throttle, 0, 1)})`;
    $fills.brake.style.transform    = `scaleY(${clamp(p.brake, 0, 1)})`;
    $fills.clutch.style.transform   = `scaleY(${clamp(p.clutch, 0, 1)})`;

    const pose = handPose({
      currGear: p.gear,
      handbrake: p.handbrake,
      throttle: p.throttle,
      brake: p.brake,
      clutch: p.clutch,
      nowMs: performance.now(),
      lastGearChangeMs,
      shifterPoseDurationMs: cfg.shifterPoseDurationMs,
      handbrakeEngageThreshold: cfg.handbrakeEngageThreshold,
    });
    if (pose !== currentPose) {
      currentPose = pose;
      const slot = `hand_right_${pose}`;
      $handRight.dataset.slot = slot;
      // reset triedSvg-style state by re-installing on this src swap
      $handRight.src = `assets/${slot}.png`;
    }

    const gate = gearGate(p.gear);
    $shifterKnob.style.transform = `translate(${gate.x}%, ${gate.y}%)`;

    $ebrakeLever.style.transform = `rotate(${clamp(p.handbrake, 0, 1) * -25}deg)`;
    $ebrakeEffect.style.opacity = p.handbrake > cfg.handbrakeEngageThreshold ? "1" : "0";

    $footLeft.style.opacity  = p.brake > 0 ? "1" : "0";
    $footRight.style.opacity = p.throttle > 0 ? "1" : "0";

    $gear.textContent = gearLabel(p.gear);
  }
  requestAnimationFrame(paint);
}

main();
