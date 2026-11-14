/**
 * Core logic for vis_route: building the traceroute command, parsing its
 * output, geolocating hops and computing great-circle paths.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { createInterface } from "node:readline";

export const GEOLOCATION_URL = "https://geolocation-db.com/json/";
export const GEOLOCATION_TIMEOUT_MS = 10_000;
export const MAX_HOPS = 25;

/** A (longitude, latitude) pair in degrees. */
export type LonLat = [lon: number, lat: number];

/** A geolocated hop. */
export interface Hop {
  ip: string;
  lat: number;
  lon: number;
}

// A traceroute hop line starts with the hop number; header lines
// ("traceroute to ...", "Tracing route to ...", "over a maximum of ...")
// do not, so this keeps the destination IP in the header from being
// mistaken for a hop.
const HOP_LINE_RE = /^\s*\d+\s/;
const IPV4_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/;
// Hostnames: labels of letters, digits and hyphens joined by dots.
const HOSTNAME_RE = /^(?!-)[A-Za-z0-9-]{1,63}(?<!-)(\.(?!-)[A-Za-z0-9-]{1,63}(?<!-))*\.?$/;

/** Parse a dotted-quad IPv4 address into a 32-bit number, or null. */
function parseIPv4(text: string): number | null {
  const parts = text.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

/** Return `target` if it is an IPv4 address or hostname, else throw. */
export function validateTarget(target: string): string {
  if (parseIPv4(target) !== null || HOSTNAME_RE.test(target)) return target;
  throw new Error(`'${target}' is not a valid IPv4 address or hostname`);
}

/** Find an executable on PATH, like `which`. */
function which(name: string): string | null {
  const extensions = process.platform === "win32" ? [".exe", ".cmd", ""] : [""];
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    for (const ext of extensions) {
      const candidate = join(dir, name + ext);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * Build the traceroute command line for the current platform.
 *
 * The command is returned as an argument list so that it is run without a
 * shell and the target can never be interpreted as shell syntax.
 */
export function tracerouteCommand(
  target: string,
  maxHops: number = MAX_HOPS,
  platform: NodeJS.Platform = process.platform,
): string[] {
  if (platform === "win32") {
    const exe = which("tracert") ?? "C:\\Windows\\System32\\TRACERT.exe";
    // -d: do not resolve names, -4: force IPv4.
    return [exe, "-h", String(maxHops), "-d", "-4", target];
  }
  const exe = which("traceroute");
  if (exe === null) throw new Error("traceroute is not installed or not on PATH");
  // -n: numeric output only (no reverse DNS), which keeps the hop lines
  // simple and makes the run much faster.
  return [exe, "-m", String(maxHops), "-n", target];
}

/**
 * Return the IP address of every answering hop in traceroute output.
 *
 * Works for both Unix traceroute and Windows tracert output. Hops where
 * every probe timed out ("* * *" / "Request timed out.") yield nothing.
 */
export function hopIps(lines: Iterable<string>): string[] {
  const ips: string[] = [];
  for (const line of lines) {
    if (!HOP_LINE_RE.test(line)) continue;
    const match = IPV4_RE.exec(line);
    if (match) ips.push(match[0]);
  }
  return ips;
}

// Address blocks that are not globally routable: [network, prefix length].
const NON_PUBLIC_BLOCKS: Array<[string, number]> = [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // TEST-NET-1
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // TEST-NET-2
  ["203.0.113.0", 24], // TEST-NET-3
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved and broadcast
];

/** True if `ip` is a globally routable IPv4 address worth geolocating. */
export function isPublic(ip: string): boolean {
  const value = parseIPv4(ip);
  if (value === null) return false;
  return !NON_PUBLIC_BLOCKS.some(([network, prefix]) => {
    const size = 2 ** (32 - prefix);
    const base = parseIPv4(network)!;
    return value >= base && value < base + size;
  });
}

const locationCache = new Map<string, Promise<[lat: number, lon: number] | null>>();

async function lookUp(ip: string): Promise<[number, number] | null> {
  let data: unknown;
  try {
    const response = await fetch(GEOLOCATION_URL + encodeURIComponent(ip), {
      signal: AbortSignal.timeout(GEOLOCATION_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    data = await response.json();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`warning: geolocation lookup failed for ${ip}: ${reason}`);
    return null;
  }
  const record = (data ?? {}) as Record<string, unknown>;
  // The service answers "Not found" (a string) for unknown addresses.
  if (typeof record.latitude !== "number" || typeof record.longitude !== "number") return null;
  const { latitude: lat, longitude: lon } = record;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat === 0 && lon === 0) return null;
  return [lat, lon];
}

/**
 * Return [latitude, longitude] for `ip`, or null if it cannot be located.
 *
 * Private, loopback and other non-public addresses are never looked up.
 * Results are cached so repeated hops cost one request each.
 */
export function getLocation(ip: string): Promise<[lat: number, lon: number] | null> {
  if (!isPublic(ip)) return Promise.resolve(null);
  let cached = locationCache.get(ip);
  if (!cached) {
    cached = lookUp(ip);
    locationCache.set(ip, cached);
  }
  return cached;
}

/**
 * Return points along the great circle between two places.
 *
 * Uses spherical linear interpolation; longitudes are in [-180, 180].
 */
export function greatCirclePoints(
  lon1: number,
  lat1: number,
  lon2: number,
  lat2: number,
  npoints = 200,
): LonLat[] {
  const rad = Math.PI / 180;
  const toVector = (lon: number, lat: number): [number, number, number] => [
    Math.cos(lat * rad) * Math.cos(lon * rad),
    Math.cos(lat * rad) * Math.sin(lon * rad),
    Math.sin(lat * rad),
  ];
  const a = toVector(lon1, lat1);
  const b = toVector(lon2, lat2);
  const dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  const omega = Math.acos(dot);
  if (omega < 1e-9) {
    return [
      [lon1, lat1],
      [lon2, lat2],
    ];
  }
  const points: LonLat[] = [];
  for (let step = 0; step <= npoints; step++) {
    const t = step / npoints;
    const ka = Math.sin((1 - t) * omega) / Math.sin(omega);
    const kb = Math.sin(t * omega) / Math.sin(omega);
    const x = ka * a[0] + kb * b[0];
    const y = ka * a[1] + kb * b[1];
    const z = ka * a[2] + kb * b[2];
    points.push([Math.atan2(y, x) / rad, Math.atan2(z, Math.hypot(x, y)) / rad]);
  }
  return points;
}

/** Split a path into pieces wherever it crosses the 180° meridian. */
export function splitAtDateline(points: LonLat[]): LonLat[][] {
  const segments: LonLat[][] = [];
  let previous: LonLat | undefined;
  for (const current of points) {
    if (previous === undefined || Math.abs(current[0] - previous[0]) > 180) segments.push([]);
    segments[segments.length - 1]!.push(current);
    previous = current;
  }
  return segments;
}

/**
 * Run traceroute, echo its output, and return the located hops.
 *
 * Hops are returned in order, with consecutive hops that resolve to the
 * same coordinates collapsed into one.
 */
export async function runTraceroute(target: string, maxHops: number = MAX_HOPS): Promise<Hop[]> {
  const [exe, ...args] = tracerouteCommand(target, maxHops);
  const child = spawn(exe!, args, { stdio: ["ignore", "pipe", "pipe"] });
  const exited = new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  child.stderr.pipe(process.stderr);

  const hops: Hop[] = [];
  for await (const line of createInterface({ input: child.stdout })) {
    console.log(line);
    for (const ip of hopIps([line])) {
      const location = await getLocation(ip);
      if (location === null) continue;
      const [lat, lon] = location;
      const last = hops[hops.length - 1];
      if (last && last.lat === lat && last.lon === lon) continue;
      hops.push({ ip, lat, lon });
    }
  }
  const status = await exited;
  if (status) console.error(`warning: traceroute exited with status ${status}`);
  return hops;
}
