# Required Notice: Copyright Matthew Armstrong (https://github.com/The-Dorkknight)
# Licensed under the PolyForm Noncommercial License 1.0.0. No warranty.
"""Tests for the 0.4 parts (Zener, lamp, speaker, relay, motor, LDR, thermistor), checked against hand maths."""
import math, os, sys, unittest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
from spiceyelectrons.runner import simulate, find_ngspice  # noqa: E402

need = unittest.skipUnless(find_ngspice() is not None, "ngspice is not installed")


def P(pid, t, nodes, **props):
    return {"id": pid, "type": t, "nodes": nodes, "props": props}


def last(r, n):
    return r["voltages"][n][-1]


@need
class NewParts(unittest.TestCase):
    def test_zener_clamps(self):
        r = simulate({"parts": [P("B", "battery", ["a", "0"], voltage="12"), P("R", "resistor", ["a", "k"], value="470"),
                                P("Z", "zener", ["0", "k"], vz="5.1")], "duration": 0.01})
        self.assertTrue(r["ok"], r.get("error"))
        self.assertAlmostEqual(last(r, "k"), 5.1, delta=0.35)

    def test_lamp_warms_up(self):
        r = simulate({"parts": [P("B", "battery", ["a", "0"], voltage="6"), P("L", "lamp", ["a", "0"], volts="6", amps="0.1")],
                      "duration": 1.5})
        self.assertTrue(r["ok"], r.get("error"))
        i = r["currents"]["L"]
        self.assertGreater(max(i), 0.4)                        # cold: big surge
        self.assertAlmostEqual(i[-1], 0.1, delta=0.01)              # hot: rated current

    def test_lamp_overvolt_warns(self):
        r = simulate({"parts": [P("B", "battery", ["a", "0"], voltage="12"), P("L", "lamp", ["a", "0"], volts="6", amps="0.1")],
                      "duration": 0.5})
        self.assertTrue(any(w["part"] == "L" for w in r["warnings"]))

    def test_relay_clicks_with_hysteresis(self):
        r = simulate({"parts": [P("B", "battery", ["a", "0"], voltage="5"), P("R", "relay", ["a", "0", "a", "o"], coil="5"),
                                P("Rl", "resistor", ["o", "0"], value="1k")], "duration": 0.05})
        self.assertTrue(r["ok"], r.get("error"))
        self.assertGreater(last(r, "o"), 4.5)                       # contact closed, load powered

    def test_relay_stays_open_when_unpowered(self):
        r = simulate({"parts": [P("B", "battery", ["a", "0"], voltage="5"), P("R", "relay", ["c", "0", "a", "o"], coil="5"),
                                P("Rc", "resistor", ["c", "0"], value="1k"), P("Rl", "resistor", ["o", "0"], value="1k")],
                      "duration": 0.05})
        self.assertLess(abs(last(r, "o")), 0.1)

    def test_motor_spins_up_and_current_drops(self):
        r = simulate({"parts": [P("B", "battery", ["a", "0"], voltage="6"), P("M", "motor", ["a", "0"], volts="6")], "duration": 1.0})
        self.assertTrue(r["ok"], r.get("error"))
        i = r["currents"]["M"]
        self.assertGreater(max(i), 0.8)                             # stall surge ~ V/R = 1.2 A
        self.assertLess(i[-1], 0.15)                                # running: back-EMF holds the current down
        self.assertGreater(last(r, "M_w"), 200)                     # rad/s

    def test_ldr_light_changes_voltage(self):
        def v(light):
            r = simulate({"parts": [P("B", "battery", ["a", "0"], voltage="5"), P("R", "resistor", ["a", "m"], value="10k"),
                                    P("D", "ldr", ["m", "0"], light=str(light))], "duration": 0.01})
            return last(r, "m")
        self.assertGreater(v(0), v(100) + 3)                        # dark = high, bright = low

    def test_thermistor_follows_temperature(self):
        def v(temp):
            r = simulate({"parts": [P("B", "battery", ["a", "0"], voltage="5"), P("R", "resistor", ["a", "m"], value="10k"),
                                    P("T", "thermistor", ["m", "0"], r25="10k", warm="0")], "duration": 0.01, "temp": temp})
            return last(r, "m")
        self.assertGreater(v(0), 2.5 + 0.3)
        self.assertLess(v(40), 2.5 - 0.3)
        self.assertAlmostEqual(v(25), 2.5, delta=0.03)

    def test_speaker_is_8_ohms(self):
        r = simulate({"parts": [P("B", "battery", ["a", "0"], voltage="8"), P("S", "speaker", ["a", "0"], ohms="8")], "duration": 0.01})
        self.assertAlmostEqual(r["currents"]["S"][-1], 1.0, delta=0.05)


if __name__ == "__main__":
    unittest.main()


@need
class Laws(unittest.TestCase):
    def test_kirchhoff_loop_and_current_divider(self):
        r = simulate({"parts": [P("B1", "battery", ["a", "0"], voltage="12"), P("R1", "resistor", ["a", "b"], value="1k"),
                                P("R2", "resistor", ["b", "c"], value="2k"), P("R3", "resistor", ["c", "0"], value="3k")], "duration": 0.01})
        self.assertAlmostEqual(last(r, "b"), 10, delta=0.02)
        self.assertAlmostEqual(last(r, "c"), 6, delta=0.02)
        r = simulate({"parts": [P("B1", "battery", ["a", "0"], voltage="9"), P("R1", "resistor", ["a", "0"], value="1k"),
                                P("R2", "resistor", ["a", "0"], value="2k")], "duration": 0.01})
        i = r["currents"]
        self.assertAlmostEqual(i["R1"][-1] + i["R2"][-1], i["B1"][-1], delta=1e-5)
        self.assertAlmostEqual(i["R1"][-1], 9e-3, delta=1e-4)
