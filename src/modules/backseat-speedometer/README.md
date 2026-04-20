# Backseat Speedometer

A pull-style module. Caches the latest telemetry packet and exposes it on:

```
GET /modules/backseat-speedometer/latest?units=mph|kph
```

Response includes the raw packet plus a `formatted` block with speed converted to the requested units, gear, and rounded RPM. Returns 204 when no packet has been received yet.

## Streamer.bot integration (reference)

- Chat command trigger: `!speed`
- Sub-action: Fetch URL `http://localhost:5780/modules/backseat-speedometer/latest?units=mph`
- Extract `formatted.speed`, `formatted.gear`, `formatted.rpm`
- Send Twitch chat reply formatted however you like.

## Config

```jsonc
"backseat-speedometer": {
  "enabled": true,
  "config": { "defaultUnits": "mph" }
}
```
