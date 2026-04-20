// src/modules/redline-alert/plugin.ts
import type { Plugin, PluginContext } from "../../core/plugin-host/Plugin.js";
import type { TelemetryPacket } from "../../core/parser/TelemetryPacket.js";

interface Config {
  thresholdRatio: number;
  minDurationMs: number;
  cooldownMs: number;
}

interface State {
  aboveSince: number | null;
  lastFiredAt: number;
  cfg: Config;
}

let state: State = {
  aboveSince: null,
  lastFiredAt: Number.NEGATIVE_INFINITY,
  cfg: { thresholdRatio: 0.96, minDurationMs: 1200, cooldownMs: 8000 },
};

export const redlineAlert: Plugin = {
  id: "redline-alert",
  displayName: "Redline Alert",
  description: "Fires a push event when RPM sustains near max for long enough",

  onStart(ctx: PluginContext) {
    state = {
      aboveSince: null,
      lastFiredAt: Number.NEGATIVE_INFINITY,
      cfg: (ctx.config ?? state.cfg) as Config,
    };
    ctx.log.info({ cfg: state.cfg }, "redline-alert started");
  },

  onTelemetry(pkt: TelemetryPacket, ctx: PluginContext) {
    if (!pkt.isRaceOn || pkt.maxRpm <= 0) {
      state.aboveSince = null;
      return;
    }
    const ratio = pkt.rpm / pkt.maxRpm;
    const now = pkt.timestamp;

    if (ratio >= state.cfg.thresholdRatio) {
      if (state.aboveSince === null) {
        state.aboveSince = now;
      } else if (
        now - state.aboveSince >= state.cfg.minDurationMs &&
        now - state.lastFiredAt >= state.cfg.cooldownMs
      ) {
        ctx.emit("events", "triggered", {
          rpm: pkt.rpm,
          maxRpm: pkt.maxRpm,
          ratio: Number(ratio.toFixed(3)),
          durationMs: now - state.aboveSince,
        });
        state.lastFiredAt = now;
      }
    } else {
      state.aboveSince = null;
    }
  },

  onStop() {
    state.aboveSince = null;
  },
};
