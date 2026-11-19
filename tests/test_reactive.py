# Required Notice: Copyright Matthew Armstrong (https://github.com/The-Dorkknight)
# Licensed under the PolyForm Noncommercial License 1.0.0. No warranty.
"""Reactive-circuit tests (coils, transformers, ringing, oscillators) checked against hand maths,
plus the edge cases and malformed input that used to break things.

Run:  python3 -m unittest discover -s tests -v
"""
import math
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from spiceyelectrons.runner import simulate, find_ngspice                # noqa: E402
from spiceyelectrons.netlist import CircuitError, build                  # noqa: E402

HAVE = find_ngspice() is not None
need = unittest.skipUnless(HAVE, "ngspice is not installed")


def P(pid, t, nodes, **props):
    return {"id": pid, "type": t, "nodes": nodes, "props": props}


def peak(res, node):
    return max(abs(v) for v in res["voltages"][node])


@need
class Transformer(unittest.TestCase):
    def sim(self, ratio, load, k="0.9999", dur=0.06, extra=()):
        return simulate({"parts": [P("S", "sine", ["p", "0"], amplitude="10", frequency="100", offset="0"),
                                   P("T1", "transformer", ["p", "0", "s", "0"], ratio=str(ratio), inductance="1", coupling=k),
                                   P("R1", "resistor", ["s", "0"], value=load), *extra], "duration": dur})

    def test_step_up_open_secondary(self):
        r = self.sim(2, "1e9")
        self.assertTrue(r["ok"], r.get("error"))
        self.assertAlmostEqual(peak(r, "s") / 10.0, 2.0, delta=0.08)        # Vs/Vp = n

    def test_step_down_loaded(self):
        r = self.sim(0.5, "1k")
        self.assertTrue(r["ok"], r.get("error"))
        self.assertAlmostEqual(peak(r, "s") / 10.0, 0.5, delta=0.03)

    def test_dc_does_not_pass(self):
        r = simulate({"parts": [P("B", "battery", ["p", "0"], voltage="9"),
                                P("T1", "transformer", ["p", "0", "s", "0"], ratio="1", inductance="1m", coupling="0.99"),
                                P("R1", "resistor", ["s", "0"], value="1k")], "duration": 0.05})
        self.assertTrue(r["ok"], r.get("error"))
        self.assertLess(abs(r["voltages"]["s"][-1]), 0.01)                  # steady DC: nothing on the secondary

    def test_dot_polarity(self):
        # swapping the secondary legs flips the output upside down
        a = self.sim(1, "1k")
        b = simulate({"parts": [P("S", "sine", ["p", "0"], amplitude="10", frequency="100", offset="0"),
                                P("T1", "transformer", ["p", "0", "0", "s"], ratio="1", inductance="1", coupling="0.9999"),
                                P("R1", "resistor", ["s", "0"], value="1k")], "duration": 0.06})
        i = max(range(len(a["time"])), key=lambda k: abs(a["voltages"]["s"][k]))   # at the top of a swing
        self.assertGreater(abs(a["voltages"]["s"][i]), 3)
        self.assertLess(a["voltages"]["s"][i] * b["voltages"]["s"][i], 0)

    def test_ratio_limits(self):
        for bad in ("0", "-2", "abc", "1e9", "1e-7"):
            r = self.sim(bad, "1k")
            self.assertFalse(r["ok"], bad)
            self.assertIn("T1", r["error"])

    def test_coupling_is_clamped(self):
        for k in ("0", "1", "5", "-1"):
            self.assertTrue(self.sim(1, "1k", k=k)["ok"], k)


