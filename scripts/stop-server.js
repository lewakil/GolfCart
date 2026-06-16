#!/usr/bin/env node

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// Reads the port to stop; defaults to the dashboard port.
function parseArgs(argv) {
  const args = { port: 8765 };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag !== "--port") throw new Error(`Unknown argument: ${flag}`);
    const value = Number(argv[index + 1]);
    if (!Number.isFinite(value)) throw new Error("Expected a number for --port");
    args.port = value;
    index += 1;
  }

  return args;
}

// Finds server process IDs that are listening on the requested port.
async function listeningPids(port) {
  // npm stop just finds whatever is listening on the dashboard port and asks it to quit.
  try {
    const { stdout } = await execFileAsync("lsof", [`-tiTCP:${port}`, "-sTCP:LISTEN"]);
    return [...new Set(stdout.split(/\s+/).filter(Boolean))];
  } catch (error) {
    if (error.code === 1) return [];
    throw error;
  }
}

// Stops the dashboard process if it is running.
async function main() {
  const { port } = parseArgs(process.argv.slice(2));
  const pids = await listeningPids(port);

  if (!pids.length) {
    console.log(`No dashboard server is listening on port ${port}.`);
    return;
  }

  for (const pid of pids) {
    // SIGTERM is the polite stop. No need for a harder kill here.
    process.kill(Number(pid), "SIGTERM");
  }

  console.log(`Stopped dashboard server on port ${port}: ${pids.join(", ")}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
