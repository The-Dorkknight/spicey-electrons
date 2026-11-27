# Required Notice: Copyright Matthew Armstrong (https://github.com/The-Dorkknight)
# Licensed under the PolyForm Noncommercial License 1.0.0. No warranty.
"""Engine tests: value parsing, netlist checks, and real ngspice runs compared with hand maths.

Run:  python3 -m unittest discover -s tests -v
The simulation tests are skipped (not failed) if ngspice is not installed.
"""
import math
import os
import sys
import time
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from spiceyelectrons.units import parse_value, BadValue, pretty          # noqa: E402
from spiceyelectrons.netlist import build, check, CircuitError, auto_duration  # noqa: E402
from spiceyelectrons.runner import simulate, find_ngspice                # noqa: E402
from spiceyelectrons.parts import CATALOGUE                              # noqa: E402

HAVE_NGSPICE = find_ngspice() is not None


def part(pid, t, nodes, **props):
    return {"id": pid, "type": t, "nodes": nodes, "props": props}


def at(res, node, t):
    """Voltage of node at time t (nearest sample)."""
    i = min(range(len(res["time"])), key=lambda k: abs(res["time"][k] - t))
    return res["voltages"][node][i]


class Units(unittest.TestCase):
    def test_values(self):
        self.assertAlmostEqual(parse_value("4.7k"), 4700)
        self.assertAlmostEqual(parse_value("4k7"), 4700)
        self.assertAlmostEqual(parse_value("100n"), 1e-7)
        self.assertAlmostEqual(parse_value("10uF"), 1e-5)
        self.assertAlmostEqual(parse_value("10µF"), 1e-5)
        self.assertAlmostEqual(parse_value("1M"), 1e6)        # kid rule: M is mega
        self.assertAlmostEqual(parse_value("1m"), 1e-3)
        self.assertAlmostEqual(parse_value("2.2 kΩ"), 2200)
        self.assertAlmostEqual(parse_value("1Meg"), 1e6)
        self.assertAlmostEqual(parse_value("1,5"), 1.5)
        self.assertAlmostEqual(parse_value("4R7"), 4.7)
        with self.assertRaises(BadValue):
            parse_value("lots")

    def test_pretty(self):
        self.assertEqual(pretty(0.0047, "A"), "4.7 mA")
        self.assertEqual(pretty(12000, "Ω"), "12 kΩ")


class Checks(unittest.TestCase):
    def test_empty(self):
        with self.assertRaises(CircuitError):
            check({"parts": []})

    def test_no_power(self):
        with self.assertRaises(CircuitError) as e:
            check({"parts": [part("R1", "resistor", ["a", "0"])]})
        self.assertIn("powering", str(e.exception))

    def test_shorted_battery(self):
        with self.assertRaises(CircuitError) as e:
            check({"parts": [part("B1", "battery", ["0", "0"]), part("R1", "resistor", ["a", "0"])]})
        self.assertEqual(e.exception.part, "B1")

    def test_auto_ground_and_dangling(self):
        notes, parts = check({"parts": [part("B1", "battery", ["a", "b"]), part("R1", "resistor", ["a", "c"])]})
        self.assertTrue(any("ground" in n for n in notes))
        self.assertTrue(any("R1" in n and "isn't connected" in n for n in notes))
        self.assertEqual(parts[0]["nodes"], ["a", "0"])

    def test_bad_value_names_part(self):
        with self.assertRaises(CircuitError) as e:
            build({"parts": [part("B1", "battery", ["a", "0"]), part("R7", "resistor", ["a", "0"], value="banana")]})
        self.assertEqual(e.exception.part, "R7")

    def test_every_part_builds(self):
        for t, (pins, _) in CATALOGUE.items():
            nodes = [f"x{i}" for i in range(len(pins))] if t != "ground" else ["0"]
            net, meta = build({"parts": [part("B1", "battery", ["x0", "0"]), part("P1", t, nodes)]})
            self.assertIn(".control", net)

    def test_auto_duration(self):
        p = [part("S", "sine", ["a", "0"], frequency="50"), part("R", "resistor", ["a", "0"], value="1k")]
        _, parts = check({"parts": p})
        self.assertAlmostEqual(auto_duration(parts), 0.1)


