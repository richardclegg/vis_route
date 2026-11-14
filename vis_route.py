#!/usr/bin/env python3
"""Visualise a traceroute on a world map.

Runs the system traceroute (or tracert on Windows) against a target,
geolocates every hop that answers with a public IP address, and draws the
path between consecutive hops as great circles on a world map.
"""

import argparse
import functools
import ipaddress
import json
import math
import platform
import re
import shutil
import subprocess
import sys
import urllib.error
import urllib.request

GEOLOCATION_URL = "https://geolocation-db.com/json/{ip}"
GEOLOCATION_TIMEOUT = 10  # seconds
MAX_HOPS = 25

# A traceroute hop line starts with the hop number; header lines
# ("traceroute to ...", "Tracing route to ...", "over a maximum of ...")
# do not, so this keeps the destination IP in the header from being
# mistaken for a hop.
_HOP_LINE_RE = re.compile(r"^\s*\d+\s")
_IPV4_RE = re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")
# Hostnames: labels of letters, digits and hyphens joined by dots.
_HOSTNAME_RE = re.compile(r"^(?!-)[A-Za-z0-9-]{1,63}(?<!-)(\.(?!-)[A-Za-z0-9-]{1,63}(?<!-))*\.?$")


def validate_target(target):
    """Return *target* if it is an IPv4 address or hostname, else raise ValueError."""
    try:
        ipaddress.IPv4Address(target)
        return target
    except ipaddress.AddressValueError:
        pass
    if _HOSTNAME_RE.match(target):
        return target
    raise ValueError("'%s' is not a valid IPv4 address or hostname" % target)


def traceroute_command(target, max_hops=MAX_HOPS):
    """Build the traceroute command line for the current platform.

    The command is returned as a list so that it is run without a shell
    and the target can never be interpreted as shell syntax.
    """
    system = platform.system()
    if system in ("Linux", "Darwin"):
        exe = shutil.which("traceroute")
        if exe is None:
            raise FileNotFoundError("traceroute is not installed or not on PATH")
        # -n: numeric output only (no reverse DNS), which keeps the hop
        # lines simple and makes the run much faster.
        return [exe, "-m", str(max_hops), "-n", target]
    if system == "Windows":
        exe = shutil.which("tracert") or r"C:\Windows\System32\TRACERT.exe"
        # -d: do not resolve names, -4: force IPv4.
        return [exe, "-h", str(max_hops), "-d", "-4", target]
    raise OSError("Unsupported operating system: %s" % system)


def hop_ips(lines):
    """Yield the IP address of every answering hop in traceroute output.

    Works for both Unix traceroute and Windows tracert output. Hops where
    every probe timed out ("* * *" / "Request timed out.") yield nothing.
    """
    for line in lines:
        if not _HOP_LINE_RE.match(line):
            continue
        match = _IPV4_RE.search(line)
        if match:
            yield match.group(0)


def is_public(ip):
    """True if *ip* is a globally routable address worth geolocating."""
    try:
        return ipaddress.ip_address(ip).is_global
    except ValueError:
        return False


@functools.lru_cache(maxsize=None)
def get_location(ip):
    """Return (latitude, longitude) for *ip*, or None if it cannot be located.

    Private, loopback and other non-public addresses are never looked up.
    Results are cached so repeated hops cost one request each.
    """
    if not is_public(ip):
        return None
    url = GEOLOCATION_URL.format(ip=ip)
    try:
        with urllib.request.urlopen(url, timeout=GEOLOCATION_TIMEOUT) as response:
            encoding = response.info().get_content_charset("utf8")
            data = json.loads(response.read().decode(encoding))
    except (urllib.error.URLError, OSError, ValueError) as exc:
        print("warning: geolocation lookup failed for %s: %s" % (ip, exc), file=sys.stderr)
        return None
    try:
        lat = float(data["latitude"])
        lon = float(data["longitude"])
    except (KeyError, TypeError, ValueError):
        # The service answers "Not found" (a string) for unknown addresses.
        return None
    if lat == 0.0 and lon == 0.0:
        return None
    return (lat, lon)


