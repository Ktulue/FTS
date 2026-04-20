# Redline Alert

A push-style module. Watches RPM and emits a `triggered` event on `/events` WS channel when RPM sustains near max for long enough.

## WS event shape

```json
{
  "type": "event",
  "source": "redline-alert",
  "event": "triggered",
  "timestamp": 1744994123789,
  "payload": { "rpm": 7450, "maxRpm": 7500, "ratio": 0.993, "durationMs": 1250 }
}
```

## Streamer.bot integration (reference)

- WebSocket Client sub-action subscribes to `ws://localhost:5780/events`
- Filter: `$.source == "redline-alert" AND $.event == "triggered"`
- On match: play sound, send chat message

## Config

```jsonc
"redline-alert": {
  "enabled": true,
  "config": {
    "thresholdRatio": 0.96,
    "minDurationMs": 1200,
    "cooldownMs": 8000
  }
}
```
