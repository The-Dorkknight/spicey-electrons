# Required Notice: Copyright Matthew Armstrong (https://github.com/The-Dorkknight)
# Licensed under the PolyForm Noncommercial License 1.0.0. No warranty.
"""Build an ngspice netlist from the editor's node-level circuit.

Input (what the web editor sends, after it has worked out which pins touch which wires):

    {
      "parts": [{"id": "R1", "type": "resistor", "nodes": ["n1", "n2"], "props": {"value": "1k"}}, ...],
      "temp": 20,              # 0, 20 or 40 (any number works)
      "duration": null         # seconds, or null for automatic
    }

Ground is node "0". Every part gets a hidden 0 V "ammeter" in its first leg (or
collector / drain / output), so every current and every node voltage comes back
from ONE run - adding a probe afterwards never needs a re-run.
"""
import math
import re

from .parts import CATALOGUE, DIODE_MODELS, BJT_MODELS, MOS_MODELS, led_model
from .units import parse_value, pretty, BadValue

SOURCES = ("battery", "sine", "square")
GATES = ("and", "or", "nand", "nor", "xor")
POINTS = 1000          # samples handed back to the browser
MAX_STEPS = 800000     # most time steps we will ask ngspice for (keeps old PCs responsive)
STEPS_PER_CYCLE = 40   # time steps per cycle of the fastest oscillation we can predict


class CircuitError(Exception):
    """A problem a kid can fix. .part = the part id to highlight (optional)."""

    def __init__(self, msg, part=None):
        super().__init__(msg)
        self.part = part


def _safe(name):
    s = re.sub(r"[^A-Za-z0-9_]", "_", str(name))
    return s or "x"


def _num(props, key, part_id, what, positive=False):
    try:
        v = parse_value(props.get(key, ""), what)
    except BadValue as e:
        raise CircuitError(f"{part_id}: {e}", part_id)
    if positive and v <= 0:
        raise CircuitError(f"{part_id}: the {what} has to be bigger than zero.", part_id)
    return v


def check(circuit):
    """Friendly pre-flight checks. Returns (notes, parts) - parts may have ground added. Raises CircuitError."""
    if not isinstance(circuit, dict) or not isinstance(circuit.get("parts", []), list):
        raise CircuitError("I couldn't make sense of that circuit. Try pressing 🗑 New and building it again.")
    parts = []
    for p in circuit.get("parts", []):
        if (not isinstance(p, dict) or not isinstance(p.get("nodes"), list) or not isinstance(p.get("type"), str)
                or not all(isinstance(x, (str, int)) for x in p["nodes"]) or not isinstance(p.get("id"), (str, int))):
            raise CircuitError("One of the parts in this circuit is damaged (its details are missing). Delete it and add it again.")
        q = dict(p)
        q["id"], q["nodes"] = str(p["id"]), [str(x) for x in p["nodes"]]
        q["props"] = p["props"] if isinstance(p.get("props"), dict) else {}
        parts.append(q)
    notes = []
    real = [p for p in parts if p["type"] != "ground"]
    if not real:
        raise CircuitError("Drag some parts onto the board first - a battery and a resistor are a good start!")
    seen = set()
    for p in parts:
        if p.get("id") in seen:
            raise CircuitError(f"Two parts are both called {p['id']}. Delete one and add it again so each has its own name.", p["id"])
        seen.add(p.get("id"))
        if p["type"] not in CATALOGUE:
            raise CircuitError(f"I don't know what a '{p['type']}' is.", p.get("id"))
        pins = CATALOGUE[p["type"]][0]
        if len(p.get("nodes", [])) != len(pins):
            raise CircuitError(f"{p['id']} is missing some legs.", p["id"])
        p["props"] = {**CATALOGUE[p["type"]][1], **(p.get("props") or {})}
    if not any(p["type"] in SOURCES or p["type"] in GATES or p["type"] == "not" for p in parts):  # gates bring their own power
        raise CircuitError("Nothing is powering the circuit. Add a battery or a signal generator.")

    # ground: if none, use the minus side of the first source
    nodes_used = {n for p in parts for n in p["nodes"]}
    src = next((p for p in parts if p["type"] in SOURCES), None)
    if "0" not in nodes_used and src:
        old = src["nodes"][1]
        for p in parts:
            p["nodes"] = ["0" if n == old else n for n in p["nodes"]]
        notes.append(f"There's no ground (⏚) in your circuit, so I used the minus (-) side of {src['id']} as 0 V. "
                     "All voltages are measured from there.")

    # count how many legs touch each node
    count = {}
    for p in parts:
        if p["type"] == "ground":
            continue
        for n in p["nodes"]:
            count[n] = count.get(n, 0) + 1
    for p in real:
        pins = CATALOGUE[p["type"]][0]
        if len(set(p["nodes"])) == 1:
            if p["type"] in SOURCES:
                raise CircuitError(f"{p['id']} is shorted out - a wire joins its + and - together. "
                                   "In real life that gets very hot, very fast!", p["id"])
            notes.append(f"{p['id']} has all its legs on the same wire, so it's shorted out and nothing flows through it.")
            continue
        for n, pin in zip(p["nodes"], pins):
            if n != "0" and count.get(n, 0) < 2:
                notes.append(f"{p['id']}'s {pin} isn't connected to anything.")
    return notes, parts


