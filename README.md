# vis_route

A simple visualiser that draws the route a `traceroute` takes across a world
map, using IP geolocation for each hop. It runs entirely in the browser: there
is nothing to install and no server.

## Usage

1. Open `index.html` in a browser (double-clicking the file is enough), or
   serve this folder from any static web host.
2. Run a traceroute in a terminal, e.g. to the University of Tokyo web server:

   ```
   traceroute -n 210.152.243.234      # Linux, macOS
   tracert -d 210.152.243.234         # Windows
   ```

3. Paste the output into the page and press **Plot route** (or Ctrl/⌘+Enter).

A web page is not allowed to send the low-level packets traceroute needs, which
is why the trace itself is run in a terminal. Output from Unix `traceroute`,
Windows `tracert` and `mtr --report` is understood.

Each located hop is drawn as a dot, and consecutive hops are joined by great
circles. Hops on private networks (e.g. `192.168.x.x` or an ISP's internal
`100.64.x.x` range) and hops that do not answer are skipped, and consecutive
hops that the geolocation service places at the same spot share one dot, so a
route usually shows fewer dots than it has hops. The line under the buttons
says how many hops fell into each group, and the list shows every address
behind each dot. Scroll to zoom, drag to pan, and use **Save SVG** to
download the map as `route.svg`.

## Geolocation and privacy

The public IP addresses in the pasted output are sent from your browser to
https://ipwho.is to look up their locations, falling back to
https://geolocation-db.com if that is unreachable. Private addresses are never
sent. The accuracy of the plotted points is only as good as those databases.

To use a different service, edit `PROVIDERS` at the top of `vis_route.js`; it
must be reachable over HTTPS and allow cross-origin requests (CORS).

## Files

- `index.html`, `style.css`, `app.js` – the page.
- `vis_route.js` – parsing, geolocation and map geometry, with no dependency
  on the page.
- `world.js` – country outlines from
  [world-atlas](https://github.com/topojson/world-atlas) (Natural Earth data).
- `globals.d.ts`, `jsconfig.json` – type declarations and settings for the
  type check; the browser never loads them.

## Development

The page is plain JavaScript with no build step: edit a file and reload.

The tests need [Node.js](https://nodejs.org/) 20 or later and no other
packages:

```
npm test
```

The scripts are also type-checked by the TypeScript compiler, using the JSDoc
comments in the code and the types in `globals.d.ts`. This needs a one-off
`npm install`:

```
npm install
npm run typecheck
```

Editors with TypeScript support (such as VS Code) show the same errors as you
type.