@need
class Ringing(unittest.TestCase):
    def test_rlc_rings_at_resonance(self):
        L, C = 1e-3, 100e-9
        f0 = 1 / (2 * math.pi * math.sqrt(L * C))
        r = simulate({"parts": [P("SQ", "square", ["a", "0"], high="5", low="0", frequency="1k", duty="50"),
                                P("R1", "resistor", ["a", "b"], value="10"), P("L1", "inductor", ["b", "c"], value="1m"),
                                P("C1", "capacitor", ["c", "0"], value="100n")], "duration": 2e-4})
        self.assertTrue(r["ok"], r.get("error"))
        v, t = r["voltages"]["c"], r["time"]
        peaks = [t[i] for i in range(2, len(v) - 2) if v[i] > v[i - 1] and v[i] >= v[i + 1] and v[i] > 5.5]
        self.assertGreaterEqual(len(peaks), 2)
        self.assertAlmostEqual(1 / (peaks[1] - peaks[0]), f0, delta=f0 * 0.04)
        self.assertGreater(peak(r, "c"), 8.5)                               # overshoots well past the 5 V step


def joule_thief():
    return [P("B1", "battery", ["vcc", "0"], voltage="1.5"),
            P("T1", "transformer", ["vcc", "c", "nb", "bn"], ratio="1", inductance="10u", coupling="0.99"),
            P("Q1", "npn", ["nb", "c", "0"], model="2N3904"), P("R1", "resistor", ["vcc", "bn"], value="1k"),
            P("LED1", "led", ["c", "vcc"], color="red")]


@need
class Oscillators(unittest.TestCase):
    def test_joule_thief_runs_and_lights_led(self):
        r = simulate({"parts": joule_thief(), "start": 1e-5, "duration": 4e-5})
        self.assertTrue(r["ok"], r.get("error"))
        f = r["freq"]["c"]["avg"]
        self.assertTrue(1e5 < f < 2e6, f)                                   # a few hundred kHz
        self.assertGreater(max(abs(x) for x in r["currents"]["LED1"]), 0.02)   # pulses of tens of mA through the LED
        self.assertGreater(peak(r, "c"), 1.8)                               # boosted above the 1.5 V battery

    def test_fm_bug_carrier_and_deviation(self):
        parts = [P("B1", "battery", ["vcc", "0"], voltage="9"), P("C1", "capacitor", ["vcc", "0"], value="10n"),
                 P("L1", "inductor", ["vcc", "c"], value="0.2u"), P("C2", "capacitor", ["c", "vcc"], value="10p"),
                 P("C3", "capacitor", ["c", "e"], value="5p"), P("R1", "resistor", ["e", "0"], value="470"),
                 P("R2", "resistor", ["vcc", "b"], value="33k"), P("R3", "resistor", ["b", "0"], value="10k"),
                 P("C4", "capacitor", ["b", "0"], value="100p"), P("Q1", "npn", ["b", "c", "e"], model="2N2222"),
                 P("MIC", "sine", ["aud", "0"], amplitude="0.2", frequency="20k", offset="0"),
                 P("Rm", "resistor", ["aud", "am"], value="4.7k"), P("C5", "capacitor", ["am", "b"], value="100n")]
        r = simulate({"parts": parts, "start": 1e-5, "duration": 1e-4})
        self.assertTrue(r["ok"], r.get("error"))
        fr = r["freq"]["c"]
        self.assertTrue(70e6 < fr["avg"] < 110e6, fr["avg"])                # FM broadcast band
        vals = [x for x in fr["trace"] if x]
        self.assertGreater(max(vals) - min(vals), 0.3e6)                    # the audio really moves the carrier
        self.assertIn("v:c", r["env"])                                      # too fast to draw: a min/max band is returned


