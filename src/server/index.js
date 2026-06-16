#!/usr/bin/env node

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DemoDashboardProvider } from "./providers/demo-dashboard-provider.js";
import { DashboardService as TrackunitDashboardProvider, loadLocalEnv } from "./services/trackunit-dashboard-service.js";

const APP_ROOT = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(APP_ROOT, "../..");
const DIST_ROOT = path.join(PROJECT_ROOT, "dist");
const DEFAULT_PORT = 8765;
const DEFAULT_LOOKBACK_HOURS = 14 * 24;

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
};

function parseArgs(argv) {
  const args = {
    host: process.env.HOST || "127.0.0.1",
    port: DEFAULT_PORT,
    provider: process.env.GOLF_CART_PROVIDER || "demo",
    lookbackHours: DEFAULT_LOOKBACK_HOURS,
    maxAssets: 38,
    locationHistoryPages: 8,
    aempIdentifierAttempts: 5,
    timeout: 45,
    cacheSeconds: 120,
    fakeCarts: false,
  };

  const flagMap = {
    "--host": ["host", String],
    "--port": ["port", Number],
    "--provider": ["provider", String],
    "--lookback-hours": ["lookbackHours", Number],
    "--max-assets": ["maxAssets", Number],
    "--location-history-pages": ["locationHistoryPages", Number],
    "--aemp-identifier-attempts": ["aempIdentifierAttempts", Number],
    "--timeout": ["timeout", Number],
    "--cache-seconds": ["cacheSeconds", Number],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--demo") {
      args.provider = "demo";
      continue;
    }
    if (flag === "--trackunit") {
      args.provider = "trackunit";
      continue;
    }
    if (flag === "--fake-carts") {
      args.fakeCarts = true;
      continue;
    }
    if (flag === "--no-fake-carts") {
      args.fakeCarts = false;
      continue;
    }
    if (!flagMap[flag]) throw new Error(`Unknown argument: ${flag}`);

    const value = argv[index + 1];
    if (value === undefined) throw new Error(`Missing value for ${flag}`);

    const [key, caster] = flagMap[flag];
    const parsed = caster(value);
    if (caster === Number && !Number.isFinite(parsed)) {
      throw new Error(`Expected a number for ${flag}`);
    }
    args[key] = parsed;
    index += 1;
  }

  const normalizedProvider = String(args.provider || "").toLowerCase();
  if (!["demo", "trackunit"].includes(normalizedProvider)) {
    throw new Error("Provider must be either 'demo' or 'trackunit'.");
  }
  args.provider = normalizedProvider;
  return args;
}

function sendJson(response, payload, status = 200) {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Length": body.length,
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(body);
}

async function sendStatic(response, requestPath) {
  if (!existsSync(DIST_ROOT)) {
    sendJson(response, { error: "React build not found. Run npm run build before npm start." }, 404);
    return;
  }

  const pathname = requestPath === "/" ? "/index.html" : decodeURIComponent(requestPath);
  const requested = path.resolve(DIST_ROOT, `.${pathname}`);
  const indexFile = path.join(DIST_ROOT, "index.html");

  // A path escape would otherwise let a crafted URL read outside dist.
  if (!requested.startsWith(DIST_ROOT)) {
    sendJson(response, { error: "Not found" }, 404);
    return;
  }

  const filePath = existsSync(requested) ? requested : indexFile;
  if (!existsSync(filePath)) {
    sendJson(response, { error: "React build not found. Run npm run build before npm start." }, 404);
    return;
  }

  const body = await readFile(filePath);
  response.writeHead(200, {
    "Content-Length": body.length,
    "Content-Type": MIME_TYPES[path.extname(filePath)] || "application/octet-stream",
  });
  response.end(body);
}

function createProvider(args) {
  if (args.provider === "trackunit") {
    return new TrackunitDashboardProvider(args);
  }
  return new DemoDashboardProvider(args);
}

function createApp(provider, args) {
  return createServer(async (request, response) => {
    const url = new URL(request.url || "/", `http://${args.host}:${args.port}`);

    if (request.method === "GET" && url.pathname === "/api/health") {
      sendJson(response, {
        ok: true,
        app: "Golf Cart Tracker",
        provider: args.provider,
        generated_at: new Date().toISOString(),
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/dashboard") {
      try {
        const payload = await provider.dashboard({ forceRefresh: url.searchParams.get("refresh") === "1" });
        sendJson(response, payload);
      } catch (error) {
        sendJson(response, { error: error.message || String(error) }, 500);
      }
      return;
    }

    if (request.method !== "GET") {
      sendJson(response, { error: "Method not allowed" }, 405);
      return;
    }

    await sendStatic(response, url.pathname);
  });
}

async function main() {
  loadLocalEnv(PROJECT_ROOT);
  const args = parseArgs(process.argv.slice(2));
  const provider = createProvider(args);
  const server = createApp(provider, args);

  server.listen(args.port, args.host, () => {
    console.log(`Golf Cart Tracker running at http://${args.host}:${args.port}/ (${args.provider} provider)`);
  });
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
