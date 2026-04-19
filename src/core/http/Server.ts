// src/core/http/Server.ts
import express, { type Express } from "express";
import { createServer, type Server as HttpServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { AddressInfo } from "node:net";
import type { TelemetryBus } from "../bus/TelemetryBus.js";
import type { Logger } from "../logging/logger.js";
import type { HttpMethod, RouteHandler } from "../plugin-host/Plugin.js";
import type { PluginRecord } from "../plugin-host/PluginHost.js";

export interface ServerOptions {
  port: number;
  bus: TelemetryBus;
  log: Logger;
}

type ModuleRoute = { method: HttpMethod; path: string; handler: RouteHandler; moduleId: string };

export class Server {
  private app: Express;
  private http: HttpServer;
  private wss: WebSocketServer;
  private wssEvents: WebSocketServer;
  private wssAdmin: WebSocketServer;
  private bus: TelemetryBus;
  private log: Logger;
  private cfgPort: number;
  private packetsReceived = 0;
  private startedAt = Date.now();
  private moduleRoutes: ModuleRoute[] = [];
  private disabledModules = new Set<string>();
  // State broadcast to admin clients
  private currentModuleState: PluginRecord[] = [];
  // Enable/disable callbacks wired from outside
  onEnable: (id: string) => Promise<void> = async () => {};
  onDisable: (id: string) => Promise<void> = async () => {};

  constructor(opts: ServerOptions) {
    this.app = express();
    this.app.use(express.json());
    this.bus = opts.bus;
    this.log = opts.log;
    this.cfgPort = opts.port;

    this.http = createServer(this.app);
    // Three WS endpoints, attached in the "upgrade" handler below
    this.wss = new WebSocketServer({ noServer: true });       // /telemetry
    this.wssEvents = new WebSocketServer({ noServer: true }); // /events
    this.wssAdmin = new WebSocketServer({ noServer: true });  // /admin

    this.setupRoutes();
    this.setupUpgrade();
    this.setupBusForwarding();
  }

  async start(): Promise<void> {
    await new Promise<void>((resolve) => this.http.listen(this.cfgPort, () => resolve()));
  }

  async stop(): Promise<void> {
    this.wss.clients.forEach((c) => c.terminate());
    this.wssEvents.clients.forEach((c) => c.terminate());
    this.wssAdmin.clients.forEach((c) => c.terminate());
    await new Promise<void>((resolve) => this.http.close(() => resolve()));
  }

  address(): AddressInfo | null {
    return this.http.address() as AddressInfo | null;
  }

  /** Called by bootstrap after PluginHost starts. */
  updateModuleState(state: PluginRecord[]): void {
    this.currentModuleState = state;
    const disabled = new Set<string>();
    for (const r of state) if (!r.enabled || r.status !== "running") disabled.add(r.id);
    this.disabledModules = disabled;
    // Broadcast to admin WS
    const msg = JSON.stringify({ type: "module-state", modules: state });
    this.wssAdmin.clients.forEach((c) => {
      if (c.readyState === WebSocket.OPEN) c.send(msg);
    });
  }

  registerModuleRoute(moduleId: string, method: HttpMethod, path: string, handler: RouteHandler): void {
    const normalized = path.startsWith("/") ? path : `/${path}`;
    this.moduleRoutes.push({ moduleId, method, path: normalized, handler });
  }

  unregisterModuleRoutes(moduleId: string): void {
    this.moduleRoutes = this.moduleRoutes.filter((r) => r.moduleId !== moduleId);
  }

  emitEvent(moduleId: string, event: string, payload: unknown): void {
    if (this.disabledModules.has(moduleId)) return;
    const msg = JSON.stringify({
      type: "event",
      source: moduleId,
      event,
      timestamp: Date.now(),
      payload,
    });
    this.wssEvents.clients.forEach((c) => {
      if (c.readyState === WebSocket.OPEN) c.send(msg);
    });
  }

  private setupRoutes(): void {
    this.app.get("/health", (_req, res) => {
      res.json({
        status: "ok",
        uptimeMs: Date.now() - this.startedAt,
        packetsReceived: this.packetsReceived,
      });
    });

    this.app.get("/telemetry/latest", (_req, res) => {
      const pkt = this.bus.lastPacket();
      if (!pkt) { res.status(204).end(); return; }
      res.json(pkt);
    });

    this.app.get("/modules", (_req, res) => {
      res.json(this.currentModuleState);
    });

    this.app.post("/modules/:id/enable", async (req, res) => {
      try {
        await this.onEnable(req.params.id);
        res.json({ ok: true });
      } catch (err) {
        res.status(400).json({ error: (err as Error).message });
      }
    });

    this.app.post("/modules/:id/disable", async (req, res) => {
      try {
        await this.onDisable(req.params.id);
        res.json({ ok: true });
      } catch (err) {
        res.status(400).json({ error: (err as Error).message });
      }
    });

    // Module-registered routes: match against moduleRoutes
    this.app.use(async (req, res, next) => {
      const route = this.moduleRoutes.find(
        (r) => r.method === req.method && r.path === req.path,
      );
      if (!route) { next(); return; }
      if (this.disabledModules.has(route.moduleId)) {
        res.status(503).json({ error: `Module ${route.moduleId} is disabled` });
        return;
      }
      try {
        await route.handler(req, res);
      } catch (err) {
        this.log.error({ err, moduleId: route.moduleId }, "module route threw");
        if (!res.headersSent) {
          res.status(500).json({ error: `Module ${route.moduleId} route error` });
        }
      }
    });
  }

  private setupUpgrade(): void {
    this.http.on("upgrade", (req, socket, head) => {
      const url = req.url ?? "";
      if (url === "/telemetry") {
        this.wss.handleUpgrade(req, socket, head, (ws) => this.wss.emit("connection", ws, req));
      } else if (url === "/events") {
        this.wssEvents.handleUpgrade(req, socket, head, (ws) => this.wssEvents.emit("connection", ws, req));
      } else if (url === "/admin") {
        this.wssAdmin.handleUpgrade(req, socket, head, (ws) => {
          this.wssAdmin.emit("connection", ws, req);
          // Send initial state snapshot to new admin client
          ws.send(JSON.stringify({ type: "module-state", modules: this.currentModuleState }));
        });
      } else {
        socket.destroy();
      }
    });
  }

  private setupBusForwarding(): void {
    this.bus.subscribe((pkt) => {
      this.packetsReceived++;
      const msg = JSON.stringify({ type: "telemetry", timestamp: pkt.timestamp, data: pkt });
      this.wss.clients.forEach((c) => {
        if (c.readyState === WebSocket.OPEN) c.send(msg);
      });
    });
  }
}