@need
class Chips(unittest.TestCase):
    def test_555_astable_rate(self):
        parts = [P("B1", "battery", ["v", "0"], voltage="9"), P("U1", "555", ["v", "0", "t", "o", "t", "d"]),
                 P("R1", "resistor", ["v", "d"], value="1k"), P("R2", "resistor", ["d", "t"], value="47k"),
                 P("C1", "capacitor", ["t", "0"], value="10u"), P("R3", "resistor", ["o", "0"], value="470")]
        r = simulate({"parts": parts, "duration": 10})
        self.assertTrue(r["ok"], r.get("error"))
        ideal = 1.44 / ((1e3 + 2 * 47e3) * 10e-6)
        self.assertAlmostEqual(r["freq"]["o"]["avg"], ideal, delta=ideal * 0.04)
        tv = r["voltages"]["t"][300:]
        self.assertAlmostEqual(max(tv), 6.0, delta=0.3)                    # 2/3 of the supply
        self.assertAlmostEqual(min(tv), 3.0, delta=0.3)                    # 1/3 of the supply

    def test_555_one_shot_width(self):
        parts = [P("B1", "battery", ["v", "0"], voltage="9"), P("S", "square", ["tr", "0"], high="9", low="0", frequency="0.5", duty="90"),
                 P("U1", "555", ["v", "0", "tr", "o", "t", "t"]), P("R1", "resistor", ["v", "t"], value="100k"),
                 P("C1", "capacitor", ["t", "0"], value="10u"), P("R3", "resistor", ["o", "0"], value="470")]
        r = simulate({"parts": parts, "duration": 1.7})
        o, t = r["voltages"]["o"], r["time"]
        up = [t[i] for i in range(1, len(o)) if o[i] > 4.5 >= o[i - 1]]
        dn = [t[i] for i in range(1, len(o)) if o[i] <= 4.5 < o[i - 1]]
        self.assertAlmostEqual(dn[0] - up[0], 1.1, delta=0.1)               # 1.1 x R x C
        self.assertLess(min(o[300:]), 0.1)                                  # and it really goes back to 0 V

    def test_logic_truth_tables(self):
        tables = {"and": [0, 0, 0, 1], "or": [0, 1, 1, 1], "nand": [1, 1, 1, 0], "nor": [1, 0, 0, 0], "xor": [0, 1, 1, 0]}
        for gate, want in tables.items():
            got = []
            for a in (0, 5):
                for b in (0, 5):
                    parts = [P("A", "battery", ["a", "0"], voltage=str(a or 0.001)), P("B", "battery", ["b", "0"], voltage=str(b or 0.001)),
                             P("G", gate, ["a", "b", "o"], level="5"), P("R", "resistor", ["o", "0"], value="10k")]
                    got.append(round(simulate({"parts": parts, "duration": 1e-6})["voltages"]["o"][-1] / 5))
            self.assertEqual(got, want, gate)
        for a, want in ((0.001, 1), (5, 0)):
            r = simulate({"parts": [P("A", "battery", ["a", "0"], voltage=str(a)), P("G", "not", ["a", "o"]), P("R", "resistor", ["o", "0"], value="10k")], "duration": 1e-6})
            self.assertEqual(round(r["voltages"]["o"][-1] / 5), want)

    def test_miller_kick_turns_a_mosfet_on(self):
        def run(cgd):
            return simulate({"parts": [P("S", "square", ["a", "0"], high="12", low="0", frequency="1M", duty="50"),
                                       P("R1", "resistor", ["a", "d"], value="100"), P("R2", "resistor", ["g", "0"], value="10k"),
                                       P("M1", "nmos", ["g", "d", "0"], cgd=cgd)], "duration": 5e-6})
        with_c, without = run("4p"), run("0")
        self.assertGreater(max(with_c["voltages"]["g"]), 2.1)             # kicked past the threshold
        self.assertLess(max(without["voltages"]["g"]), 0.5)


