// Types shared by the scripts of the page, and the globals they define.
// Only used for type checking (`npm run typecheck`); the browser never loads it.

/** A [longitude, latitude] pair in degrees. */
type LonLat = [lon: number, lat: number];

/** Where an IP address is, as far as a geolocation service knows. */
interface Place {
  lat: number;
  lon: number;
  /** "City, Country", or an empty string if unknown. */
  label: string;
}

/** A geolocated hop of the route. */
interface Hop extends Place {
  /** The first address found at this place. */
  ip: string;
  /** Every consecutive hop address found at this place, starting with `ip`. */
  ips: string[];
}

/** The outcome of locating the hops of a trace. */
interface LocatedRoute {
  /** One entry per place, in route order. */
  hops: Hop[];
  /** Number of answering hops in the trace. */
  total: number;
  /** Hops on private networks, which are never looked up. */
  private: number;
  /** Public hops the geolocation services could not place. */
  unlocated: number;
  /** Hops at the same place as the hop before them, merged into it. */
  merged: number;
}

/** A geolocation service that can be queried directly from the page. */
interface Provider {
  name: string;
  url(ip: string): string;
  /** Turn the service's JSON answer into a place, or null if it has none. */
  parse(data: any): Place | null;
}

/** Looks up an address; resolves to null if it cannot be located. */
type Locate = (ip: string) => Promise<Place | null>;

interface LocatorOptions {
  fetch?: (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;
  providers?: Provider[];
  /** Milliseconds to wait for each provider. */
  timeout?: number;
  onWarning?: (message: string) => void;
}

/** Maps (lon, lat) in degrees to [x, y] image coordinates. */
interface Projection {
  (lon: number, lat: number): [x: number, y: number];
  /** Height of the image, for the width the projection was created with. */
  height: number;
}

type TopoGeometry =
  | { type: "GeometryCollection"; geometries: TopoGeometry[] }
  | { type: "Polygon"; arcs: number[][] }
  | { type: "MultiPolygon"; arcs: number[][][] };

/** The parts of a TopoJSON topology that the map uses. */
interface Topology {
  type?: string;
  transform?: { scale: number[]; translate: number[] };
  arcs: number[][][];
  objects: Record<string, TopoGeometry>;
}

/** The core library, defined by vis_route.js. */
declare const VisRoute: typeof import("./vis_route.js");

/** Country outlines, defined by world.js. */
declare const WORLD_TOPOLOGY: Topology;
