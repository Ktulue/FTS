# FTS — Manual Smoke Test

Run this checklist before declaring Skateboard complete.

## Pre-flight

- [ ] `npm install` succeeds
- [ ] `npm test` all green
- [ ] `npm run typecheck` clean

## Startup

- [ ] Delete (or rename) your `config.jsonc`, run `start-fts.bat` — FTS copies `config.example.jsonc` → `config.jsonc` and exits with a clear message
- [ ] Run `start-fts.bat` again — FTS starts, log shows "FTS started" with input type, http port, module count
- [ ] Open `http://localhost:5780/hub` — Admin Panel loads, module list shows Backseat Speedometer and Redline Alert
- [ ] Open `http://localhost:5780/health` — returns `{"status":"ok", ...}`

## With Forza running (Data Out configured to 127.0.0.1:9999)

- [ ] Drive for 60 seconds; `/health` packet count increments into the thousands
- [ ] `/telemetry/latest` returns a full packet with your current speed, RPM, gear
- [ ] `/modules/backseat-speedometer/latest?units=mph` returns `formatted.speed` within ±1mph of what the game shows

## Push path

- [ ] Hold redline for >1.2 seconds — Streamer.bot WS Client (or a `wscat ws://localhost:5780/events` session) receives a `{"source":"redline-alert","event":"triggered",...}` message
- [ ] Immediately hold redline again — no duplicate event within 8 seconds (cooldown working)
- [ ] Short taps of redline (<1s) — no event fired

## Admin Panel toggles

- [ ] Uncheck "Redline Alert" in Admin Panel — `/modules` shows `enabled: false`, no more events fire even while redlining
- [ ] Re-check — events resume firing when condition met

## Raw forwarder

- [ ] Edit `config.jsonc`, set `moza-pit-house` raw output `enabled: true` with `port: 55555`; restart FTS
- [ ] In another terminal: `ncat -ul 127.0.0.1 55555 --recv-only -v | od -An -tx1 -w16 | head -5`
- [ ] Drive in Forza — netcat prints hex-dumped packets matching Forza's UDP output format

## MockInput

- [ ] Edit `config.jsonc` to use `"input": {"type":"mock","file":"./test/fixtures/skateboard-smoke.fzt","loop":true,"speed":1.0}`; restart FTS
- [ ] `/telemetry/latest` updates even though Forza isn't running
- [ ] Redline Alert fires during the redline segment of the replay

## Shutdown

- [ ] Close the FTS console window (or run `stop-fts.bat`) — process exits cleanly, no stuck UDP binding (`netstat -an | findstr :9999` is empty)

## Driver Inputs Overlay

1. Start FTS: `start-fts.bat` (or `npm start`).
2. Add OBS Browser Source at `http://localhost:5780/overlays/driver-inputs/` (1920×1080, transparent).
3. With Forza Horizon 5 running (Pithouse relaying to FTS port 9999), drive for 60 seconds and confirm:
   - Wheel rotates left/right with steering input.
   - Throttle / brake / clutch bars fill 0–100% with pedal pressure.
   - Gear text updates on each gear change; gear 0 displays as `R`.
   - Right-hand image swaps to `hand_right_shifter` briefly on each gear change, returning to `hand_right_steering`.
   - With handbrake engaged: right-hand swaps to `hand_right_ebrake`; e-brake lever rises; e-brake effect flashes.
4. Custom-art smoke: drop a single `wheel.png` into your configured `userAssetDir/assets/` and reload the OBS source. The wheel should swap while every other slot stays on the built-in SVG.
5. **Pithouse assumption check** (run once, after first setup): in Forza, reconfigure Data Out to send directly to FTS port 9999 (bypassing Pithouse). Drive for 30s. Note packet count via `http://localhost:5780/health`. Re-enable Pithouse-in-chain. Repeat. Packet counts should be comparable; parsed values should look the same.