@need
class BugFixes03(unittest.TestCase):
    """Bugs found in the 0.3.0 sweep."""

    def test_gates_alone_are_powered_and_a_ring_oscillates(self):
        r = simulate({"parts": [P("G1", "not", ["a", "b"]), P("G2", "not", ["b", "c"]), P("G3", "not", ["c", "a"])]})
        self.assertTrue(r["ok"], r.get("error"))
        self.assertTrue(10e6 < r["freq"]["a"]["avg"] < 100e6, r["freq"].get("a"))
        self.assertGreater(max(r["voltages"]["a"]) - min(r["voltages"]["a"]), 3)

    def test_555_overload_and_supply_warnings(self):
        base = [P("U1", "555", ["v", "0", "t", "o", "t", "d"]), P("R1", "resistor", ["v", "d"], value="1k"),
                P("R2", "resistor", ["d", "t"], value="10k"), P("C1", "capacitor", ["t", "0"], value="1u")]
        r = simulate({"parts": [P("B1", "battery", ["v", "0"], voltage="9"), *base, P("W", "resistor", ["o", "0"], value="0.001")]})
        self.assertTrue(any(w["part"] == "U1" for w in r["warnings"]))
        r = simulate({"parts": [P("B1", "battery", ["v", "0"], voltage="30"), *base, P("RL", "resistor", ["o", "0"], value="10k")]})
        self.assertTrue(any("16 V" in w["text"] for w in r["warnings"]))
        r = simulate({"parts": [P("B1", "battery", ["0", "v"], voltage="9"), *base, P("RL", "resistor", ["o", "0"], value="10k")]})
        self.assertTrue(any("wrong way round" in w["text"] for w in r["warnings"]))

    def test_gate_driving_led_without_resistor_warns(self):
        r = simulate({"parts": [P("A", "battery", ["a", "0"], voltage="5"), P("G1", "and", ["a", "a", "o"]),
                                P("LED1", "led", ["o", "0"], color="red")]})
        self.assertTrue(any(w["part"] == "G1" for w in r["warnings"]))


@need
class Robustness(unittest.TestCase):
    rc = [P("B1", "battery", ["a", "0"], voltage="9"), P("R1", "resistor", ["a", "b"], value="1k"),
          P("C1", "capacitor", ["b", "0"], value="100u")]

    def err(self, circuit):
        r = simulate(circuit)
        self.assertFalse(r["ok"])
        self.assertNotIn("Internal error", r["error"], r["error"])
        return r["error"]

    def test_malformed_payloads(self):
        for c in ([1, 2, 3], {"parts": "x"}, {"parts": [None]}, {"parts": [{"id": "B1", "type": "battery", "nodes": [None, "0"]}]},
                  {"parts": self.rc, "temp": "hot"}, {"parts": self.rc, "duration": "abc"}, {"parts": self.rc, "temp": 1e6},
                  {"parts": self.rc, "start": 1e9, "duration": 1e-3}):
            self.err(c)

    def test_duplicate_names(self):
        self.assertIn("R1", self.err({"parts": self.rc + [P("R1", "resistor", ["a", "0"], value="2k")]}))

    def test_nan_and_inf_values(self):
        for v in ("nan", "inf", "9\n.include /etc/passwd"):
            self.err({"parts": [P("B1", "battery", ["a", "0"], voltage=v), P("R1", "resistor", ["a", "0"], value="1k")]})

    def test_huge_resistor_is_not_smoking(self):
        r = simulate({"parts": [P("B1", "battery", ["a", "0"], voltage="9"), P("R1", "resistor", ["a", "0"], value="1e30")]})
        self.assertTrue(r["ok"])
        self.assertEqual(r["warnings"], [])

    def test_floating_and_odd_circuits_do_not_crash(self):
        cases = [[P("B1", "battery", ["a", "b"], voltage="9"), P("R1", "resistor", ["a", "b"], value="1k")],
                 [P("B1", "battery", ["a", "0"], voltage="9"), P("B2", "battery", ["a", "0"], voltage="5"), P("R1", "resistor", ["a", "0"], value="1k")],
                 [P("C1", "capacitor", ["a", "b"], value="1u"), P("C2", "capacitor", ["b", "0"], value="1u"), P("B1", "battery", ["a", "0"], voltage="9")],
                 [P("S", "sine", ["a", "0"], amplitude="1", frequency="1G", offset="0"), P("R1", "resistor", ["a", "0"], value="50")]]
        for parts in cases:
            self.assertTrue(simulate({"parts": parts})["ok"])

    def test_step_cap_notes_instead_of_hanging(self):
        meta = build({"parts": joule_thief(), "start": 1.0, "duration": 1e-7})[1]
        self.assertLessEqual(meta["steps"], 800000)
        self.assertTrue(any("tiny steps" in n for n in meta["notes"]))


if __name__ == "__main__":
    unittest.main()
