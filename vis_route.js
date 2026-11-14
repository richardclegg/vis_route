// @ts-check
/*
 * vis_route core: parse traceroute output, geolocate hops and compute the
 * geometry needed to draw the route on a world map.
 *
 * Nothing in this file touches the DOM, so it runs unchanged in the browser
 * (as the global `VisRoute`) and in Node (via `require`), where it is tested.
 *
 * The types named in the JSDoc comments are declared in globals.d.ts and
 * checked by `npm run typecheck`.
 */
(function () {
  "use strict";

  const GEOLOCATION_TIMEOUT = 10000; // milliseconds

  // Geolocation services, tried in order until one answers. Each must be
  // reachable over HTTPS and send CORS headers, as the lookup is made
  // directly from the page.
  /** @type {Provider[]} */
  const PROVIDERS = [
    {
      name: "ipwho.is",
      url: (ip) => "https://ipwho.is/" + ip,
      parse: (data) =>
        data && data.success === false
          ? null
          : toPlace(data.latitude, data.longitude, data.city, data.country),
    },
    {
      name: "geolocation-db.com",
      url: (ip) => "https://geolocation-db.com/json/" + ip,
      // This service answers "Not found" (a string) for unknown addresses.
      parse: (data) => toPlace(data.latitude, data.longitude, data.city, data.country_name),
    },
  ];

  // A traceroute hop line starts with the hop number; header lines
  // ("traceroute to ...", "Tracing route to ...", "over a maximum of ...")
  // do not, so this keeps the destination IP in the header from being
  // mistaken for a hop. The second alternative matches mtr reports
  // (" 1.|-- 192.168.1.1 ...").
  const HOP_LINE_RE = /^\s*\d+(?:\s|\.\|)/;
  const IPV4_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/;

  // Address blocks that are not globally routable: [network, prefix length].
  /** @type {[network: string, bits: number][]} */
  const NON_PUBLIC_BLOCKS_TEXT = [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.0.2.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["198.51.100.0", 24],
    ["203.0.113.0", 24],
    ["224.0.0.0", 4],
    ["240.0.0.0", 4],
  ];
  /** @type {[network: number, bits: number][]} */
  const NON_PUBLIC_BLOCKS = NON_PUBLIC_BLOCKS_TEXT.map(([network, bits]) => [ipToInt(network) ?? 0, bits]);

  /**
   * Return the address as an unsigned 32-bit integer, or null if invalid.
   * @param {string} ip
   * @returns {number | null}
   */
  function ipToInt(ip) {
    const parts = String(ip).split(".");
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

  /**
   * True if `ip` is a globally routable IPv4 address worth geolocating.
   * @param {string} ip
   * @returns {boolean}
   */
  function isPublic(ip) {
    const value = ipToInt(ip);
    if (value === null) return false;
    return !NON_PUBLIC_BLOCKS.some(
      ([network, bits]) => Math.floor(value / 2 ** (32 - bits)) === Math.floor(network / 2 ** (32 - bits))
    );
  }

  /**
   * Return the IP address of every answering hop in traceroute output.
   *
   * Accepts the whole output as one string or as an array of lines, from
   * Unix traceroute, Windows tracert or an mtr report. Hops where every
   * probe timed out ("* * *" / "Request timed out.") yield nothing.
   * @param {string | string[]} output
   * @returns {string[]}
   */
  function hopIps(output) {
    const lines = Array.isArray(output) ? output : String(output).split(/\r?\n/);
    const ips = [];
    for (const line of lines) {
      if (!HOP_LINE_RE.test(line)) continue;
      const match = IPV4_RE.exec(line);
      if (match) ips.push(match[0]);
    }
    return ips;
  }

  /**
   * Build a place from the loosely typed fields of a service's answer.
   * @param {unknown} latitude
   * @param {unknown} longitude
   * @param {unknown} city
   * @param {unknown} country
   * @returns {Place | null}
   */
  function toPlace(latitude, longitude, city, country) {
    if (latitude === null || latitude === undefined || latitude === "") return null;
    const lat = Number(latitude);
    const lon = Number(longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    if (lat === 0 && lon === 0) return null;
    const label = [city, country].filter((s) => typeof s === "string" && s && s !== "Not found").join(", ");
    return { lat, lon, label };
  }

  /**
   * Create a geolocation function `locate(ip)` that resolves to
   * `{lat, lon, label}`, or to null if the address cannot be located.
   *
   * Private, loopback and other non-public addresses are never looked up.
   * Results are cached so repeated hops cost one request each. `fetchImpl`
   * and `onWarning` can be replaced for testing.
   * @param {LocatorOptions} [options]
   * @returns {Locate}
   */
  function createLocator(options) {
    const opts = options || {};
    const fetchImpl = opts.fetch || ((url, init) => fetch(url, init));
    const providers = opts.providers || PROVIDERS;
    const timeout = opts.timeout || GEOLOCATION_TIMEOUT;
    const onWarning = opts.onWarning || (() => {});
    /** @type {Map<string, Promise<Place | null>>} */
    const cache = new Map();

    /**
     * @param {string} ip
     * @returns {Promise<Place | null>}
     */
    async function lookup(ip) {
      for (const provider of providers) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);
        try {
          const response = await fetchImpl(provider.url(ip), { signal: controller.signal });
          if (!response.ok) throw new Error("HTTP " + response.status);
          return provider.parse(await response.json());
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          onWarning("geolocation lookup failed for " + ip + " at " + provider.name + ": " + reason);
        } finally {
          clearTimeout(timer);
        }
      }
      return null;
    }

    return function locate(ip) {
      if (!isPublic(ip)) return Promise.resolve(null);
      let result = cache.get(ip);
      if (!result) {
        result = lookup(ip);
        cache.set(ip, result);
      }
      return result;
    };
  }

  /**
   * Return [lon, lat] points along the great circle between two places.
   *
   * Uses spherical linear interpolation; longitudes are in [-180, 180].
   * @param {number} lon1
   * @param {number} lat1
   * @param {number} lon2
   * @param {number} lat2
   * @param {number} [npoints] number of steps along the path (default 200)
   * @returns {LonLat[]}
   */
  function greatCirclePoints(lon1, lat1, lon2, lat2, npoints) {
    const n = npoints || 200;
    const rad = Math.PI / 180;
    /** @type {(lon: number, lat: number) => [number, number, number]} */
    const toVector = (lon, lat) => [
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
    /** @type {LonLat[]} */
    const points = [];
    for (let step = 0; step <= n; step++) {
      const t = step / n;
      const ka = Math.sin((1 - t) * omega) / Math.sin(omega);
      const kb = Math.sin(t * omega) / Math.sin(omega);
      const x = ka * a[0] + kb * b[0];
      const y = ka * a[1] + kb * b[1];
      const z = ka * a[2] + kb * b[2];
      points.push([Math.atan2(y, x) / rad, Math.atan2(z, Math.hypot(x, y)) / rad]);
    }
    return points;
  }

  /**
   * Split a [lon, lat] path into pieces wherever it crosses the 180° meridian.
   * @param {LonLat[]} points
   * @returns {LonLat[][]}
   */
  function splitAtDateline(points) {
    /** @type {LonLat[][]} */
    const segments = points.length ? [[points[0]]] : [];
    for (let i = 1; i < points.length; i++) {
      if (Math.abs(points[i][0] - points[i - 1][0]) > 180) segments.push([]);
      segments[segments.length - 1].push(points[i]);
    }
    return segments;
  }

  /**
   * Miller cylindrical projection (the one the original Basemap version
   * used). Returns a function mapping (lon, lat) in degrees to [x, y] in a
   * `width`-wide image, with `project.height` giving the image height.
   * @param {number} width
   * @returns {Projection}
   */
  function millerProjection(width) {
    const rad = Math.PI / 180;
    const scale = width / (2 * Math.PI);
    const millerY = (/** @type {number} */ lat) => 1.25 * Math.log(Math.tan(Math.PI / 4 + 0.4 * lat * rad));
    const top = millerY(90);
    /** @type {(lon: number, lat: number) => [number, number]} */
    const project = (lon, lat) => [(lon * rad + Math.PI) * scale, (top - millerY(lat)) * scale];
    return Object.assign(project, { height: 2 * top * scale });
  }

  /**
   * Decode one object of a TopoJSON topology into a flat list of polygon
   * rings, each an array of [lon, lat] points.
   * @param {Topology} topology
   * @param {string} objectName
   * @returns {LonLat[][]}
   */
  function topologyRings(topology, objectName) {
    const { scale, translate } = topology.transform || { scale: [1, 1], translate: [0, 0] };
    const arcs = topology.arcs.map((arc) => {
      let x = 0;
      let y = 0;
      return arc.map(([dx, dy]) => {
        x += dx;
        y += dy;
        return /** @type {LonLat} */ ([x * scale[0] + translate[0], y * scale[1] + translate[1]]);
      });
    });

    /** @param {number[]} arcIndexes */
    function ring(arcIndexes) {
      /** @type {LonLat[]} */
      const points = [];
      for (const index of arcIndexes) {
        const arc = index < 0 ? arcs[~index].slice().reverse() : arcs[index];
        // Consecutive arcs share an endpoint; keep it only once.
        for (let i = points.length ? 1 : 0; i < arc.length; i++) points.push(arc[i]);
      }
      return points;
    }

    /** @type {LonLat[][]} */
    const rings = [];
    /** @param {TopoGeometry} geometry */
    function collect(geometry) {
      if (geometry.type === "GeometryCollection") {
        geometry.geometries.forEach(collect);
      } else if (geometry.type === "Polygon") {
        geometry.arcs.forEach((r) => rings.push(ring(r)));
      } else if (geometry.type === "MultiPolygon") {
        geometry.arcs.forEach((polygon) => polygon.forEach((r) => rings.push(ring(r))));
      }
    }
    collect(topology.objects[objectName]);
    return rings;
  }

  /**
   * Make a polygon ring that crosses the 180° meridian drawable on a flat map.
   *
   * Longitudes are made continuous (so they may leave [-180, 180]) and a
   * ring that circles a pole, like Antarctica, is closed along that pole.
   * Returns `{points, wraps}`; when `wraps` is true the ring must also be
   * drawn shifted by ±360° to appear at both edges of the map.
   * @param {LonLat[]} ring
   * @returns {{points: LonLat[], wraps: boolean}}
   */
  function unwrapRing(ring) {
    let offset = 0;
    let wraps = false;
    const points = ring.map(([lon, lat], i) => {
      if (i) {
        const delta = lon - ring[i - 1][0];
        if (Math.abs(delta) > 180) {
          offset -= Math.sign(delta) * 360;
          wraps = true;
        }
      }
      return /** @type {LonLat} */ ([lon + offset, lat]);
    });
    if (points.length && Math.abs(offset) > 180) {
      const pole = points.reduce((sum, p) => sum + p[1], 0) < 0 ? -90 : 90;
      points.push([points[points.length - 1][0], pole], [points[0][0], pole]);
    }
    return { points, wraps };
  }

  /**
   * Geolocate the hops of a trace, in order.
   *
   * Consecutive hops that resolve to the same coordinates become a single
   * entry of `hops` listing all their addresses, since they would be drawn
   * on top of each other. The result also counts why hops did not get an
   * entry of their own. `onHop` is called each time an entry is added
   * (`isNew` true) or gains an address (`isNew` false).
   * @param {string[]} ips
   * @param {Locate} locate
   * @param {(hop: Hop, hops: Hop[], isNew: boolean) => void} [onHop]
   * @returns {Promise<LocatedRoute>}
   */
  async function locateHops(ips, locate, onHop) {
    /** @type {Hop[]} */
    const hops = [];
    const result = { hops, total: ips.length, private: 0, unlocated: 0, merged: 0 };
    for (const ip of ips) {
      const place = await locate(ip);
      if (!place) {
        if (isPublic(ip)) result.unlocated++;
        else result.private++;
        continue;
      }
      const last = hops[hops.length - 1];
      if (last && last.lat === place.lat && last.lon === place.lon) {
        result.merged++;
        if (!last.ips.includes(ip)) last.ips.push(ip);
        if (onHop) onHop(last, hops, false);
        continue;
      }
      const hop = { ip, ips: [ip], lat: place.lat, lon: place.lon, label: place.label };
      hops.push(hop);
      if (onHop) onHop(hop, hops, true);
    }
    return result;
  }

  /**
   * If `text` is just a destination (an IPv4 address or a hostname) rather
   * than traceroute output, return that destination; otherwise null.
   * @param {string} text
   * @returns {string | null}
   */
  function bareTarget(text) {
    const target = text.trim();
    if (ipToInt(target) !== null) return target;
    // Labels of letters, digits and hyphens joined by at least one dot.
    return /^(?!-)[A-Za-z0-9-]{1,63}(?<!-)(\.(?!-)[A-Za-z0-9-]{1,63}(?<!-))+\.?$/.test(target) ? target : null;
  }

  const api = {
    PROVIDERS,
    hopIps,
    bareTarget,
    isPublic,
    createLocator,
    locateHops,
    greatCirclePoints,
    splitAtDateline,
    millerProjection,
    topologyRings,
    unwrapRing,
  };

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    Object.assign(globalThis, { VisRoute: api });
  }
})();
