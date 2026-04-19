// src/modules/index.ts
import type { Plugin } from "../core/plugin-host/Plugin.js";
import { backseatSpeedometer } from "./backseat-speedometer/plugin.js";
import { redlineAlert } from "./redline-alert/plugin.js";

export const modules: Plugin[] = [
  backseatSpeedometer,
  redlineAlert,
];
