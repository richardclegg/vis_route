#!/usr/bin/env python3

import urllib.request
import json
import os, sys, platform
import getopt
import subprocess
from gcmap import GCMapper
import plotly.graph_objects as go
import plotly.offline as py
gcm = GCMapper()


def getLoc(IP):
    url = f'https://geolocation-db.com/json/{IP}'
    response = urllib.request.urlopen(url)
    encoding = response.info().get_content_charset('utf8')
    data = json.loads(response.read().decode(encoding))
    try:
        lat= float(data['latitude'])
        lon= float(data['longitude'])
        if lat == 0.0 and lon == 0.0:
            return (None, None)
        return (lat,lon)
    except:
        return (None,None)

def printHelp():
    print ('python tracert_map.py IPv4Address')
    print (' e.g. python tracert_map.py 213.138.111.222')
    print(' e.g. python tracert_map.py google.com')

try:
    opts, args = getopt.getopt(sys.argv,'h')
except getopt.GetoptError:
    printHelp()
    sys.exit()
for opt, arg in opts:
    if opt == '-h':
        printHelp()
        sys.exit()
if len(args) != 2:
    printHelp()
    sys.exit()
IP= args[1]


# OS detection Linux/Mac or Windows
if platform.system() == 'Linux' or platform.system() == 'Darwin':
    proc = subprocess.Popen([f'traceroute -m 25 -n {IP}'], stdout=subprocess.PIPE, shell=True,universal_newlines=True)
    lastLon= None
    lastLat= None
    lat_list = []
    lon_list = []
    for line in proc.stdout:
        print(line,end="")
        hopIP=line.split()[1]
        if hopIP in ("*" , "to"):
            continue
        (lat,lon)=getLoc(hopIP)
        if (lat is None):
            continue
        if lastLat is not None and (lastLat-lat + lastLon-lon) != 0.0:
            print(f'- Last location: Lat({lastLat}), Long({lastLon}\n- Current Location: Lat({lat}) Long({lon})')
        lastLat= lat
        lastLon= lon
        lat_list.append(lastLat)
        lon_list.append(lastLon)
    fig = go.Figure(go.Scattermapbox(
                                mode = "markers+lines",
                                lon = None,
                                lat = None,
                                marker = {'size': 10}
                                ))
    fig.add_trace(go.Scattermapbox(
                                mode = "markers+lines",
                                lon = lon_list,
                                lat = lat_list,
                                marker = {'size': 10}
                                ))
    fig.update_layout(
                    margin ={'l':0,'t':0,'b':0,'r':0},
                    mapbox = {
                        'center': {'lon': 10, 'lat': 10},
                        'style': "stamen-terrain",
                        'center': {'lon': -20, 'lat': -20},
                        'zoom': 1}
                    )

    py.plot(fig, filename=f'traceroute_map.html')


elif platform.system() == 'Windows':
    proc = subprocess.Popen(f'C:\\Windows\\System32\\TRACERT.exe -h 25 -d -4 {IP}', stdout=subprocess.PIPE, shell=True, universal_newlines=True)
    lastLon = None
    lastLat = None
    lat_list = []
    lon_list = []
    for line in proc.stdout:
        print(line,end="")
        if len(line.split()) != 8:
            continue
        else:
            hopIP=line.split()[7]
            if hopIP in ("*" , "to"):
                continue
            (lat,lon)=getLoc(hopIP)
            if (lat is None):
                continue
            if lastLat is not None and (lastLat-lat + lastLon-lon) != 0.0:
                print(f'- Last location: Lat({lastLat}), Lon({lastLon}\n- Current Location: Lat({lat}) Lon({lon})')
            lastLat = lat
            lastLon = lon
            lat_list.append(lastLat)
            lon_list.append(lastLon)

    fig = go.Figure(go.Scattermapbox(
                                mode = "markers+lines",
                                lon = None,
                                lat = None,
                                marker = {'size': 10},
                                text= None
                                ))
    fig.add_trace(go.Scattermapbox(
                                mode = "markers+lines",
                                lon = lon_list,
                                lat = lat_list,
                                marker = {'size': 10},
                                text= None
                                ))
    fig.update_layout(
                    margin ={'l':0,'t':0,'b':0,'r':0},
                    mapbox = {
                        'center': {'lon': 10, 'lat': 10},
                        'style': 'carto-positron',
                        'center': {'lon': -20, 'lat': -20},
                        'zoom': 1}
                    )

    py.plot(fig, filename='traceroute_map.html')
else:
    print('Sorry, this python program does not have support for your current operating system :(')
    sys.exit(-1)