def auto_duration(parts):
    """Pick a sensible time to show: 5 cycles of the slowest signal, or about 5 time constants."""
    freqs = []
    rs, cs, ls = [], [], []
    for p in parts:
        t, pr = p["type"], p["props"]
        try:
            if t in ("sine", "square"):
                freqs.append(parse_value(pr["frequency"]))
            elif t == "resistor":
                rs.append(parse_value(pr["value"]))
            elif t == "pot":
                rs.append(parse_value(pr["value"]))
            elif t == "capacitor":
                cs.append(parse_value(pr["value"]))
            elif t == "inductor":
                ls.append(parse_value(pr["value"]))
            elif t == "transformer":
                ls.append(parse_value(pr["inductance"]))
        except BadValue:
            pass
    freqs = [f for f in freqs if f > 0]
    if freqs:
        return min(10.0, 5.0 / min(freqs))
    tau = 0.0
    if cs:
        tau = max(tau, max(cs) * (max(rs) if rs else 1000.0))
    if ls:
        tau = max(tau, max(ls) / (min(rs) if rs else 1.0))
    if tau <= 0:
        # only gates and nothing slow: they switch in nanoseconds, so look at a microsecond
        return 1e-6 if any(p["type"] in GATES or p["type"] == "not" for p in parts) else 0.01
    return min(10.0, max(1e-6, 5.0 * tau))


def fastest_frequency(parts):
    """Rough upper bound on the fastest oscillation: signal sources, and the best a coil and a
    capacitor in this circuit could ever ring at (smallest L with smallest C). 0 if nothing fast."""
    fs, ls, cs = [], [], []
    for p in parts:
        t, pr = p["type"], p["props"]
        try:
            if t in ("sine", "square"):
                fs.append(parse_value(pr["frequency"]))
            elif t == "inductor":
                ls.append(parse_value(pr["value"]))
            elif t == "transformer":
                ls.append(parse_value(pr["inductance"]))
            elif t == "capacitor":
                cs.append(parse_value(pr["value"]))
        except BadValue:
            pass
    ls = [x for x in ls if x > 0]
    cs = [x for x in cs if x > 0]
    if ls and cs:
        fs.append(1.0 / (2 * math.pi * math.sqrt(min(ls) * min(cs))))
    fs = [f for f in fs if f > 0 and math.isfinite(f)]
    return max(fs) if fs else 0.0


