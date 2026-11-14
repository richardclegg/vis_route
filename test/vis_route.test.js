// Unit tests for the parts of vis_route that need no browser or network.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const VisRoute = require("../vis_route.js");

const LINUX_OUTPUT = `traceroute to 210.152.243.234 (210.152.243.234), 25 hops max, 60 byte packets
 1  192.168.1.1  0.412 ms  0.391 ms  0.384 ms
 2  * * *
 3  * 81.2.69.142  12.1 ms  12.3 ms
 4  203.0.113.7  20.0 ms 203.0.113.9  21.0 ms  22.0 ms
 5  210.152.243.234  180.0 ms  181.0 ms  182.0 ms
`;

const WINDOWS_OUTPUT = `\r
Tracing route to 210.152.243.234 over a maximum of 25 hops\r
\r
  1    <1 ms    <1 ms    <1 ms  192.168.1.1\r
  2     *        *        *     Request timed out.\r
  3    12 ms    12 ms    13 ms  81.2.69.142\r
  4   180 ms   181 ms   182 ms  210.152.243.234\r
\r
Trace complete.\r
`;

const MTR_OUTPUT = `Start: 2024-01-01T00:00:00+0000
HOST: laptop                      Loss%   Snt   Last   Avg  Best  Wrst StDev
  1.|-- 192.168.1.1                0.0%    10    0.4   0.4   0.3   0.5   0.0
  2.|-- ???                       100.0    10    0.0   0.0   0.0   0.0   0.0
  3.|-- 81.2.69.142                0.0%    10   12.1  12.2  12.0  12.5   0.1
`;

