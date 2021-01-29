# vis_route

This is a simple visualiser that takes information from traceroute and visualises it against a world map using geolocation.

usage -- just give an IP address

./vis_route.py 123.45.67.89


You will need to install
gcmap for great circle drawing
https://pypi.org/project/gcmap/

Matplot lib
https://matplotlib.org/users/installing.html

mpl_toolkits for mapping.
https://matplotlib.org/basemap/
  Installation suggestion:
  ```
   sudo apt install libgeos-dev
   pip install --user https://github.com/matplotlib/basemap/archive/master.zip
  ```
