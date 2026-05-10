// src/core/plugin-host/PluginHost.ts
import type { Plugin, PluginContext, EmitChannel, HttpMethod, RouteHandler } from "./Plugin.js";
import type { TelemetryBus } from "../bus/TelemetryBus.js";
import type { Logger } from "../logging/logger.js";
import { childLogger } from "../logging/logger.js";
import type { ModuleEntryConfig } from "../config/types.js";
import type { TelemetryPacket } from "../parser/TelemetryPacket.js";

export type EmitFn = (
  moduleId: string,
  channel: EmitChannel,
  event: string,
  payload: unknown,
) => void;

export type RegisterRouteFn = (
  moduleId: string,
  method: HttpMethod,
  path: string,
  handler: RouteHandler,
) => void;

export type UnregisterRoutesFn = (moduleId: string) => void;

export type RegisterOverlayFn = (
  moduleId: string,
  opts: { builtInDir: string; userDir?: string },
) => void;

export type UnregisterOverlayFn = (moduleId: string) => void;

export interface PluginHostOptions {
  plugins: Plugin[];
  moduleConfig: Record<string, ModuleEntryConfig>;
  bus: TelemetryBus;
  log: Logger;
  emit: EmitFn;
  registerRoute: RegisterRouteFn;
  unregisterRoutes?: UnregisterRoutesFn;
  registerOverlay?: RegisterOverlayFn;
  unregisterOverlay?: UnregisterOverlayFn;
  /** Auto-disable thresholds, with sensible defaults */
  errorWindowMs?: number;   // default 10000
  errorThreshold?: number;  // default 5
  onStateChange?: (state: PluginRecord[]) => void;
}

export type PluginStatus = "running" | "stopped" | "errored";

export interface PluginRecord {
  id: string;
  displayName: string;
  description?: string;
  enabled: boolean;           // config + runtime
  status: PluginStatus;
  errorCount: number;
  lastError: string | null;
  customStatus: string | null; // set by module via ctx.emit("admin","status", "...")
}

export class PluginHost {
  private plugins: Plugin[];
  private config: Record<string, ModuleEntryConfig>;
  private bus: TelemetryBus;
  private log: Logger;
  private emit: EmitFn;
  private registerRoute: RegisterRouteFn;
  private unregisterRoutes: UnregisterRoutesFn;
  private registerOverlay: RegisterOverlayFn;
  private unregisterOverlay: UnregisterOverlayFn;
  private records = new Map<string, PluginRecord>();
  private unsubscribers = new Map<string, () => void>();
  private errorTimestamps = new Map<string, number[]>();
  private errorWindowMs: number;
  private errorThreshold: number;
  private onStateChange?: (state: PluginRecord[]) => void;

  constructor(opts: PluginHostOptions) {
    this.plugins = opts.plugins;
    this.config = opts.moduleConfig;
    this.bus = opts.bus;
    this.log = opts.log;
    this.emit = opts.emit;
    this.registerRoute = opts.registerRoute;
    this.unregisterRoutes = opts.unregisterRoutes ?? (() => {});
    this.registerOverlay = opts.registerOverlay ?? (() => {});
    this.unregisterOverlay = opts.unregisterOverlay ?? (() => {});
    this.errorWindowMs = opts.errorWindowMs ?? 10_000;
    this.errorThreshold = opts.errorThreshold ?? 5;
    this.onStateChange = opts.onStateChange;
  }

  async start(): Promise<void> {
    for (const plugin of this.plugins) {
      const entry = this.config[plugin.id] ?? { enabled: false };
      this.records.set(plugin.id, {
        id: plugin.id,
        displayName: plugin.displayName,
        description: plugin.description,
        enabled: entry.enabled,
        status: "stopped",
        errorCount: 0,
        lastError: null,
        customStatus: null,
      });
      if (entry.enabled) {
        await this.startPlugin(plugin);
      }
    }
    this.broadcastState();
  }

  async stop(): Promise<void> {
    for (const plugin of this.plugins) {
      const rec = this.records.get(plugin.id);
      if (rec?.status === "running") {
        await this.stopPlugin(plugin);
      }
    }
  }

