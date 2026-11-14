# vis_route

A simple visualiser that runs `traceroute` to a host and draws the route it
takes across a world map, using IP geolocation for each hop. It runs on
Linux, macOS and Windows.

## Usage

Give it an IPv4 address or hostname (e.g. the University of Tokyo web server):

```
./vis_route.py 210.152.243.234
```

Options:

```
usage: vis_route.py [-h] [-m MAX_HOPS] [-o FILE] target

  -m, --max-hops MAX_HOPS   maximum number of hops to probe (default: 25)
  -o, --output FILE         save the map to FILE (e.g. route.png) instead of showing it
```

The traceroute output is echoed as it arrives, then the map window opens
(or the file is written) once the trace finishes. Hops on private networks
(e.g. `192.168.x.x`) and hops that do not answer are skipped.

Geolocation uses https://geolocation-db.com; the accuracy of the plotted
points is only as good as that database.

## Installation

You need `traceroute` (Linux/macOS, usually in the `traceroute` package) or
`tracert` (built into Windows), plus the Python dependencies:

```
pip install -r requirements.txt
```

That installs [matplotlib](https://matplotlib.org/) and
[basemap](https://matplotlib.org/basemap/) for drawing the map.

## Tests

```
python3 -m unittest test_vis_route
```
