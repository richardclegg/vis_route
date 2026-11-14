// @ts-check
/* Page behaviour for vis_route: wires the form to the map. */
(function () {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";
  const WIDTH = 1000;
  const MAX_ZOOM = 40;
  const HOP_RADIUS = 4.5; // in screen-ish units at zoom 1

  const project = VisRoute.millerProjection(WIDTH);
  const HEIGHT = project.height;
  const locate = VisRoute.createLocator({ onWarning: (message) => console.warn(message) });

  /** A rectangle of the map, in the SVG's own coordinates. @typedef {{x: number, y: number, w: number, h: number}} View */

  /**
   * Find an element of the page by id, checking that it is of the expected kind.
   * @template {Element} T
   * @param {string} id
   * @param {new () => T} type
   * @returns {T}
   */
  function $(id, type) {
    const element = document.getElementById(id);
    if (!(element instanceof type)) throw new Error("index.html has no " + type.name + " with id " + id);
    return element;
  }

  const map = $("map", SVGSVGElement);
  const traceInput = $("trace", HTMLTextAreaElement);
  const plotButton = $("plot", HTMLButtonElement);
  const saveButton = $("save", HTMLButtonElement);
  const statusLine = $("status", HTMLElement);
  const hopList = $("hops", HTMLElement);
  const routesLayer = $("routes", SVGGElement);
  const markersLayer = $("markers", SVGGElement);

  /** @type {View} */
  let view = { x: 0, y: 0, w: WIDTH, h: HEIGHT };
  /** @type {Hop[]} */
  let currentHops = [];
  let run = 0; // identifies the latest "Plot route" click

  // ---------------------------------------------------------------- map --

  /**
   * SVG path data for a line through the given places.
   * @param {LonLat[]} points
   */
  function pathData(points) {
    return points
      .map(([lon, lat], i) => {
        const [x, y] = project(lon, lat);
        return (i ? "L" : "M") + x.toFixed(2) + " " + y.toFixed(2);
      })
      .join("");
  }

  function drawWorld() {
    const ocean = $("ocean", SVGRectElement);
    ocean.setAttribute("width", String(WIDTH));
    ocean.setAttribute("height", String(HEIGHT));
    /** @type {(points: LonLat[], degrees: number) => LonLat[]} */
    const shifted = (points, degrees) => points.map(([lon, lat]) => [lon + degrees, lat]);
    let d = "";
    for (const ring of VisRoute.topologyRings(WORLD_TOPOLOGY, "countries")) {
      const { points, wraps } = VisRoute.unwrapRing(ring);
      // A shape crossing the 180° meridian shows up at both edges of the map.
      for (const degrees of wraps ? [-360, 0, 360] : [0]) d += pathData(shifted(points, degrees)) + "Z";
    }
    $("land", SVGPathElement).setAttribute("d", d);
  }

  /** @param {View} next */
  function setView(next) {
    const w = Math.min(WIDTH, Math.max(WIDTH / MAX_ZOOM, next.w));
    const h = (w * HEIGHT) / WIDTH;
    // Keep the centre the caller asked for, then clamp to the map.
    const cx = next.x + next.w / 2;
    const cy = next.y + next.h / 2;
    view = {
      x: Math.min(WIDTH - w, Math.max(0, cx - w / 2)),
      y: Math.min(HEIGHT - h, Math.max(0, cy - h / 2)),
      w,
      h,
    };
    map.setAttribute("viewBox", [view.x, view.y, view.w, view.h].join(" "));
    // Markers keep the same on-screen size at every zoom level.
    const radius = (HOP_RADIUS * view.w) / WIDTH;
    for (const marker of markersLayer.children) marker.setAttribute("r", String(radius));
  }

  /**
   * @param {number} factor below 1 zooms in, above 1 zooms out
   * @param {{x: number, y: number}} [centre] the point to keep in place
   */
  function zoomBy(factor, centre) {
    const c = centre || { x: view.x + view.w / 2, y: view.y + view.h / 2 };
    const w = Math.min(WIDTH, Math.max(WIDTH / MAX_ZOOM, view.w * factor));
    const k = w / view.w;
    // Keep the point under the cursor where it is.
    setView({ x: c.x - (c.x - view.x) * k, y: c.y - (c.y - view.y) * k, w, h: view.h * k });
  }

  function fitRoute() {
    if (!currentHops.length) {
      setView({ x: 0, y: 0, w: WIDTH, h: HEIGHT });
      return;
    }
    // Fit the drawn route (not just the hops: a great circle can arc well
    // north or south of both of its ends).
    const box = routesLayer.children.length ? routesLayer.getBBox() : null;
    const points = currentHops.map((hop) => project(hop.lon, hop.lat));
    let minX = Math.min(...points.map((p) => p[0]));
    let maxX = Math.max(...points.map((p) => p[0]));
    let minY = Math.min(...points.map((p) => p[1]));
    let maxY = Math.max(...points.map((p) => p[1]));
    if (box && box.width + box.height > 0) {
      minX = Math.min(minX, box.x);
      maxX = Math.max(maxX, box.x + box.width);
      minY = Math.min(minY, box.y);
      maxY = Math.max(maxY, box.y + box.height);
    }
    const margin = 1.25;
    const w = Math.max((maxX - minX) * margin, (maxY - minY) * margin * (WIDTH / HEIGHT), WIDTH / 8);
    const h = (w * HEIGHT) / WIDTH;
    setView({ x: (minX + maxX) / 2 - w / 2, y: (minY + maxY) / 2 - h / 2, w, h });
  }

  /** @param {MouseEvent} event */
  function svgPoint(event) {
    const rect = map.getBoundingClientRect();
    return {
      x: view.x + ((event.clientX - rect.left) / rect.width) * view.w,
      y: view.y + ((event.clientY - rect.top) / rect.height) * view.h,
    };
  }

  function setupInteraction() {
    map.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        zoomBy(event.deltaY < 0 ? 0.8 : 1.25, svgPoint(event));
      },
      { passive: false }
    );

    /** @type {{clientX: number, clientY: number, x: number, y: number} | null} */
    let drag = null;
    map.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      drag = { clientX: event.clientX, clientY: event.clientY, x: view.x, y: view.y };
      map.setPointerCapture(event.pointerId);
      map.classList.add("dragging");
    });
    map.addEventListener("pointermove", (event) => {
      if (!drag) return;
      const rect = map.getBoundingClientRect();
      setView({
        x: drag.x - ((event.clientX - drag.clientX) / rect.width) * view.w,
        y: drag.y - ((event.clientY - drag.clientY) / rect.height) * view.h,
        w: view.w,
        h: view.h,
      });
    });
    const endDrag = () => {
      drag = null;
      map.classList.remove("dragging");
    };
    map.addEventListener("pointerup", endDrag);
    map.addEventListener("pointercancel", endDrag);

    $("zoom-in", HTMLButtonElement).addEventListener("click", () => zoomBy(0.6));
    $("zoom-out", HTMLButtonElement).addEventListener("click", () => zoomBy(1 / 0.6));
    $("zoom-fit", HTMLButtonElement).addEventListener("click", fitRoute);
  }

  // -------------------------------------------------------------- route --

  /** @param {Hop} hop */
  function describe(hop) {
    const addresses = hop.ips.join(", ");
    return hop.label ? addresses + " – " + hop.label : addresses;
  }

  /**
   * Show the addresses and place of a hop in its marker tooltip and list entry.
   * @param {Hop} hop
   * @param {number} index
   */
  function labelHop(hop, index) {
    const title = markersLayer.children[index]?.querySelector("title");
    if (title) title.textContent = index + 1 + ". " + describe(hop);

    const text = hopList.children[index]?.firstElementChild;
    if (!text) return;
    const lines = hop.ips.map((address) => {
      const line = document.createElement("span");
      line.className = "ip";
      line.textContent = address;
      return line;
    });
    const place = document.createElement("span");
    place.className = "place";
    place.textContent = hop.label || hop.lat.toFixed(2) + ", " + hop.lon.toFixed(2);
    text.replaceChildren(...lines, place);
  }

  /**
   * "3 locations from 9 hops: 3 on private networks, …"
   * @param {LocatedRoute} result
   */
  function summarise(result) {
    const places = result.hops.length;
    const reasons = [];
    if (result.private) reasons.push(result.private + " on private networks");
    if (result.unlocated) reasons.push(result.unlocated + " could not be located");
    if (result.merged) reasons.push(result.merged + " at the same location as the hop before");
    return (
      places + " location" + (places === 1 ? "" : "s") + " from " + result.total + " hops" +
      (reasons.length ? ": " + reasons.join(", ") : "") + "."
    );
  }

  /**
   * @param {number} index
   * @param {boolean} active
   */
  function setActive(index, active) {
    const marker = markersLayer.children[index];
    const item = hopList.children[index];
    if (marker) marker.classList.toggle("active", active);
    if (item) item.classList.toggle("active", active);
  }

  /**
   * Draw the newest hop: its marker, the line from the previous hop and its list entry.
   * @param {Hop} hop
   * @param {Hop[]} hops all hops located so far, ending with `hop`
   */
  function addHop(hop, hops) {
    const index = hops.length - 1;
    const previous = hops[index - 1];
    if (previous) {
      const path = VisRoute.greatCirclePoints(previous.lon, previous.lat, hop.lon, hop.lat);
      for (const segment of VisRoute.splitAtDateline(path)) {
        if (segment.length < 2) continue;
        const line = document.createElementNS(SVG_NS, "path");
        line.setAttribute("class", "route");
        line.setAttribute("d", pathData(segment));
        routesLayer.appendChild(line);
      }
    }

    const [x, y] = project(hop.lon, hop.lat);
    const marker = document.createElementNS(SVG_NS, "circle");
    marker.setAttribute("class", "hop");
    marker.setAttribute("cx", x.toFixed(2));
    marker.setAttribute("cy", y.toFixed(2));
    marker.setAttribute("r", String((HOP_RADIUS * view.w) / WIDTH));
    marker.appendChild(document.createElementNS(SVG_NS, "title"));
    markersLayer.appendChild(marker);

    const item = document.createElement("li");
    item.tabIndex = 0;
    item.appendChild(document.createElement("span"));
    hopList.appendChild(item);
    labelHop(hop, index);

    for (const element of [marker, item]) {
      element.addEventListener("pointerenter", () => setActive(index, true));
      element.addEventListener("pointerleave", () => setActive(index, false));
    }
    item.addEventListener("focus", () => setActive(index, true));
    item.addEventListener("blur", () => setActive(index, false));
  }

  /**
   * @param {string} message
   * @param {boolean} [isError]
   */
  function setStatus(message, isError) {
    statusLine.textContent = message;
    statusLine.classList.toggle("error", Boolean(isError));
  }

  function clearRoute() {
    routesLayer.replaceChildren();
    markersLayer.replaceChildren();
    hopList.replaceChildren();
    currentHops = [];
    saveButton.disabled = true;
  }

  async function plot() {
    const thisRun = ++run;
    clearRoute();
    setView({ x: 0, y: 0, w: WIDTH, h: HEIGHT });

    const ips = VisRoute.hopIps(traceInput.value);
    if (!ips.length) {
      const target = VisRoute.bareTarget(traceInput.value);
      let message = "Paste the output of traceroute or tracert first.";
      if (target) {
        // An address was typed in, as if the page could run the trace itself.
        message =
          target + " is a destination, not traceroute output. This page cannot run the trace for you: run " +
          "\"traceroute -n " + target + "\" (Linux, macOS) or \"tracert -d " + target + "\" (Windows) " +
          "in a terminal, then paste everything it prints here.";
      } else if (traceInput.value.trim()) {
        message = "No hops found. Paste the full output of traceroute or tracert, including the numbered lines.";
      }
      setStatus(message, true);
      return;
    }

    plotButton.disabled = true;
    setStatus("Locating " + ips.length + " hops…");
    try {
      // Hops are only drawn while this is still the latest run.
      /** @type {(hop: Hop, hops: Hop[], isNew: boolean) => void} */
      const onHop = (hop, hops, isNew) => {
        if (thisRun !== run) return;
        currentHops = hops;
        if (isNew) addHop(hop, hops);
        else labelHop(hop, hops.length - 1);
        setStatus("Locating " + ips.length + " hops… " + hops.length + " found");
      };
      const result = await VisRoute.locateHops(ips, locate, onHop);
      if (thisRun !== run) return;

      if (!result.hops.length) {
        const allPrivate = ips.every((ip) => !VisRoute.isPublic(ip));
        setStatus(
          allPrivate
            ? "Every hop is on a private network, so there is nothing to place on the map."
            : "No hop could be geolocated. The lookup service may be unreachable or blocked by the browser.",
          true
        );
        return;
      }
      setStatus(summarise(result));
      saveButton.disabled = false;
      fitRoute();
    } finally {
      if (thisRun === run) plotButton.disabled = false;
    }
  }

  function saveSvg() {
    const copy = /** @type {SVGSVGElement} */ (map.cloneNode(true));
    copy.setAttribute("viewBox", [0, 0, WIDTH, HEIGHT].join(" "));
    copy.setAttribute("width", String(WIDTH));
    copy.setAttribute("height", String(Math.round(HEIGHT)));
    copy.removeAttribute("id");
    copy.removeAttribute("class");
    for (const marker of copy.querySelectorAll(".hop")) {
      marker.setAttribute("r", String(HOP_RADIUS));
      marker.classList.remove("active");
    }
    const source = '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(copy);
    const url = URL.createObjectURL(new Blob([source], { type: "image/svg+xml" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "route.svg";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  drawWorld();
  setView(view);
  setupInteraction();
  plotButton.addEventListener("click", plot);
  saveButton.addEventListener("click", saveSvg);
  traceInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) plot();
  });
})();