def build(circuit):
    """Return (netlist_text, meta). meta tells the runner which vectors mean what."""
    notes, parts = check(circuit)
    def num(key, default):
        v = circuit.get(key)
        if v is None or v == "":
            return default
        try:
            v = float(v)
        except (TypeError, ValueError):
            raise CircuitError(f"The '{key}' setting isn't a number. Pick one from the menus at the top.")
        if not math.isfinite(v):
            raise CircuitError(f"The '{key}' setting isn't a sensible number. Pick one from the menus at the top.")
        return v
    temp = num("temp", 20.0)
    if not -55 <= temp <= 150:
        raise CircuitError("That temperature is outside what the part models can do (-55 to 150 °C). Pick 0, 20 or 40 °C.")
    dur = num("duration", 0.0) or auto_duration(parts)
    start = max(0.0, num("start", 0.0))                  # scope "delay": skip this long before showing
    if not (math.isfinite(dur) and dur > 0) or start + dur > 1e4:
        raise CircuitError("That time setting doesn't make sense. Pick one from the 'Show' and 'From' menus.")
    ramp = min(1e-6, dur / 1000.0)      # batteries "switch on" over this time
    fmax = fastest_frequency(parts)
    tstop = start + dur
    tmax = dur / POINTS
    if fmax:
        tmax = min(tmax, 1.0 / (STEPS_PER_CYCLE * fmax))
    steps = tstop / tmax
    if steps > MAX_STEPS:
        tmax = tstop / MAX_STEPS
        why = (f"This circuit has very fast parts (up to about {pretty(fmax, 'Hz')})" if fmax and 1.0 / (STEPS_PER_CYCLE * fmax) < dur / POINTS
               else "You asked to zoom in a long way after a long delay")
        notes.append(f"{why}, so a full run would need {steps:,.0f} tiny steps. I used bigger steps so it finishes - "
                     "the waveform may look a bit rough. For a cleaner picture, make 'From' smaller or 'Show' longer.")
        steps = MAX_STEPS
    elif steps > 250000:
        notes.append(f"This one needs about {steps:,.0f} tiny steps because something in it is very fast, so it can take a "
                     "little while.")

    lines = [f"* Spicey Electrons circuit at {temp:g} C", ".options rshunt=1e12 reltol=1e-3 method=gear", f".temp {temp:g}"]
    models = {}
    currents = {}       # part id -> (spice vector, sign, label)
    pinvecs = {}        # part id -> {pin index: spice vector of the current flowing INTO that pin}
    nodes = set()

    for p in parts:
        t, pid, pr = p["type"], _safe(p["id"]), p["props"]
        if t == "ground":
            continue
        n = [_safe(x) if x != "0" else "0" for x in p["nodes"]]
        nodes.update(x for x in n if x != "0")
        # hidden ammeter: which leg and which sign makes "positive" the obvious direction
        leg = {"npn": 1, "nmos": 1, "pnp": 1, "opamp": 2, "555": 3, "not": 1, **{g: 2 for g in GATES}}.get(t, 0)
        sign = -1.0 if t in SOURCES or t in ("pnp", "opamp", "555", "not") or t in GATES else 1.0
        if t == "pnp":
            sign = -1.0   # show collector current flowing OUT of a PNP collector as positive
        amm = f"vam_{pid}"
        inner = f"{pid}_am"
        lines.append(f"{amm} {n[leg]} {inner} 0")
        currents[p["id"]] = (f"i({amm.lower()})", sign)
        pinvecs[p["id"]] = {leg: f"i({amm.lower()})"}
        n = list(n)
        n[leg] = inner
        if t in ("npn", "pnp", "nmos", "555", "pot", "transformer", "relay"):    # measure every pin so wire currents add up
            for k in range(len(n)):
                if k != leg:
                    lines.append(f"vam_{pid}_p{k} {n[k]} {pid}_p{k} 0")
                    pinvecs[p["id"]][k] = f"i(vam_{pid}_p{k})".lower()
                    n[k] = f"{pid}_p{k}"

        if t == "resistor":
            lines.append(f"R_{pid} {n[0]} {n[1]} {_num(pr, 'value', p['id'], 'resistance', True):.6g}")
        elif t == "capacitor":
            lines.append(f"C_{pid} {n[0]} {n[1]} {_num(pr, 'value', p['id'], 'capacitance', True):.6g}")
        elif t == "inductor":
            lines.append(f"L_{pid} {n[0]} {pid}_l {_num(pr, 'value', p['id'], 'inductance', True):.6g}")
            lines.append(f"R_{pid}_w {pid}_l {n[1]} 0.01")     # a little wire resistance
        elif t == "diode":
            m = pr.get("model", "1N4148")
            if m not in DIODE_MODELS:
                m = "1N4148"
            models[m] = f".model {m} {DIODE_MODELS[m]}"
            lines.append(f"D_{pid} {n[0]} {n[1]} {m}")
        elif t == "led":
            c = str(pr.get("color", "red")).lower()
            mname = f"LED_{_safe(c)}"
            models[mname] = f".model {mname} {led_model(c)}"
            lines.append(f"D_{pid} {n[0]} {n[1]} {mname}")
        elif t == "battery":
            v = _num(pr, "voltage", p["id"], "voltage")
            lines.append(f"V_{pid} {pid}_int {n[1]} PWL(0 0 {ramp:.4g} {v:.6g})")
            lines.append(f"R_{pid}_in {n[0]} {pid}_int 0.1")    # internal resistance
        elif t == "sine":
            a = _num(pr, "amplitude", p["id"], "amplitude")
            f = _num(pr, "frequency", p["id"], "frequency", True)
            o = _num(pr, "offset", p["id"], "offset")
            lines.append(f"V_{pid} {pid}_int {n[1]} SIN({o:.6g} {a:.6g} {f:.6g})")
            lines.append(f"R_{pid}_in {n[0]} {pid}_int 0.1")
        elif t == "square":
            hi = _num(pr, "high", p["id"], "high voltage")
            lo = _num(pr, "low", p["id"], "low voltage")
            f = _num(pr, "frequency", p["id"], "frequency", True)
            duty = max(1.0, min(99.0, _num(pr, "duty", p["id"], "duty")))
            per = 1.0 / f
            edge = per / 1000.0
            on = per * duty / 100.0 - edge
            lines.append(f"V_{pid} {pid}_int {n[1]} PULSE({lo:.6g} {hi:.6g} 0 {edge:.4g} {edge:.4g} {on:.6g} {per:.6g})")
            lines.append(f"R_{pid}_in {n[0]} {pid}_int 0.1")
        elif t == "zener":
            vz = _num(pr, "vz", p["id"], "Zener voltage", True)
            mname = "DZ" + _safe(f"{vz:g}")
            models[mname] = f".model {mname} D(IS=1e-14 N=1 RS=2 BV={vz:.6g} IBV=5m CJO=50p)"
            lines.append(f"D_{pid} {n[0]} {n[1]} {mname}")
        elif t == "lamp":
            v = _num(pr, "volts", p["id"], "lamp voltage", True)
            a = _num(pr, "amps", p["id"], "lamp current", True)
            rh, pw, x = v / a, v * a, f"{pid}_x"
            nodes.add(x)
            r = f"({rh:.6g}*(0.1+0.9*abs(v({x}))))"       # a cold filament is about 10x less resistive
            lines.append(f"B_{pid} {n[0]} {n[1]} I = v({n[0]},{n[1]})/{r}")
            lines.append(f"C_{pid}_x {x} 0 1")
            lines.append(f"B_{pid}_t 0 {x} I = (((v({n[0]},{n[1]})*v({n[0]},{n[1]})/{r})/{pw:.6g}+1e-9)^0.25 - v({x}))/0.15")
            lines.append(f".ic v({x})=0")
        elif t == "speaker":
            ohms = _num(pr, "ohms", p["id"], "speaker resistance", True)
            lines.append(f"R_{pid} {n[0]} {pid}_l {ohms:.6g}")
            lines.append(f"L_{pid} {pid}_l {n[1]} 0.5m")
        elif t == "relay":
            vc = _num(pr, "coil", p["id"], "coil voltage", True)
            rc = vc * vc / 0.36
            lines.append(f"R_{pid}_c {n[0]} {pid}_l {rc:.6g}")
            lines.append(f"L_{pid} {pid}_l {n[1]} {rc * 1.5e-3:.6g}")
            mname = f"SWR_{pid}"
            models[mname] = f".model {mname} SW(VT={0.525 * vc:.6g} VH={0.225 * vc:.6g} RON=0.05 ROFF=1e9)"
            lines.append(f"S_{pid} {n[2]} {n[3]} {n[0]} {n[1]} {mname}")
        elif t == "motor":
            vr = _num(pr, "volts", p["id"], "motor voltage", True)
            ke, w = vr / 300.0, f"{pid}_w"
            nodes.add(w)
            lines.append(f"R_{pid} {n[0]} {pid}_a 5")
            lines.append(f"L_{pid} {pid}_a {pid}_b 2m")
            lines.append(f"V_{pid}_s {pid}_b {pid}_c 0")
            lines.append(f"B_{pid}_e {pid}_c {n[1]} V = {ke:.6g}*v({w})")
            lines.append(f"C_{pid}_w {w} 0 8u")
            lines.append(f"B_{pid}_w 0 {w} I = {ke:.6g}*i(V_{pid}_s) - {ke * 0.042 / 300.0:.6g}*v({w})")
            lines.append(f".ic v({w})=0")
        elif t == "ldr":
            lt = max(0.0, min(100.0, _num(pr, "light", p["id"], "light level")))
            lines.append(f"R_{pid} {n[0]} {n[1]} {100e3 * 0.5 ** (lt / 12.5):.6g}")
        elif t == "thermistor":
            r25 = _num(pr, "r25", p["id"], "resistance at 25 C", True)
            tk = temp + _num(pr, "warm", p["id"], "extra warmth") + 273.15
            lines.append(f"R_{pid} {n[0]} {n[1]} {r25 * math.exp(3950 * (1 / tk - 1 / 298.15)):.6g}")
        elif t == "switch":
            closed = pr.get("closed") in (True, "true", "1", 1, "closed")
            lines.append(f"R_{pid} {n[0]} {n[1]} {'0.01' if closed else '1e9'}")
        elif t == "pot":
            total = _num(pr, "value", p["id"], "resistance", True)
            pos = max(0.0, min(100.0, _num(pr, "position", p["id"], "position"))) / 100.0
            lines.append(f"R_{pid}_a {n[0]} {n[2]} {max(total * pos, 0.01):.6g}")
            lines.append(f"R_{pid}_b {n[2]} {n[1]} {max(total * (1 - pos), 0.01):.6g}")
        elif t in ("npn", "pnp"):
            m = pr.get("model", "2N3904" if t == "npn" else "2N3906")
            if m not in BJT_MODELS or (t == "pnp") != BJT_MODELS[m].startswith("PNP"):
                m = "2N3904" if t == "npn" else "2N3906"
            models[m] = f".model {m} {BJT_MODELS[m]}"
            # SPICE order is C B E
            lines.append(f"Q_{pid} {n[1]} {n[0]} {n[2]} {m}")
        elif t == "nmos":
            m = pr.get("model", "2N7000")
            if m not in MOS_MODELS:
                m = "2N7000"
            models[m] = f".model {m} {MOS_MODELS[m]}"
            # SPICE order is D G S B
            lines.append(f"M_{pid} {n[1]} {n[0]} {n[2]} {n[2]} {m}")
            # real pin capacitances: Cgd is the "Miller" capacitance; set either to 0 to see what it does
            for key, a, b, what in (("cgs", 0, 2, "gate-source capacitance"), ("cgd", 0, 1, "gate-drain capacitance")):
                cv = _num(pr, key, p["id"], what)
                if cv < 0:
                    raise CircuitError(f"{p['id']}: the {what} can't be negative.", p["id"])
                if cv > 0:
                    lines.append(f"C_{pid}_{key} {n[a]} {n[b]} {cv:.6g}")
            lines.append(f"C_{pid}_ds {n[1]} {n[2]} 8p")
        elif t == "transformer":
            lp = _num(pr, "inductance", p["id"], "primary inductance", True)
            ratio = _num(pr, "ratio", p["id"], "turns ratio", True)
            if not 0.001 <= ratio <= 1000:
                raise CircuitError(f"{p['id']}: a turns ratio of {ratio:g} is out of range. Try something between 0.001 and 1000 "
                                   "(0.1 steps the voltage down 10 times, 10 steps it up 10 times).", p["id"])
            k = max(0.01, min(0.9999, _num(pr, "coupling", p["id"], "coupling")))
            ls_ = lp * ratio * ratio            # inductance goes with turns squared
            rs_ = max(0.01, 0.1 * ratio * ratio)  # winding resistance grows with the wire length
            lines.append(f"L_{pid}p {n[0]} {pid}_pl {lp:.6g}")
            lines.append(f"R_{pid}_pw {pid}_pl {n[1]} 0.1")
            lines.append(f"L_{pid}s {n[2]} {pid}_sl {ls_:.6g}")
            lines.append(f"R_{pid}_sw {pid}_sl {n[3]} {rs_:.6g}")
            lines.append(f"K_{pid} L_{pid}p L_{pid}s {k:.6g}")
        elif t in GATES or t == "not":
            hv = abs(_num(pr, "level", p["id"], "logic voltage", True))
            ins = n[:-1]
            hs = []
            for k, x in enumerate(ins):
                lines.append(f"R_{pid}_i{k} {x} 0 10Meg")
                hs.append(f"(0.5*(1+tanh((v({x})-{hv / 2:.6g})/{0.04 * hv:.6g})))")
            a_, b_ = hs[0], hs[-1]
            expr = {"and": f"{a_}*{b_}", "or": f"(1-(1-{a_})*(1-{b_}))", "nand": f"(1-{a_}*{b_})", "nor": f"((1-{a_})*(1-{b_}))",
                    "xor": f"({a_}+{b_}-2*{a_}*{b_})", "not": f"(1-{a_})"}[t]
            lines.append(f"B_{pid} {pid}_x 0 V = {hv:.6g}*{expr}")
            # about 10 ns of delay, like a 74HC chip. No two real chips are identical: each gate gets a
            # slightly different delay and alternate gates power up low or high, so a ring of gates
            # starts oscillating instead of balancing on the knife edge.
            gate_no = sum(1 for q in lines if q.startswith("B_") and "_buf " in q)
            lines.append(f"R_{pid}_d {pid}_x {pid}_y {1000 * (1 + 0.03 * (gate_no % 7)):.6g}")
            lines.append(f"C_{pid}_d {pid}_y 0 10p")
            lines.append(f"B_{pid}_buf {pid}_o 0 V = v({pid}_y)")
            lines.append(f"R_{pid}_out {pid}_o {n[-1]} 50")
            lines.append(f".ic v({pid}_y)={hv if gate_no % 2 else 0:.6g}")
        elif t == "555":
            vc, gn, tg, out, th, dis = n
            lines += [f"R_{pid}_sup {vc} {gn} 2k",                      # it uses a few mA, like the real chip
                      f"C_{pid}_q {pid}_q {gn} 100p",
                      f"B_{pid}_s {gn} {pid}_q I = 1m*(0.5*(1+tanh(((v({vc},{gn}))/3-v({tg},{gn}))/0.02))*(1-0.5*(1+tanh((v({th},{gn})-2*v({vc},{gn})/3)/0.02)))*(1-v({pid}_q,{gn}))"
                      f" - 0.5*(1+tanh((v({th},{gn})-2*v({vc},{gn})/3)/0.02))*v({pid}_q,{gn})"
                      f" + 1.2*v({pid}_q,{gn})*(1-v({pid}_q,{gn}))*(2*v({pid}_q,{gn})-1))",   # makes it a latch: it remembers 0 or 1
                      f"B_{pid}_o {pid}_o {gn} V = v({vc},{gn})*(0.5+0.5*tanh(12*(v({pid}_q,{gn})-0.5)))",
                      f"R_{pid}_out {pid}_o {out} 15",
                      f"B_{pid}_b {pid}_qb {gn} V = 1-v({pid}_q,{gn})",
                      f"S_{pid} {dis} {gn} {pid}_qb {gn} SW555"]
            models["SW555"] = ".model SW555 SW(Vt=0.5 Vh=0.05 Ron=20 Roff=1e12)"
        elif t == "opamp":
            rails = abs(_num(pr, "rails", p["id"], "supply voltage", True))
            lines.append(f"R_{pid}_in {n[0]} {n[1]} 10Meg")
            # smooth clip at the rails, gain 100,000, 50 ohm output
            lines.append(f"B_{pid} {pid}_o 0 V = {rails:.6g}*tanh(1e5*(v({n[1]})-v({n[0]}))/{rails:.6g})")
            lines.append(f"R_{pid}_out {pid}_o {n[2]} 50")

    lines.extend(models.values())
    step = dur / POINTS
    vecs = [f"v({x})" for x in sorted(nodes)] + [v for v, _ in currents.values()]
    vecs += [v for d in pinvecs.values() for v in d.values() if v not in vecs]
    lines += [
        ".control",
        "set filetype=binary",
        f"tran {step:.6g} {tstop:.9g} {start:.9g} {tmax:.6g}",
        "write __OUT__ " + " ".join(vecs),
        "quit",
        ".endc",
        ".end",
    ]
    meta = {
        "nodes": sorted(nodes),
        "currents": currents,
        "pinvecs": pinvecs,
        "duration": dur,
        "start": start,
        "fmax": fmax,
        "steps": steps,
        "temp": temp,
        "notes": notes,
        "parts": parts,
    }
    return "\n".join(lines) + "\n", meta


def describe_duration(d):
    return pretty(d, "s")
