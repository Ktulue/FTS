# FTS — Forza Telemetry Suite

A single TypeScript/Node process that receives Forza Horizon UDP telemetry, parses it, and fans the data out to stream-facing consumers: OBS browser-source overlays, Streamer.bot chat commands and alerts, and (optionally) downstream sim racing software like Moza Pit House or SimHub.

Modules plug in via a unified `Plugin` contract and can be toggled on and off at runtime from a browser-based Admin Panel. The listener itself is Twitch-agnostic; Streamer.bot (or whatever else you point at it) handles the Twitch side.

**Status:** Skateboard phase — core listener, plugin system, Admin Panel, raw UDP forwarder, two validator modules. Bicycle (overlays) and Car (persistence, history, hardware) are captured in the spec for future phases.

## Requirements

- Windows (launchers are `.bat`; rest is cross-platform)
- Node.js 20 or newer
- Forza Horizon 5 (FM7, FH4 also work with the Dash packet format)

## Quick start

```
git clone <repo>
cd FTS
npm install
# First run will create config.jsonc from config.example.jsonc and exit:
npm start
# Edit config.jsonc if needed (default UDP port 9999, HTTP port 5780)
start-fts.bat
```

Configure Forza: Settings → HUD & Gameplay → Data Out → UDP, target `127.0.0.1:9999`, format "Dash".

Open `http://localhost:5780/hub` to see the Admin Panel.

## Validator modules

- **Backseat Speedometer** — `GET /modules/backseat-speedometer/latest?units=mph|kph` returns formatted current speed/gear/RPM for chat-command replies via Streamer.bot.
- **Redline Alert** — sustained near-max RPM emits a `triggered` event on `ws://localhost:5780/events`; point Streamer.bot's WebSocket Client at it to play sounds and send chat messages.

## Documentation

- Spec: [`docs/superpowers/specs/2026-04-18-stream-telemetry-suite-design.md`](docs/superpowers/specs/2026-04-18-stream-telemetry-suite-design.md)
- Manual smoke test: [`TESTING.md`](TESTING.md)

## Development

```
npm test          # full test suite (Vitest)
npm run typecheck # tsc --noEmit
npm run dev       # tsx watch src/index.ts
```

## Roadmap

- **Bicycle:** OBS browser-source overlays (G-Force Meter, Near Death Counter, Smooth Brain)
- **Car:** SQLite persistence (Session Stats, Car Report Card), StreamDeck plugin, Moza hardware integration activation

---

## Support

[Buy me a coffee on Ko-fi](http://ko-fi.com/ktulue)

Created by Ktulue | The Water Father