function close(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} is not close to ${expected}`);
}

test("hop parsing: Linux output", () => {
  assert.deepEqual(VisRoute.hopIps(LINUX_OUTPUT), ["192.168.1.1", "81.2.69.142", "203.0.113.7", "210.152.243.234"]);
});

test("hop parsing: Windows output", () => {
  assert.deepEqual(VisRoute.hopIps(WINDOWS_OUTPUT), ["192.168.1.1", "81.2.69.142", "210.152.243.234"]);
});

test("hop parsing: mtr report", () => {
  assert.deepEqual(VisRoute.hopIps(MTR_OUTPUT), ["192.168.1.1", "81.2.69.142"]);
});

test("hop parsing: header IP is not a hop", () => {
  assert.deepEqual(VisRoute.hopIps("traceroute to 8.8.8.8 (8.8.8.8), 25 hops max, 60 byte packets"), []);
});

test("hop parsing: blank lines are ignored, arrays of lines are accepted", () => {
  assert.deepEqual(VisRoute.hopIps(["", "   ", "\n"]), []);
  assert.deepEqual(VisRoute.hopIps([" 1  8.8.8.8  1 ms"]), ["8.8.8.8"]);
});

test("private and special addresses are not public", () => {
  const addresses = [
    "10.0.0.1", "192.168.1.1", "172.16.0.1", "172.31.255.255", "127.0.0.1", "0.0.0.0",
    "100.64.0.1", "169.254.1.1", "203.0.113.7", "224.0.0.1", "255.255.255.255",
    "not-an-ip", "999.1.1.1", "1.2.3", "",
  ];
  for (const ip of addresses) assert.equal(VisRoute.isPublic(ip), false, ip);
});

test("public addresses", () => {
  for (const ip of ["8.8.8.8", "81.2.69.142", "172.32.0.1", "100.128.0.1", "223.255.255.1"]) {
    assert.equal(VisRoute.isPublic(ip), true, ip);
  }
});

function fakeFetch(responses, calls) {
  return async (url) => {
    calls.push(url);
    const body = responses[url];
    if (body === undefined) throw new Error("unreachable");
    return { ok: true, status: 200, json: async () => body };
  };
}

test("locator: private address is never looked up", async () => {
  const calls = [];
  const locate = VisRoute.createLocator({ fetch: fakeFetch({}, calls) });
  assert.equal(await locate("192.168.1.1"), null);
  assert.deepEqual(calls, []);
});

test("locator: parses and caches a result", async () => {
  const calls = [];
  const responses = {
    "https://ipwho.is/8.8.8.8": { success: true, latitude: 37.4, longitude: -122.1, city: "Mountain View", country: "United States" },
  };
  const locate = VisRoute.createLocator({ fetch: fakeFetch(responses, calls) });
  const expected = { lat: 37.4, lon: -122.1, label: "Mountain View, United States" };
  assert.deepEqual(await locate("8.8.8.8"), expected);
  assert.deepEqual(await locate("8.8.8.8"), expected);
  assert.equal(calls.length, 1);
});

test("locator: falls back to the next provider when one is unreachable", async () => {
  const calls = [];
  const warnings = [];
  const responses = {
    "https://geolocation-db.com/json/8.8.8.8": { latitude: 37.4, longitude: -122.1, city: null, country_name: "United States" },
  };
  const locate = VisRoute.createLocator({ fetch: fakeFetch(responses, calls), onWarning: (m) => warnings.push(m) });
  assert.deepEqual(await locate("8.8.8.8"), { lat: 37.4, lon: -122.1, label: "United States" });
  assert.equal(calls.length, 2);
  assert.equal(warnings.length, 1);
});

test("locator: unknown addresses resolve to null", async () => {
  const responses = {
    "https://ipwho.is/8.8.8.8": { success: false, message: "Reserved range" },
    "https://ipwho.is/8.8.4.4": { success: true, latitude: 0, longitude: 0 },
    "https://ipwho.is/1.1.1.1": { success: true, latitude: "Not found", longitude: "Not found" },
  };
  const locate = VisRoute.createLocator({ fetch: fakeFetch(responses, []) });
  for (const ip of ["8.8.8.8", "8.8.4.4", "1.1.1.1"]) assert.equal(await locate(ip), null, ip);
});

test("locateHops: skips unlocatable hops and merges repeated places", async () => {
  const places = {
    "81.2.69.142": { lat: 51.5, lon: -0.1, label: "London" },
    "81.2.69.143": { lat: 51.5, lon: -0.1, label: "London" },
    "210.152.243.234": { lat: 35.7, lon: 139.7, label: "Tokyo" },
  };
  const seen = [];
  const result = await VisRoute.locateHops(
    ["192.168.1.1", "100.120.101.128", "81.2.69.142", "81.2.69.143", "9.9.9.9", "210.152.243.234"],
    async (ip) => places[ip] || null,
    (hop, hops, isNew) => seen.push([hop.ip, isNew])
  );
  assert.deepEqual(result.hops.map((hop) => hop.ips), [["81.2.69.142", "81.2.69.143"], ["210.152.243.234"]]);
  assert.deepEqual(seen, [["81.2.69.142", true], ["81.2.69.142", false], ["210.152.243.234", true]]);
  assert.equal(result.total, 6);
  assert.equal(result.private, 2);
  assert.equal(result.unlocated, 1);
  assert.equal(result.merged, 1);
});

test("great circle: endpoints are preserved", () => {
  const points = VisRoute.greatCirclePoints(-0.1, 51.5, -122.1, 37.4);
  close(points[0][0], -0.1);
  close(points[0][1], 51.5);
  close(points[points.length - 1][0], -122.1);
  close(points[points.length - 1][1], 37.4);
});

test("great circle: London to California arcs north", () => {
  const points = VisRoute.greatCirclePoints(-0.1, 51.5, -122.1, 37.4);
  assert.ok(Math.max(...points.map((p) => p[1])) > 60);
  assert.ok(points.every(([lon]) => lon >= -180 && lon <= 180));
});

test("great circle: identical points", () => {
  assert.deepEqual(VisRoute.greatCirclePoints(10, 20, 10, 20), [[10, 20], [10, 20]]);
});

test("dateline: Pacific crossing is split once", () => {
  const points = VisRoute.greatCirclePoints(-122.1, 37.4, 139.7, 35.7);
  const segments = VisRoute.splitAtDateline(points);
  assert.equal(segments.length, 2);
  assert.equal(segments.reduce((n, s) => n + s.length, 0), points.length);
});

test("dateline: Atlantic crossing is not split", () => {
  const points = VisRoute.greatCirclePoints(-0.1, 51.5, -122.1, 37.4);
  assert.equal(VisRoute.splitAtDateline(points).length, 1);
});

test("dateline: empty path", () => {
  assert.deepEqual(VisRoute.splitAtDateline([]), []);
});

test("Miller projection maps the world onto the image", () => {
  const project = VisRoute.millerProjection(1000);
  close(project(-180, 90)[0], 0);
  close(project(-180, 90)[1], 0);
  close(project(180, -90)[0], 1000);
  close(project(180, -90)[1], project.height);
  close(project(0, 0)[0], 500);
  close(project(0, 0)[1], project.height / 2);
  assert.ok(Math.abs(project.height - 733.2) < 0.1);
});

test("topology decoding: delta-encoded arcs, reversed arcs and shared endpoints", () => {
  const topology = {
    transform: { scale: [2, 3], translate: [10, 20] },
    arcs: [
      [[0, 0], [1, 0], [0, 1]], // (0,0) (1,0) (1,1)
      [[0, 0], [0, 1], [1, 0]], // (0,0) (0,1) (1,1)
    ],
    objects: {
      shapes: {
        type: "GeometryCollection",
        geometries: [
          { type: "Polygon", arcs: [[0, -2]] },
          { type: "MultiPolygon", arcs: [[[1]]] },
        ],
      },
    },
  };
  assert.deepEqual(VisRoute.topologyRings(topology, "shapes"), [
    [[10, 20], [12, 20], [12, 23], [10, 23], [10, 20]],
    [[10, 20], [10, 23], [12, 23]],
  ]);
});

test("unwrapRing: ordinary rings are unchanged", () => {
  const ring = [[0, 0], [10, 0], [10, 10], [0, 0]];
  assert.deepEqual(VisRoute.unwrapRing(ring), { points: ring, wraps: false });
});

test("unwrapRing: a ring crossing the dateline becomes continuous", () => {
  const ring = [[170, 0], [-170, 0], [-170, 10], [170, 10], [170, 0]];
  assert.deepEqual(VisRoute.unwrapRing(ring), {
    points: [[170, 0], [190, 0], [190, 10], [170, 10], [170, 0]],
    wraps: true,
  });
});

test("unwrapRing: a ring circling the south pole is closed along the pole", () => {
  const ring = [[-180, -80], [-60, -70], [60, -70], [180, -80], [-180, -80]];
  const { points, wraps } = VisRoute.unwrapRing(ring);
  assert.equal(wraps, true);
  assert.deepEqual(points.slice(-3), [[180, -80], [180, -90], [-180, -90]]);
});

test("bareTarget: recognises a lone address or hostname", () => {
  assert.equal(VisRoute.bareTarget("8.8.8.8"), "8.8.8.8");
  assert.equal(VisRoute.bareTarget("  example.com\n"), "example.com");
});

test("bareTarget: traceroute output and other text are not a target", () => {
  for (const text of ["", " 1  8.8.8.8  1 ms", "hello", "two words.com x", "8.8.8.8\n1.1.1.1", "<b>.com"]) {
    assert.equal(VisRoute.bareTarget(text), null, text);
  }
});
