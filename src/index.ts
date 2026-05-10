// src/index.ts
import { existsSync, copyFileSync, mkdirSync } from "node:fs";
import { loadConfig, ConfigValidationError } from "./core/config/loadConfig.js";
import { createRootLogger, childLogger } from "./core/logging/logger.js";
import { DirectUDPInput } from "./core/input/DirectUDPInput.js";
import { MockInput } from "./core/input/MockInput.js";
import { fh5DashParser } from "./core/parser/parsers/fh5DashParser.js";
import type { ForzaDashParser } from "./core/parser/parsers/ForzaDashParser.js";
import { TelemetryBus } from "./core/bus/TelemetryBus.js";
import { UDPForwardOutput } from "./core/raw-outputs/UDPForwardOutput.js";
import { RawOutputChain } from "./core/raw-outputs/RawOutputChain.js";
import { Server } from "./core/http/Server.js";
import { PluginHost } from "./core/plugin-host/PluginHost.js";
import { modules as moduleRegistry } from "./modules/index.js";
import type { InputSource } from "./core/input/InputSource.js";
import type { FtsConfig } from "./core/config/types.js";

const CONFIG_PATH = process.env.FTS_CONFIG_PATH ?? "./config.jsonc";
const EXAMPLE_PATH = process.env.FTS_EXAMPLE_PATH ?? "./config.example.jsonc";

async function ensureConfig(): Promise<void> {
  if (!existsSync(CONFIG_PATH)) {
    if (existsSync(EXAMPLE_PATH)) {
      copyFileSync(EXAMPLE_PATH, CONFIG_PATH);
      console.error(`Created default ${CONFIG_PATH} from example — review and restart.`);
    } else {
      console.error(`Missing ${CONFIG_PATH} and no ${EXAMPLE_PATH} to copy from.`);
    }
    process.exit(1);
  }
}

function createInput(cfg: FtsConfig): InputSource {
  if (cfg.input.type === "udp") {
    return new DirectUDPInput({ port: cfg.input.port, host: cfg.input.host });
  }
  return new MockInput({
    file: cfg.input.file, loop: cfg.input.loop, speed: cfg.input.speed,
  });
}

function createParser(cfg: FtsConfig): ForzaDashParser {
  const game = cfg.input.game ?? "fh5";
  switch (game) {
    case "fh5":
      return fh5DashParser;
    case "fh6":
      throw new Error("FH6 parser not yet implemented; set input.game to 'fh5'.");
    default:
      throw new Error(`Unknown input.game: ${game}`);
  }
}

async function main(): Promise<void> {
  await ensureConfig();

  let cfg: FtsConfig;
  try {
    cfg = loadConfig(CONFIG_PATH);
  } catch (err) {
    if (err instanceof ConfigValidationError) {
      console.error(`Invalid config: ${err.message}`);
      process.exit(2);
    }
    throw err;
  }

  mkdirSync(cfg.logging.dir, { recursive: true });
  const rootLog = createRootLogger({ level: cfg.logging.level, pretty: cfg.logging.pretty ?? true });
  const log = childLogger(rootLog, "fts");

  // Raw outputs
  const rawOutputs = cfg.rawOutputs.map(
    (o) => new UDPForwardOutput({ name: o.name, host: o.host, port: o.port, enabled: o.enabled }),
  );
  const rawChain = new RawOutputChain(rawOutputs);

  // Bus
  const bus = new TelemetryBus();

  // Server
  const server = new Server({ port: cfg.http.port, bus, log: childLogger(rootLog, "http") });

  // Plugin host
  const host = new PluginHost({
    plugins: moduleRegistry,
    moduleConfig: cfg.modules ?? {},
    bus,
    log: childLogger(rootLog, "plugin-host"),
    emit: (moduleId, channel, event, payload) => {
      if (channel === "events") server.emitEvent(moduleId, event, payload);
      // "admin"/"status" handled in PluginHost.makeContext
    },
    registerRoute: (moduleId, method, path, handler) => {
      server.registerModuleRoute(moduleId, method, path, handler);
    },
    unregisterRoutes: (moduleId) => server.unregisterModuleRoutes(moduleId),
    onStateChange: (state) => server.updateModuleState(state),
  });
  server.onEnable = (id) => host.enable(id);
  server.onDisable = (id) => host.disable(id);

  // Input
  const input = createInput(cfg);
  const parser = createParser(cfg);
  const inputLog = childLogger(rootLog, "input");

  await server.start();
  await host.start();
  await input.start((raw) => {
    rawChain.send(raw);
    try {
      const pkt = parser.parse(raw, Date.now());
      bus.publish(pkt);
    } catch (err) {
      inputLog.warn({ err, len: raw.length }, "parse error");
    }
  });

  log.info(
    { input: cfg.input.type, game: cfg.input.game ?? "fh5", httpPort: cfg.http.port, modules: moduleRegistry.length },
    "FTS started",
  );

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    log.info({ signal }, "shutting down");
    await input.stop();
    await host.stop();
    await rawChain.shutdown();
    await server.stop();
    rootLog.flush?.();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(3);
});
