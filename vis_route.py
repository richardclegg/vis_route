#!/usr/bin/env python3

import urllib.request
import json
import os, sys, platform
import getopt
import subprocess
from mpl_toolkits.basemap import Basemap
import matplotlib.pyplot as plt
from gcmap import GCMapper
gcm = GCMapper()


def getLoc(IP):
    "Turn a string representing an IP address into a lat long pair"
    #Other geolocation services are available
    url = "https://geolocation-db.com/json/"+IP
    response = urllib.request.urlopen(url)
    encoding = response.info().get_content_charset('utf8')
    data = json.loads(response.read().decode(encoding))
    try:
        lat= float(data["latitude"])
        lon= float(data["longitude"])
        if lat == 0.0 and lon == 0.0:
            return (None, None)
        return (lat,lon)
    except:
        return (None,None)

def printHelp():
    print ("./vis_route.py IPv4Address")
    print (" e.g. ./vis_route.py 213.138.111.222")

try:
    opts, args = getopt.getopt(sys.argv,"h")
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

#m.bluemarble()
#m.drawcoastlines(color='r', linewidth=1.0)

# OS detection Linux/Mac or Windows
if platform.system() == 'Linux' or platform.system() == 'Darwin':
    #Start traceroute command
    proc = subprocess.Popen(["traceroute -m 25 -n "+IP], stdout=subprocess.PIPE, shell=True,universal_newlines=True)
    #plot a pretty enough map
    fig = plt.figure(figsize=(10, 6), edgecolor='w')
    m = Basemap(projection='mill', lon_0=0,resolution='l')
    m.shadedrelief(scale=0.05)
    #Where we are coming from
    lastLon= None
    lastLat= None
    #Parse individual traceroute command lines
    for line in proc.stdout:
        print(line,end="")
        hopIP=line.split()[1]
        if hopIP in ("*" , "to"):
            continue
        (lat,lon)=getLoc(hopIP)
        if (lat is None):
            continue
        if lastLat is not None and (lastLat-lat + lastLon-lon) != 0.0:
            #print(lastLat,lastLon,lat,lon)
            x,y = m(lon,lat)
            m.scatter(x,y,10,marker='o',color='r')
            line, = m.drawgreatcircle(lastLon,lastLat,lon,lat,color='b')
        lastLat= lat
        lastLon= lon

    plt.tight_layout()
    plt.show()

elif platform.system() == 'Windows':
    proc = subprocess.Popen("C:\\Windows\\System32\\TRACERT.exe -h 25 -d -4 " + IP, stdout=subprocess.PIPE, shell=True, universal_newlines=True)
    fig = plt.figure(figsize=(10, 6), edgecolor='w')
    m = Basemap(projection='mill', lon_0=0,resolution='l')
    m.shadedrelief(scale=0.05)
    lastLon = None
    lastLat = None

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
                x,y = m(lon,lat)
                m.scatter(x,y,10,marker='o',color='r')
                line, = m.drawgreatcircle(lastLon,lastLat,lon,lat,color='b')
            lastLat = lat
            lastLon = lon

    plt.tight_layout()
    plt.show()
else:
    print("Sorry, this python program does not have support for your current operating system!")
    sys.exit(-1)
