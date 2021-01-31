#!/usr/bin/env python3

# Standard library
import getopt
import json
import platform
import subprocess
import sys
import urllib.request

from pathlib import Path
from typing import Tuple, Union

# Third-party
import matplotlib.pyplot as plt

from gcmap import GCMapper
from mpl_toolkits.basemap import Basemap


gcm = GCMapper()


def get_location(ip_address: str) -> Union[Tuple[float, float], Tuple[None, None]]:
    "Turn a string representing an IP address into a lat long pair"
    
    # Other geolocation services are available
    url = f"https://geolocation-db.com/json/{ip_address}"
    response = urllib.request.urlopen(url)
    encoding = response.info().get_content_charset('utf8')
    data = json.loads(response.read().decode(encoding))
    
    result = (None, None)
    
    try:
        lat = float(data['latitude'])
        lon = float(data['longitude'])
        if lat != 0.0 and lon != 0.0:
            result = (lat, lon)
    except (ValueError, KeyError):
        pass
    
    return result


def print_help() -> None:
    print("./vis_route.py IPv4Address")
    print(" e.g. ./vis_route.py 213.138.111.222")
    

def trace_route(ip_address: str) -> None:
    if platform.system() in ('Linux', 'Darwin'):
        command = ['traceroute', '-m', '25', '-n', ip_address]
    elif platform.system() == 'Windows':
        tracert_path = Path('C:') / 'Windows' / 'System32' / 'TRACERT.exe'
        # alt: tracert_path = Path(subprocess.run(['where.exe', 'tracert'], capture_output=True, encoding='utf-8').stdout.rstrip())
        command = [str(tracert_path), '-h', '25', '-d', '-4', ip_address]
    else:
        print("Sorry, this Python program does not have support for your current operating system!")
        sys.exit(-1)
    
    # Start traceroute command
    proc = subprocess.Popen(command, stdout=subprocess.PIPE, shell=True, universal_newlines=True) 
    
    # Plot a pretty enough map
    fig = plt.figure(figsize=(10, 6), edgecolor='w')
    m = Basemap(projection='mill', lon_0=0, resolution='l')
    m.shadedrelief(scale=0.05)
    
    # Where we are coming from
    last_lon = None
    last_lat = None
    
    # Parse individual traceroute command lines
    for line in proc.stdout:
        print(line, end='')
    
        if platform.system() == 'Windows' and len(line.split()) != 8:
            continue
    
        hop_ip = line.split()[1 if platform.system() in ('Linux', 'Darwin') else 7] # First step already handled other cases
    
        if hop_ip in ('*' , 'to'):
            continue
        
        (lat, lon) = get_location(hop_ip)
    
        if (lat is None):
            continue
        
        if last_lat is not None and (last_lat-lat + last_lon-lon) != 0.0:
            # print(lastLat, lastLon, lat, lon)
            x, y = m(lon,lat)
            m.scatter(x, y, 10, marker='o', color='r')
            line, = m.drawgreatcircle(last_lon, last_lat, lon, lat, color='b')
        
        last_lat = lat
        last_lon = lon

    plt.tight_layout()
    plt.show()


def main() -> None:
    
    try:
        opts, args = getopt.getopt(sys.argv, 'h')
    except getopt.GetoptError:
        print_help()
        return
    
    if len(args) != 2:
        print_help()
        return
    
    for opt, arg in opts:
        if opt == '-h':
            print_help()
            return
    
    ip_address = args[1]
    trace_route(ip_address)
    
if __name__ == '__main__':
    main()