def great_circle_points(lon1, lat1, lon2, lat2, npoints=200):
    """Return (lon, lat) points along the great circle between two places.

    Uses spherical linear interpolation; longitudes are in [-180, 180].
    """
    def to_vector(lon, lat):
        lon, lat = math.radians(lon), math.radians(lat)
        return (math.cos(lat) * math.cos(lon), math.cos(lat) * math.sin(lon), math.sin(lat))

    a = to_vector(lon1, lat1)
    b = to_vector(lon2, lat2)
    dot = max(-1.0, min(1.0, sum(i * j for i, j in zip(a, b))))
    omega = math.acos(dot)
    if omega < 1e-9:
        return [(lon1, lat1), (lon2, lat2)]
    points = []
    for step in range(npoints + 1):
        t = step / npoints
        ka = math.sin((1 - t) * omega) / math.sin(omega)
        kb = math.sin(t * omega) / math.sin(omega)
        x, y, z = (ka * i + kb * j for i, j in zip(a, b))
        points.append((math.degrees(math.atan2(y, x)), math.degrees(math.atan2(z, math.hypot(x, y)))))
    return points


def split_at_dateline(points):
    """Split a (lon, lat) path into pieces wherever it crosses the 180° meridian.

    Basemap's own drawgreatcircle mis-detects crossings at high latitudes
    and leaves gaps in the line, so the split is done here on longitudes.
    """
    segments = [[points[0]]] if points else []
    for previous, current in zip(points, points[1:]):
        if abs(current[0] - previous[0]) > 180:
            segments.append([])
        segments[-1].append(current)
    return segments


def run_traceroute(target, max_hops=MAX_HOPS):
    """Run traceroute, echo its output, and return the located hops.

    Returns a list of (ip, lat, lon) tuples in hop order, with consecutive
    hops that resolve to the same coordinates collapsed into one.
    """
    cmd = traceroute_command(target, max_hops)
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        universal_newlines=True,
        errors="replace",
    )
    hops = []
    with proc:
        for line in proc.stdout:
            print(line, end="", flush=True)
            for ip in hop_ips([line]):
                location = get_location(ip)
                if location is None:
                    continue
                lat, lon = location
                if hops and (hops[-1][1], hops[-1][2]) == (lat, lon):
                    continue
                hops.append((ip, lat, lon))
    if proc.returncode not in (0, None):
        print("warning: traceroute exited with status %d" % proc.returncode, file=sys.stderr)
    return hops


def plot_route(hops, target, output=None):
    """Draw *hops* on a world map and show it, or save it to *output*."""
    # Imported here so that argument errors and a missing traceroute are
    # reported quickly, before the (slow) matplotlib import.
    try:
        import matplotlib
        if output:
            matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        from mpl_toolkits.basemap import Basemap
    except ImportError as exc:
        sys.exit("error: %s\nInstall the dependencies with: pip install -r requirements.txt" % exc)

    plt.figure(figsize=(10, 6), edgecolor="w")
    m = Basemap(projection="mill", lon_0=0, resolution="l")
    m.shadedrelief(scale=0.05)

    previous = None
    for ip, lat, lon in hops:
        x, y = m(lon, lat)
        m.scatter(x, y, 10, marker="o", color="r", zorder=5)
        if previous is not None:
            path = great_circle_points(previous[1], previous[0], lon, lat)
            for segment in split_at_dateline(path):
                xs, ys = m([p[0] for p in segment], [p[1] for p in segment])
                m.plot(xs, ys, color="b")
        previous = (lat, lon)

    plt.title("Route to %s (%d located hops)" % (target, len(hops)))
    plt.tight_layout()
    if output:
        plt.savefig(output, dpi=150)
        print("Map saved to %s" % output)
    else:
        plt.show()


def positive_int(value):
    number = int(value)
    if number < 1:
        raise argparse.ArgumentTypeError("must be at least 1")
    return number


def parse_args(argv=None):
    parser = argparse.ArgumentParser(
        description="Run traceroute to a host and draw the route on a world map."
    )
    parser.add_argument(
        "target",
        type=validate_target,
        help="IPv4 address or hostname to trace, e.g. 210.152.243.234",
    )
    parser.add_argument(
        "-m", "--max-hops",
        type=positive_int,
        default=MAX_HOPS,
        help="maximum number of hops to probe (default: %(default)s)",
    )
    parser.add_argument(
        "-o", "--output",
        metavar="FILE",
        help="save the map to FILE (e.g. route.png) instead of showing it",
    )
    return parser.parse_args(argv)


def main(argv=None):
    args = parse_args(argv)
    try:
        hops = run_traceroute(args.target, args.max_hops)
    except (FileNotFoundError, OSError) as exc:
        sys.exit("error: %s" % exc)
    except KeyboardInterrupt:
        sys.exit("\ninterrupted")

    if not hops:
        sys.exit("error: no hop could be geolocated, nothing to plot")
    plot_route(hops, args.target, args.output)


if __name__ == "__main__":
    main()
