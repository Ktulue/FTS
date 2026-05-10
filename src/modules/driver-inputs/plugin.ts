import { fileURLToPath } from "node:url";
import type { Plugin, PluginContext } from "../../core/plugin-host/Plugin.js";
import type { Request, Response } from "express";
import schema from "./config.schema.json" with { type: "json" };

interface Config {
  userAssetDir?: string | null;
  wheelRotationRangeDeg?: number;
  shifterPoseDurationMs?: number;
  handbrakeEngageThreshold?: number;
}

const DEFAULTS: Required<Omit<Config, "userAssetDir">> = {
  wheelRotationRangeDeg: 450,
  shifterPoseDurationMs: 350,
  handbrakeEngageThreshold: 0.1,
};

export const driverInputs: Plugin = {
  id: "driver-inputs",
  displayName: "Driver Inputs Overlay",
  description: "Browser-source overlay: wheel, three pedal bars, gear, shifter, e-brake.",
  configSchema: schema as object,

  onStart(ctx: PluginContext) {
    const cfg = (ctx.config ?? {}) as Config;
    const builtInDir = fileURLToPath(new URL("./public", import.meta.url));
    const userDir = cfg.userAssetDir ?? undefined;
    ctx.registerOverlay({ builtInDir, userDir: userDir ?? undefined });

    ctx.registerRoute(
      "GET",
      "/modules/driver-inputs/config.json",
      (_req: Request, _res: Response) => {
        _res.json({
          wheelRotationRangeDeg: cfg.wheelRotationRangeDeg ?? DEFAULTS.wheelRotationRangeDeg,
          shifterPoseDurationMs: cfg.shifterPoseDurationMs ?? DEFAULTS.shifterPoseDurationMs,
          handbrakeEngageThreshold:
            cfg.handbrakeEngageThreshold ?? DEFAULTS.handbrakeEngageThreshold,
        });
      },
    );

    ctx.log.info({ builtInDir, userDir }, "driver-inputs overlay registered");
  },

  onStop() {
    // No persistent state; overlay/routes are unmounted by the host.
  },
};