  async enable(id: string): Promise<void> {
    const plugin = this.plugins.find((p) => p.id === id);
    const rec = this.records.get(id);
    if (!plugin || !rec) throw new Error(`Unknown module: ${id}`);
    rec.enabled = true;
    if (rec.status !== "running") await this.startPlugin(plugin);
    this.broadcastState();
  }

  async disable(id: string): Promise<void> {
    const plugin = this.plugins.find((p) => p.id === id);
    const rec = this.records.get(id);
    if (!plugin || !rec) throw new Error(`Unknown module: ${id}`);
    rec.enabled = false;
    if (rec.status === "running") await this.stopPlugin(plugin);
    this.broadcastState();
  }

  state(): PluginRecord[] {
    return Array.from(this.records.values()).map((r) => ({ ...r }));
  }

  /** Called by the server when a module emits "admin"/"status". */
  setCustomStatus(moduleId: string, status: string): void {
    const rec = this.records.get(moduleId);
    if (!rec) return;
    rec.customStatus = status;
    this.broadcastState();
  }

  private async startPlugin(plugin: Plugin): Promise<void> {
    const rec = this.records.get(plugin.id)!;
    const ctx = this.makeContext(plugin);
    try {
      await plugin.onStart(ctx);
      if (plugin.onTelemetry) {
        const wrapped = (pkt: TelemetryPacket) => this.callTelemetry(plugin, ctx, pkt);
        const unsub = this.bus.subscribe(wrapped);
        this.unsubscribers.set(plugin.id, unsub);
      }
      rec.status = "running";
      rec.lastError = null;
      this.log.info({ module: plugin.id }, "module started");
    } catch (err) {
      rec.status = "errored";
      rec.lastError = err instanceof Error ? err.message : String(err);
      this.log.error({ module: plugin.id, err }, "module onStart threw");
    }
  }

  private async stopPlugin(plugin: Plugin): Promise<void> {
    const rec = this.records.get(plugin.id)!;
    const unsub = this.unsubscribers.get(plugin.id);
    if (unsub) {
      unsub();
      this.unsubscribers.delete(plugin.id);
    }
    this.unregisterRoutes(plugin.id);
    this.unregisterOverlay(plugin.id);
    try {
      await plugin.onStop();
    } catch (err) {
      this.log.error({ module: plugin.id, err }, "module onStop threw");
    }
    rec.status = "stopped";
    this.log.info({ module: plugin.id }, "module stopped");
  }

  private callTelemetry(plugin: Plugin, ctx: PluginContext, pkt: TelemetryPacket): void {
    if (!plugin.onTelemetry) return;
    try {
      plugin.onTelemetry(pkt, ctx);
    } catch (err) {
      this.recordError(plugin, err);
    }
  }

  private recordError(plugin: Plugin, err: unknown): void {
    const rec = this.records.get(plugin.id)!;
    rec.errorCount++;
    rec.lastError = err instanceof Error ? err.message : String(err);
    this.log.error({ module: plugin.id, err }, "module onTelemetry threw");

    const now = Date.now();
    const ts = this.errorTimestamps.get(plugin.id) ?? [];
    ts.push(now);
    const cutoff = now - this.errorWindowMs;
    const recent = ts.filter((t) => t >= cutoff);
    this.errorTimestamps.set(plugin.id, recent);
    if (recent.length >= this.errorThreshold) {
      this.log.warn(
        { module: plugin.id, recentErrors: recent.length },
        "auto-disabling module due to repeated errors",
      );
      void this.disable(plugin.id).catch(() => {});
    }
  }

  private makeContext(plugin: Plugin): PluginContext {
    return {
      emit: (channel, event, payload) => {
        const rec = this.records.get(plugin.id);
        if (!rec?.enabled) return;
        if (channel === "admin" && event === "status" && typeof payload === "string") {
          this.setCustomStatus(plugin.id, payload);
          return;
        }
        this.emit(plugin.id, channel, event, payload);
      },
      registerRoute: (method, path, handler) => {
        this.registerRoute(plugin.id, method, path, handler);
      },
      registerOverlay: (opts) => {
        this.registerOverlay(plugin.id, opts);
      },
      log: childLogger(this.log, plugin.id),
      config: (this.config[plugin.id]?.config) ?? {},
    };
  }

  private broadcastState(): void {
    this.onStateChange?.(this.state());
  }
}
