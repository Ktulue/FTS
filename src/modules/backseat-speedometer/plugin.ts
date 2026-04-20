// src/modules/backseat-speedometer/plugin.ts
import type { Plugin, PluginContext } from "../../core/plugin-host/Plugin.js";
import type { Request, Response } from "express";

interface Config {
  defaultUnits?: "mph" | "kph";
}

// A bus reference is injected via PluginContext extensions — but the spec says
// plugins get telemetry through ctx or direct bus? Re-reading the spec: modules
// can either implement onTelemetry (pushed) or register routes (pull). Pull
// modules need access to the latest packet. We provide it by caching the most
// recent packet in the plugin itself via onTelemetry, since ctx does not expose
// the bus. This keeps the Plugin API minimal.
//
// Strategy: this plugin implements BOTH onTelemetry (to cache) AND onStart (to
// register the route). It still validates the "pull path" from SB's perspective.

let latest: Record<string, unknown> | null = null;
let cfg: Config = {};

export const backseatSpeedometer: Plugin = {
  id: "backseat-speedometer",
  displayName: "Backseat Speedometer",
  description: "Serves GET /modules/backseat-speedometer/latest for chat-command integrations",

  onStart(ctx: PluginContext) {
    cfg = (ctx.config ?? {}) as Config;
    ctx.registerRoute("GET", "/modules/backseat-speedometer/latest", (req: Request, res: Response) => {
      if (!latest) { res.status(204).end(); return; }
      const units = (req.query.units === "kph" || req.query.units === "mph")
        ? req.query.units
        : (cfg.defaultUnits ?? "mph");
      const speedMps = (latest.speed as number) ?? 0;
      const speed = units === "kph" ? speedMps * 3.6 : speedMps * 2.2369362921;
      res.json({
        ...latest,
        formatted: {
          speed: Number(speed.toFixed(1)),
          units,
          gear: latest.gear,
          rpm: Math.round((latest.rpm as number) ?? 0),
        },
      });
    });
    ctx.log.info({}, "backseat-speedometer started");
  },

  onTelemetry(pkt) {
    latest = pkt as unknown as Record<string, unknown>;
  },

  onStop() {
    latest = null;
  },
};
