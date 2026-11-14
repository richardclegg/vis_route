#!/usr/bin/env node
/**
 * Visualise a traceroute on a world map.
 *
 * Runs the system traceroute (or tracert on Windows) against a target,
 * geolocates every hop that answers with a public IP address, and draws the
 * path between consecutive hops as great circles on a world map.
 */

import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

import { renderMap } from "./map.js";
import { MAX_HOPS, runTraceroute, validateTarget } from "./vis_route.js";

const USAGE = `usage: vis-route [-h] [-m MAX_HOPS] [-o FILE] target

Run traceroute to a host and draw the route on a world map.

positional arguments:
  target                    IPv4 address or hostname to trace, e.g. 210.152.243.234

options:
  -h, --help                show this help message and exit
  -m, --max-hops MAX_HOPS   maximum number of hops to probe (default: ${MAX_HOPS})
  -o, --output FILE         save the map to FILE (e.g. route.svg) instead of
                            opening it in the browser
`;

function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

function usageError(message: string): never {
  console.error(USAGE.split("\n")[0]);
  console.error(`error: ${message}`);
  process.exit(2);
}

/** Open `file` with the system's default viewer (normally the browser). */
function openFile(file: string): void {
  const [command, args] =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", "", file]]
      : process.platform === "darwin"
        ? ["open", [file]]
        : ["xdg-open", [file]];
  const child = spawn(command as string, args as string[], { stdio: "ignore", detached: true });
  child.on("error", () => console.error("Could not open the map automatically; open the file above in a browser."));
  child.unref();
}

async function main(): Promise<void> {
  let parsed;
  try {
    parsed = parseArgs({
      allowPositionals: true,
      options: {
        help: { type: "boolean", short: "h" },
        "max-hops": { type: "string", short: "m" },
        output: { type: "string", short: "o" },
      },
    });
  } catch (error) {
    usageError((error as Error).message);
  }
  const { values, positionals } = parsed;
  if (values.help) {
    process.stdout.write(USAGE);
    return;
  }
  if (positionals.length !== 1) usageError("exactly one target is required");

  let target: string;
  try {
    target = validateTarget(positionals[0]!);
  } catch (error) {
    usageError((error as Error).message);
  }
  const maxHopsText = values["max-hops"] ?? String(MAX_HOPS);
  if (!/^\d+$/.test(maxHopsText) || Number(maxHopsText) < 1) {
    usageError("--max-hops must be a whole number of at least 1");
  }

  process.on("SIGINT", () => {
    console.error("\ninterrupted");
    process.exit(130);
  });

  let hops;
  try {
    hops = await runTraceroute(target, Number(maxHopsText));
  } catch (error) {
    fail((error as Error).message);
  }
  if (hops.length === 0) fail("no hop could be geolocated, nothing to plot");

  const svg = renderMap(hops, target);
  if (values.output) {
    writeFileSync(values.output, svg);
    console.log(`Map saved to ${values.output}`);
  } else {
    const file = join(tmpdir(), `vis-route-${target.replace(/[^A-Za-z0-9.-]/g, "_")}.svg`);
    writeFileSync(file, svg);
    console.log(`Map saved to ${resolve(file)}`);
    openFile(file);
  }
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
