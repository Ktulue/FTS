// src/core/plugin-host/Plugin.ts
import type { TelemetryPacket } from "../parser/TelemetryPacket.js";
import type { Logger } from "../logging/logger.js";
import type { Request, Response } from "express";

export type RouteHandler = (req: Request, res: Response) => void | Promise<void>;
export type HttpMethod = "GET" | "POST";
export type EmitChannel = "events" | "admin";

export interface PluginContext {
  /** Emit a WS message on a listener-managed channel. */
  emit(channel: EmitChannel, event: string, payload: unknown): void;
  /** Register an HTTP route scoped under the plugin's id namespace. */
  registerRoute(method: HttpMethod, path: string, handler: RouteHandler): void;
  /** Per-module child logger, pre-tagged with module id. */
  log: Logger;
  /** This plugin's config slice (as loaded from config.jsonc). */
  config: unknown;
}

export interface Plugin {
  readonly id: string;
  readonly displayName: string;
  readonly description?: string;
  readonly configSchema?: object;
  onStart(ctx: PluginContext): Promise<void> | void;
  onTelemetry?(pkt: TelemetryPacket, ctx: PluginContext): void;
  onStop(): Promise<void> | void;
}
