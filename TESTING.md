# FSTS — Manual Smoke Test

Run this checklist before declaring Skateboard complete.

## Pre-flight

- [ ] `npm install` succeeds
- [ ] `npm test` all green
- [ ] `npm run typecheck` clean

## Startup

- [ ] Delete (or rename) your `config.jsonc`, run `start-fsts.bat` — FSTS copies `config.example.jsonc` → `config.jsonc` and exits with a clear message
- [ ] Run `start-fsts.bat` again — FSTS starts, log shows "FSTS started" with input type, http port, module count
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

- [ ] Edit `config.jsonc`, set `moza-pit-house` raw output `enabled: true` with `port: 55555`; restart FSTS
- [ ] In another terminal: `ncat -ul 127.0.0.1 55555 --recv-only -v | od -An -tx1 -w16 | head -5`
- [ ] Drive in Forza — netcat prints hex-dumped packets matching Forza's UDP output format

## MockInput

- [ ] Edit `config.jsonc` to use `"input": {"type":"mock","file":"./test/fixtures/skateboard-smoke.fzt","loop":true,"speed":1.0}`; restart FSTS
- [ ] `/telemetry/latest` updates even though Forza isn't running
- [ ] Redline Alert fires during the redline segment of the replay

## Shutdown

- [ ] Close the FSTS console window (or run `stop-fsts.bat`) — process exits cleanly, no stuck UDP binding (`netstat -an | findstr :9999` is empty)
