#!/usr/bin/env python3

import urllib.request
import json
import os, sys
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
    if hopIP == "*" or hopIP == "to":
        continue
    (lat,lon)=getLoc(hopIP)
    if (lat == None):
        continue
    if lastLat != None and (lastLat-lat + lastLon-lon) != 0.0:
        #print(lastLat,lastLon,lat,lon)
        line, = m.drawgreatcircle(lastLon,lastLat,lon,lat,color='r')
    lastLat= lat
    lastLon= lon

plt.tight_layout()
plt.show()