@unittest.skipUnless(HAVE_NGSPICE, "ngspice not installed")
class Simulations(unittest.TestCase):
    def test_rc_charging_matches_maths(self):
        c = {"parts": [part("B1", "battery", ["a", "0"], voltage="9"), part("R1", "resistor", ["a", "b"], value="1k"),
                       part("C1", "capacitor", ["b", "0"], value="100u")], "duration": 0.5}
        r = simulate(c)
        self.assertTrue(r["ok"], r.get("error"))
        for tau in (1, 2, 3):
            want = 9 * (1 - math.exp(-tau))
            self.assertAlmostEqual(at(r, "b", 0.1 * tau), want, delta=0.03)

    def test_led_current_and_warning(self):
        c = {"parts": [part("B1", "battery", ["a", "0"]), part("R1", "resistor", ["a", "b"], value="470"),
                       part("D1", "led", ["b", "0"], color="red")]}
        r = simulate(c)
        i = r["currents"]["D1"][-1]
        self.assertAlmostEqual(i, (9 - 1.8) / 470, delta=0.001)
        self.assertEqual(r["warnings"], [])
        c["parts"][1]["props"]["value"] = "10"
        r = simulate(c)
        self.assertTrue(any(w["part"] == "D1" and w["level"] == "burn" for w in r["warnings"]))

    def test_led_and_diode_get_lower_when_warm(self):
        for t, props in (("led", {"color": "red"}), ("diode", {"model": "1N4148"})):
            vs = []
            for temp in (0, 20, 40):
                c = {"parts": [part("B1", "battery", ["a", "0"]), part("R1", "resistor", ["a", "b"], value="1k"),
                               part("D1", t, ["b", "0"], **props)], "temp": temp}
                vs.append(simulate(c)["voltages"]["b"][-1])
            self.assertGreater(vs[0], vs[1])
            self.assertGreater(vs[1], vs[2])
            per_degree = (vs[2] - vs[0]) / 40
            self.assertTrue(-0.003 < per_degree < -0.001, per_degree)

    def test_opamp_inverting_gain(self):
        c = {"parts": [part("S1", "sine", ["in", "0"], amplitude="0.5", frequency="1k"),
                       part("R1", "resistor", ["in", "m"], value="1k"), part("R2", "resistor", ["m", "out"], value="10k"),
                       part("U1", "opamp", ["m", "0", "out"])]}
        r = simulate(c)
        vin, vout = r["voltages"]["in"], r["voltages"]["out"]
        self.assertAlmostEqual(max(vout), 5.0, delta=0.05)
        self.assertAlmostEqual(min(vout), -5.0, delta=0.05)
        i = max(range(len(vin)), key=lambda k: vin[k])
        self.assertLess(vout[i], -4.9)            # inverted

    def test_transistor_switch(self):
        base = {"parts": [part("B1", "battery", ["v", "0"]), part("R1", "resistor", ["v", "c"], value="1k"),
                          part("Q1", "npn", ["b", "c", "0"]), part("R2", "resistor", ["s", "b"], value="10k"),
                          part("S1", "switch", ["v", "s"], closed=True)]}
        on = simulate(base)
        self.assertGreater(on["currents"]["Q1"][-1], 0.008)      # saturated: about 8.9 mA
        base["parts"][4]["props"]["closed"] = False
        off = simulate(base)
        self.assertLess(abs(off["currents"]["Q1"][-1]), 1e-6)

    def test_mosfet_and_pnp_run(self):
        c = {"parts": [part("B1", "battery", ["v", "0"], voltage="5"), part("R1", "resistor", ["v", "d"], value="100"),
                       part("M1", "nmos", ["v", "d", "0"])]}
        r = simulate(c)
        self.assertGreater(r["currents"]["M1"][-1], 0.04)
        c = {"parts": [part("B1", "battery", ["v", "0"]), part("Q1", "pnp", ["b", "c", "v"]),
                       part("R1", "resistor", ["b", "0"], value="100k"), part("R2", "resistor", ["c", "0"], value="1k")]}
        r = simulate(c)
        self.assertTrue(r["ok"], r.get("error"))
        self.assertGreater(r["currents"]["Q1"][-1], 0.005)

    def test_rectifier_surge_is_not_a_false_alarm(self):
        c = {"parts": [part("S1", "sine", ["a", "0"], amplitude="10", frequency="50"),
                       part("D1", "diode", ["a", "b"], model="1N4007"), part("C1", "capacitor", ["b", "0"], value="470u"),
                       part("R1", "resistor", ["b", "0"], value="1k")]}
        r = simulate(c)
        self.assertEqual(r["warnings"], [])
        self.assertGreater(min(r["voltages"]["b"][-200:]), 8.0)

    def test_pot_divides(self):
        c = {"parts": [part("B1", "battery", ["v", "0"], voltage="10"), part("P1", "pot", ["v", "0", "w"], value="10k", position="25")]}
        r = simulate(c)
        self.assertAlmostEqual(r["voltages"]["w"][-1], 7.5, delta=0.05)

    def test_hang_is_stopped_and_crash_reported(self):
        c = {"parts": [part("B1", "battery", ["a", "0"]), part("R1", "resistor", ["a", "0"])], "time_limit": 2}
        os.environ["SE_TEST_CRASH"] = "hang"
        try:
            t0 = time.time()
            r = simulate(c)
            self.assertFalse(r["ok"])
            self.assertIn("longer than", r["error"])
            self.assertLess(time.time() - t0, 6)
            os.environ["SE_TEST_CRASH"] = "crash"
            r = simulate(c)
            self.assertFalse(r["ok"])
            self.assertIn("crashed", r["error"])
        finally:
            os.environ.pop("SE_TEST_CRASH", None)

    def test_gave_up_is_stopped_early(self):
        """If ngspice says it aborted but then sits there, we stop in about a second, not at the 120 s limit."""
        c = {"parts": [part("B1", "battery", ["a", "0"], voltage="3"), part("R1", "resistor", ["a", "0"], value="77")],
             "time_limit": 60}
        os.environ["SE_TEST_CRASH"] = "stuck"
        try:
            t0 = time.time()
            r = simulate(c)
            self.assertFalse(r["ok"])
            self.assertLess(time.time() - t0, 6)
            self.assertNotIn("longer than", r["error"])
        finally:
            os.environ.pop("SE_TEST_CRASH", None)

    def test_repeat_run_is_cached(self):
        c = {"parts": [part("B1", "battery", ["a", "0"], voltage="4"), part("R1", "resistor", ["a", "0"], value="123")]}
        first = simulate(c)
        second = simulate(c)
        self.assertTrue(second.get("cached"))
        self.assertEqual(first["voltages"], second["voltages"])
        second["voltages"]["a"][0] = 99                      # changing one result must not change the stored copy
        self.assertNotEqual(simulate(c)["voltages"]["a"][0], 99)
        c["parts"][1]["props"]["value"] = "124"
        self.assertFalse(simulate(c).get("cached"))

    def test_heavy_job_heartbeat(self):
        """A long run on one core must keep reporting that it is alive."""
        job = {}
        c = {"parts": [part("S1", "square", ["a", "0"], frequency="100k"), part("R1", "resistor", ["a", "b"], value="1k"),
                       part("C1", "capacitor", ["b", "0"], value="10n")], "duration": 0.02}
        t0 = time.time()
        r = simulate(c, job)
        self.assertTrue(r["ok"], r.get("error"))
        self.assertIn("heartbeat", job)
        print(f"\n  2,000-cycle square wave took {time.time() - t0:.2f} s on this machine")


class Launchers(unittest.TestCase):
    def test_launchers_exist(self):
        root = os.path.join(os.path.dirname(__file__), "..")
        for n in ("SpiceyElectrons-Linux.sh", "SpiceyElectrons-Mac.command", "SpiceyElectrons-Windows.bat"):
            p = os.path.join(root, n)
            self.assertTrue(os.path.isfile(p), n)
            if not n.endswith(".bat"):
                self.assertTrue(os.access(p, os.X_OK), n + " is not executable")
        with open(os.path.join(root, "SpiceyElectrons-Windows.bat"), "rb") as f:
            self.assertIn(b"\r\n", f.read())


if __name__ == "__main__":
    unittest.main()
