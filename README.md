# vis_route

This is a simple visualiser that takes information from traceroute and visualises it against a world map using geolocation. It should run on MacOS or windows.

usage -- just give an IP address

./vis_route.py 123.45.67.89


You will need to install
gcmap for great circle drawing
https://pypi.org/project/gcmap/

  Installation suggestion -- this should work on an up to date ubuntu
  ```
   pip install gcmap
  ```

Matplot lib
https://matplotlib.org/users/installing.html

mpl_toolkits for mapping.
https://matplotlib.org/basemap/
  Installation suggestion -- this should work on an up to date ubuntu
  ```
   pip install basemap
  ```
