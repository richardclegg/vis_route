"""Unit tests for the parts of vis_route that need no network or display."""

import unittest

import vis_route


LINUX_OUTPUT = """\
traceroute to 210.152.243.234 (210.152.243.234), 25 hops max, 60 byte packets
 1  192.168.1.1  0.412 ms  0.391 ms  0.384 ms
 2  * * *
 3  * 81.2.69.142  12.1 ms  12.3 ms
 4  203.0.113.7  20.0 ms 203.0.113.9  21.0 ms  22.0 ms
 5  210.152.243.234  180.0 ms  181.0 ms  182.0 ms
"""

WINDOWS_OUTPUT = """\

Tracing route to 210.152.243.234 over a maximum of 25 hops

  1    <1 ms    <1 ms    <1 ms  192.168.1.1
  2     *        *        *     Request timed out.
  3    12 ms    12 ms    13 ms  81.2.69.142
  4   180 ms   181 ms   182 ms  210.152.243.234

Trace complete.
"""


class HopParsingTests(unittest.TestCase):
    def test_linux_output(self):
        self.assertEqual(
            list(vis_route.hop_ips(LINUX_OUTPUT.splitlines())),
            ["192.168.1.1", "81.2.69.142", "203.0.113.7", "210.152.243.234"],
        )

    def test_windows_output(self):
        self.assertEqual(
            list(vis_route.hop_ips(WINDOWS_OUTPUT.splitlines())),
            ["192.168.1.1", "81.2.69.142", "210.152.243.234"],
        )

    def test_header_ip_is_not_a_hop(self):
        header = "traceroute to 8.8.8.8 (8.8.8.8), 25 hops max, 60 byte packets"
        self.assertEqual(list(vis_route.hop_ips([header])), [])

    def test_blank_lines_are_ignored(self):
        self.assertEqual(list(vis_route.hop_ips(["", "   ", "\n"])), [])


class TargetValidationTests(unittest.TestCase):
    def test_accepts_ipv4_and_hostnames(self):
        for target in ("8.8.8.8", "example.com", "my-host.example.org.", "localhost"):
            self.assertEqual(vis_route.validate_target(target), target)

    def test_rejects_shell_metacharacters_and_options(self):
        for target in ("1.1.1.1; rm -rf ~", "$(id)", "-h", "--max-hops", "a b", ""):
            with self.assertRaises(ValueError):
                vis_route.validate_target(target)


class PublicAddressTests(unittest.TestCase):
    def test_private_and_special_addresses_are_not_public(self):
        for ip in ("10.0.0.1", "192.168.1.1", "172.16.0.1", "127.0.0.1", "0.0.0.0", "not-an-ip"):
            self.assertFalse(vis_route.is_public(ip))

    def test_public_address(self):
        self.assertTrue(vis_route.is_public("8.8.8.8"))

    def test_private_address_is_never_looked_up(self):
        # Must return None without touching the network.
        self.assertIsNone(vis_route.get_location("192.168.1.1"))


class GreatCircleTests(unittest.TestCase):
    def test_endpoints_are_preserved(self):
        points = vis_route.great_circle_points(-0.1, 51.5, -122.1, 37.4)
        self.assertAlmostEqual(points[0][0], -0.1)
        self.assertAlmostEqual(points[0][1], 51.5)
        self.assertAlmostEqual(points[-1][0], -122.1)
        self.assertAlmostEqual(points[-1][1], 37.4)

    def test_london_to_california_arcs_north(self):
        points = vis_route.great_circle_points(-0.1, 51.5, -122.1, 37.4)
        self.assertGreater(max(lat for _, lat in points), 60)
        self.assertTrue(all(-180 <= lon <= 180 for lon, _ in points))

    def test_identical_points(self):
        self.assertEqual(vis_route.great_circle_points(10, 20, 10, 20), [(10, 20), (10, 20)])

    def test_pacific_crossing_is_split_once(self):
        points = vis_route.great_circle_points(-122.1, 37.4, 139.7, 35.7)
        segments = vis_route.split_at_dateline(points)
        self.assertEqual(len(segments), 2)
        self.assertEqual(sum(len(s) for s in segments), len(points))

    def test_atlantic_crossing_is_not_split(self):
        points = vis_route.great_circle_points(-0.1, 51.5, -122.1, 37.4)
        self.assertEqual(len(vis_route.split_at_dateline(points)), 1)

    def test_empty_path(self):
        self.assertEqual(vis_route.split_at_dateline([]), [])


if __name__ == "__main__":
    unittest.main()
