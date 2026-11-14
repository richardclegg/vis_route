/**
 * Draws the route as a self-contained SVG world map (Miller projection).
 * No native libraries are needed, so it works wherever Node.js does.
 */

import { createRequire } from "node:module";

import { greatCirclePoints, splitAtDateline, type Hop, type LonLat } from "./vis_route.js";

const WIDTH = 1000;
const TITLE_HEIGHT = 36;

/** Miller cylindrical projection, in radians-scaled units. */
function millerY(lat: number): number {
  return 1.25 * Math.log(Math.tan(Math.PI / 4 + 0.4 * ((lat * Math.PI) / 180)));
}

const Y_MAX = millerY(90);
const SCALE = WIDTH / (2 * Math.PI);
const MAP_HEIGHT = Math.round(2 * Y_MAX * SCALE);

/** Project (lon, lat) in degrees to SVG pixel coordinates. */
export function project([lon, lat]: LonLat): [x: number, y: number] {
  return [((lon + 180) / 360) * WIDTH, (Y_MAX - millerY(lat)) * SCALE];
}

// Just enough of the TopoJSON format to read the world-atlas country shapes.
interface Topology {
  transform: { scale: [number, number]; translate: [number, number] };
  arcs: Array<Array<[number, number]>>;
  objects: Record<string, { geometries: Geometry[] }>;
}
type Geometry =
  | { type: "Polygon"; arcs: number[][] }
  | { type: "MultiPolygon"; arcs: number[][][] };

/** Decode every country outline in the atlas into rings of (lon, lat). */
function landRings(): LonLat[][] {
  const require = createRequire(import.meta.url);
  const topology = require("world-atlas/countries-110m.json") as Topology;
  const { scale, translate } = topology.transform;

  // Arcs are delta-encoded integer coordinates.
  const arcs = topology.arcs.map((arc) => {
    let x = 0;
    let y = 0;
    return arc.map(([dx, dy]): LonLat => {
      x += dx;
      y += dy;
      return [x * scale[0] + translate[0], y * scale[1] + translate[1]];
    });
  });

  const ring = (indexes: number[]): LonLat[] =>
    indexes.flatMap((index, position) => {
      // A negative index means the arc is used in reverse.
      const points = index < 0 ? [...arcs[~index]!].reverse() : arcs[index]!;
      return position === 0 ? points : points.slice(1);
    });

  return topology.objects.countries!.geometries.flatMap((geometry) =>
    geometry.type === "Polygon"
      ? geometry.arcs.map(ring)
      : geometry.arcs.flatMap((polygon) => polygon.map(ring)),
  );
}

function pathData(points: LonLat[], close: boolean): string {
  const data = points
    .map((point, index) => {
      const [x, y] = project(point);
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join("");
  return close ? data + "Z" : data;
}

function escapeXml(text: string): string {
  return text.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]!);
}

/** Render `hops` on a world map and return the SVG document as a string. */
export function renderMap(hops: Hop[], target: string): string {
  const land = landRings()
    .map((ring) => pathData(ring, true))
    .join("");

  const routes: string[] = [];
  for (let i = 1; i < hops.length; i++) {
    const from = hops[i - 1]!;
    const to = hops[i]!;
    for (const segment of splitAtDateline(greatCirclePoints(from.lon, from.lat, to.lon, to.lat))) {
      if (segment.length > 1) routes.push(pathData(segment, false));
    }
  }

  const markers = hops.map((hop, index) => {
    const [x, y] = project([hop.lon, hop.lat]);
    const label = `Hop ${index + 1}: ${hop.ip} (${hop.lat.toFixed(2)}, ${hop.lon.toFixed(2)})`;
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5"><title>${escapeXml(label)}</title></circle>`;
  });

  const title = `Route to ${target} (${hops.length} located hop${hops.length === 1 ? "" : "s"})`;
  const height = MAP_HEIGHT + TITLE_HEIGHT;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${height}" width="${WIDTH}" height="${height}" font-family="sans-serif">
<rect width="${WIDTH}" height="${height}" fill="#ffffff"/>
<text x="${WIDTH / 2}" y="24" text-anchor="middle" font-size="16">${escapeXml(title)}</text>
<g transform="translate(0,${TITLE_HEIGHT})">
<rect width="${WIDTH}" height="${MAP_HEIGHT}" fill="#cfe3f1"/>
<path d="${land}" fill="#e9e4d4" stroke="#b5ad98" stroke-width="0.4" stroke-linejoin="round"/>
<path d="${routes.join("")}" fill="none" stroke="#1f5fd0" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
<g fill="#d62728" stroke="#ffffff" stroke-width="0.8">
${markers.join("\n")}
</g>
</g>
</svg>
`;
}
