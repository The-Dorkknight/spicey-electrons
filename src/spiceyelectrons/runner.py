# Required Notice: Copyright Matthew Armstrong (https://github.com/The-Dorkknight)
# Licensed under the PolyForm Noncommercial License 1.0.0. No warranty.
"""Run ngspice as a separate process, read its results and turn them into friendly answers.

ngspice runs in its own process, so if it crashes or hangs only that run is lost:
the app stays up, shows a heartbeat while it works, and kills it at the time limit.
"""
import collections
import copy
import hashlib
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from array import array
from bisect import bisect_left

from .netlist import build, CircuitError, POINTS
from .parts import LIMITS, CATALOGUE
from .units import parse_value, pretty

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
TIME_LIMIT = float(os.environ.get("SE_TIME_LIMIT", "120"))   # seconds before we give up


def find_ngspice():
    """Find a console ngspice. Returns a path or None."""
    exe = ".exe" if os.name == "nt" else ""
    names = ["ngspice_con" + exe, "ngspice" + exe] if os.name == "nt" else ["ngspice"]
    for n in names:
        p = shutil.which(n)
        if p:
            return p
    dirs = [os.path.join(ROOT, "tools", "Spice64", "bin"), os.path.join(ROOT, "tools", "ngspice", "bin"),
            r"C:\Spice64\bin", r"C:\Program Files\Spice64\bin", r"C:\Program Files\ngspice\bin",
            "/opt/homebrew/bin", "/usr/local/bin", "/home/linuxbrew/.linuxbrew/bin", "/usr/bin"]
    for d in dirs:
        for n in names:
            p = os.path.join(d, n)
            if os.path.isfile(p):
                return p
    return None


def _read_raw(path):
    """Read ngspice's binary raw file into {vector name: array('d')}. Names are lower case, e.g. 'v(c)', 'time'."""
    with open(path, "rb") as f:
        buf = f.read()
    cut = buf.find(b"Binary:\n")
    if cut < 0:
        return {}
    names, nvars, in_vars = [], 0, False
    for line in buf[:cut].decode("latin-1").splitlines():
        if line.startswith("No. Variables:"):
            nvars = int(line.split(":")[1])
        elif line.startswith("Variables:"):
            in_vars = True
        elif in_vars and line.strip():
            names.append(line.split()[1].lower())
    if not nvars or len(names) != nvars:
        return {}
    body = buf[cut + 8:]
    rows = len(body) // (8 * nvars)                 # trust the bytes, not the header (a killed run may be short)
    vals = array("d")
    vals.frombytes(body[: rows * nvars * 8])
    if sys.byteorder == "big":
        vals.byteswap()
    return {n: vals[i::nvars] for i, n in enumerate(names)}


def _grid(t, n):
    """n evenly spaced times from t[0] to t[-1], and for each the index of the first raw sample at or after it."""
    t0, t1 = t[0], t[-1]
    grid = [t0 + (t1 - t0) * i / (n - 1) for i in range(n)]
    return grid, [bisect_left(t, g) for g in grid]


def _sample(t, y, grid, idx):
    """Linear interpolation of y(t) at the grid times. Non-finite numbers (a diverged run) become 0."""
    out, m = [], len(t)
    for g, i in zip(grid, idx):
        if i <= 0:
            v = y[0]
        elif i >= m:
            v = y[-1]
        else:
            ta, tb = t[i - 1], t[i]
            v = y[i - 1] if tb == ta else y[i - 1] + (y[i] - y[i - 1]) * (g - ta) / (tb - ta)
        out.append(v if math.isfinite(v) else 0.0)
    return out


def _envelope(t, y, grid, centre):
    """Scope-style min/max per grid cell, so a signal too fast to draw still shows as a band."""
    n = len(grid)
    h = (grid[-1] - grid[0]) / (n - 1) if n > 1 else 0.0
    edges = [bisect_left(t, g - h / 2) for g in grid] + [len(t)]
    lo, hi = [], []
    for j in range(n):
        a, b = edges[j], edges[j + 1]
        if b - a >= 1:
            seg = y[a:b]
            l, u = min(seg), max(seg)
            if not (math.isfinite(l) and math.isfinite(u)):
                l = u = centre[j]
        else:
            l = u = centre[j]
        lo.append(l)
        hi.append(u)
    return lo, hi


def _crossings(t, y, min_pp):
    """Times where the signal rises through its middle (with hysteresis, so noise isn't counted).
    Returns a list of times, or None if the signal barely moves."""
    step = max(1, len(y) // 300000)
    ys, ts = y[::step], t[::step]
    if len(ys) < 8:
        return None
    lo, hi = min(ys), max(ys)
    if not (math.isfinite(lo) and math.isfinite(hi)) or hi - lo < min_pp:
        return None
    mid = sum(ys) / len(ys)                        # the average level works for narrow pulses as well as sines
    dn = mid - 0.08 * (hi - lo)
    cr, armed, py, pt = [], False, ys[0], ts[0]
    for tt, yy in zip(ts, ys):
        if yy < dn:
            armed = True
        if armed and py < mid <= yy:
            cr.append(pt + (mid - py) / (yy - py) * (tt - pt))
            armed = False
        py, pt = yy, tt
    return cr


def _frequency(cr, grid):
    """(average Hz, [Hz at each grid time or None]) from rising-crossing times. None if it isn't oscillating."""
    if cr is None or len(cr) < 8:
        return None
    per = [cr[i + 1] - cr[i] for i in range(len(cr) - 1)]
    med = sorted(per)[len(per) // 2]
    ok = [0.7 * med <= p <= 1.4 * med for p in per]         # a gap, a glitch or a missed crossing isn't a period
    mids = [(cr[i] + cr[i + 1]) / 2 for i in range(len(per))]
    avg_p = [p for p, g in zip(per, ok) if g]
    if len(avg_p) < 7:
        return None
    trace = []
    for g in grid:
        if g < cr[0] or g > cr[-1]:
            trace.append(None)
            continue
        j = bisect_left(mids, g)
        j = min(max(j, 0), len(per) - 1)
        if j > 0 and abs(mids[j - 1] - g) < abs(mids[j] - g):
            j -= 1
        pick = [per[k] for k in range(max(0, j - 1), min(len(per), j + 2)) if ok[k]]
        trace.append(1.0 / (sum(pick) / len(pick)) if pick else None)
    return len(avg_p) / sum(avg_p), trace


def friendly_error(text):
    low = text.lower()
    if "singular matrix" in low:
        return ("The simulator couldn't find an answer - usually two batteries or signal generators are wired "
                "straight across each other, or a part is only connected by one leg.")
    if "timestep too small" in low:
        return ("The simulation got stuck because something changes impossibly fast. Try putting a resistor "
                "in series with the capacitor, coil or battery.")
    if "gmin stepping failed" in low or "source stepping failed" in low:
        return ("The simulator couldn't work out how the circuit starts up. Check that every part has both legs "
                "connected, and that nothing is shorted.")
    if "unknown model" in low or "could not find" in low:
        return "One of the parts uses a model I don't have."
    return "The simulator wasn't happy with this circuit. The details below may help."


def safety_warnings(parts, res):
    """Kid-friendly 'this would burn out' checks on the results."""
    out = []
    cur = res["currents"]
    for p in parts:
        t, pid, pr = p["type"], p["id"], p["props"]
        i = cur.get(pid)
        if i is None or max((abs(x) for x in i), default=0.0) < 1e-9:
            continue                                   # nothing but numerical dust is flowing: nothing to judge
        # judge on the second half of the run (a brief switch-on surge is normal for real parts),
        # but a surge 10x over the limit still counts
        half = i[len(i) // 2:] or i
        steady = sum(abs(x) for x in half) / len(half)
        rms2 = sum(x * x for x in half) / len(half)
        surge = max((abs(x) for x in i), default=0.0)
        peak = max(steady, surge / 10.0)
        try:
            if t == "led" and peak > LIMITS["led_max_a"]:
                out.append({"part": pid, "level": "burn",
                            "text": f"{pid} would burn out! {pretty(peak, 'A')} is flowing, but an LED only likes about "
                                    "20 mA. Add a resistor in series (around 330 Ω to 1 kΩ for a 9 V battery)."})
            elif t == "resistor":
                r = parse_value(pr["value"])
                w = max(rms2, (surge / 10.0) ** 2) * r
                if w > LIMITS["resistor_smoke_w"]:
                    out.append({"part": pid, "level": "burn",
                                "text": f"{pid} would smoke! It's turning {pretty(w, 'W')} into heat, and a normal "
                                        "resistor handles 0.25 W."})
                elif w > LIMITS["resistor_w"]:
                    out.append({"part": pid, "level": "hot",
                                "text": f"{pid} is getting hot: {pretty(w, 'W')}. A normal resistor is happy up to 0.25 W - "
                                        "use a bigger (0.5 W or 1 W) one or a larger value."})
            elif t in ("battery", "sine", "square") and peak > LIMITS["battery_short_a"]:
                out.append({"part": pid, "level": "burn",
                            "text": f"{pid} is nearly short-circuited: {pretty(peak, 'A')} is flowing. A real "
                                    f"{'battery' if t == 'battery' else 'power source'} would "
                                    "get hot or give up. Is there a resistor in the way?"})
            elif t in ("npn", "pnp"):
                lim = LIMITS["bjt_max_a"].get(pr.get("model"), 0.2)
                if peak > lim:
                    out.append({"part": pid, "level": "burn",
                                "text": f"{pid} is overloaded: {pretty(peak, 'A')} through the collector, but it's only good "
                                        f"for about {pretty(lim, 'A')}."})
            elif t == "nmos":
                lim = LIMITS["mos_max_a"].get(pr.get("model"), 0.2)
                if peak > lim:
                    out.append({"part": pid, "level": "hot",
                                "text": f"{pid} is working hard: {pretty(peak, 'A')} through the drain (2N7000 is rated "
                                        f"{pretty(lim, 'A')} continuous)."})
            elif t == "zener":
                w = parse_value(pr["vz"]) * steady
                if w > LIMITS["zener_w"]:
                    out.append({"part": pid, "level": "burn",
                                "text": f"{pid} would burn out! It's turning about {pretty(w, 'W')} into heat; a small Zener "
                                        "handles 0.5 W. Add a bigger series resistor."})
            elif t == "lamp":
                if steady > 1.2 * parse_value(pr["amps"]):
                    out.append({"part": pid, "level": "burn",
                                "text": f"{pid} would pop! It's getting far more than its {pr['volts']} V - the filament would melt."})
            elif t == "motor" and peak > LIMITS["motor_stall_a"]:
                out.append({"part": pid, "level": "hot",
                            "text": f"{pid} is drawing {pretty(peak, 'A')}. That's what a stuck (stalled) motor does - it gets hot fast."})
            elif t == "diode":
                lim = LIMITS["diode_max_a"].get(pr.get("model"), 0.3)
                if peak > lim:
                    out.append({"part": pid, "level": "burn",
                                "text": f"{pid} is overloaded: {pretty(peak, 'A')} (it's rated about {pretty(lim, 'A')})."})
            elif t == "555" and peak > LIMITS["ic555_out_a"]:
                out.append({"part": pid, "level": "burn",
                            "text": f"{pid}'s output is overloaded: {pretty(peak, 'A')}, but a 555 can only give about 200 mA. "
                                    "Put a resistor (or a transistor) between the output and what it drives."})
            elif (t in ("and", "or", "nand", "nor", "xor", "not")) and peak > LIMITS["gate_out_a"]:
                out.append({"part": pid, "level": "burn",
                            "text": f"{pid}'s output is overloaded: {pretty(peak, 'A')}, but a logic gate only gives about 25 mA. "
                                    "Add a resistor (about 330 Ω for an LED)."})
        except Exception:
            pass
    # transistors: too much voltage across them (a coil kicking when it is switched off, for instance)
    def _swing(node):
        if node == "0":
            return 0.0, 0.0
        e = res["env"].get("v:" + node)
        if e:
            return min(e[0]), max(e[1])
        v = res["voltages"].get(node)
        return (min(v), max(v)) if v else (0.0, 0.0)
    for p in parts:
        if p["type"] not in ("npn", "pnp", "nmos") or len(p["nodes"]) < 3:
            continue
        lim = 60.0 if p["type"] == "nmos" else 40.0
        lo_c, hi_c = _swing(p["nodes"][1])
        lo_e, hi_e = _swing(p["nodes"][2])
        worst = max(abs(hi_c - lo_e), abs(lo_c - hi_e))
        if worst > lim * 1.1:
            out.append({"part": p["id"], "level": "burn",
                        "text": f"{p['id']} would be destroyed! It sees {pretty(worst, 'V')} across it but it's only good for "
                                f"about {lim:.0f} V. (A coil switched off with nothing to catch its kick does this - "
                                "add a diode across the coil.)"})
    # supply checks for the 555 (it has real supply pins)
    for p in parts:
        if p["type"] != "555":
            continue
        vc, gn = p["nodes"][0], p["nodes"][1]
        va, vb = res["voltages"].get(vc), res["voltages"].get(gn)
        if va is None and vc != "0" or vb is None and gn != "0":
            continue
        d = [(va[k] if va else 0.0) - (vb[k] if vb else 0.0) for k in range(len(va or vb))]
        if d and min(d) < -0.5:
            out.append({"part": p["id"], "level": "burn",
                        "text": f"{p['id']} is wired the wrong way round: pin 8 (+V) is below pin 1 (ground). A real 555 would be ruined."})
        elif d and max(d) > LIMITS["ic555_max_v"]:
            out.append({"part": p["id"], "level": "burn",
                        "text": f"{p['id']} has {pretty(max(d), 'V')} across it, but a 555 is only good up to 16 V."})
    return out


def _proc_stats(pid):
    """CPU seconds and memory of a running process (Linux only; returns None elsewhere)."""
    try:
        with open(f"/proc/{pid}/stat") as f:
            parts = f.read().rsplit(")", 1)[1].split()
        tick = os.sysconf("SC_CLK_TCK")
        cpu = (int(parts[11]) + int(parts[12])) / tick
        rss = int(parts[21]) * os.sysconf("SC_PAGE_SIZE")
        return cpu, rss
    except Exception:
        return None


# Last few finished runs, keyed by the exact netlist: running the same circuit again (Run pressed twice, undo/redo,
# changing a value and changing it back) is then instant instead of re-running ngspice.
CACHE = collections.OrderedDict()
CACHE_MAX = 6
# ngspice sometimes prints that it has given up but then sits there for the whole time limit (a floating pin, two
# batteries across each other). When the log says so we stop after a short grace period instead of waiting.
FATAL = re.compile(r"run simulation\(s\) aborted|timestep too small|doAnalyses: .*(?:aborted|failed)", re.I)


def simulate(circuit, job=None):
    """Run one simulation. Returns a dict (always - errors are returned, not raised)."""
    t_start = time.time()
    try:
        net, meta = build(circuit)
    except CircuitError as e:
        return {"ok": False, "error": str(e), "part": e.part}
    ckey = hashlib.sha1((net + "|" + str(circuit.get("time_limit", ""))).encode()).hexdigest()
    hit = CACHE.get(ckey)
    if hit is not None and not os.environ.get("SE_TEST_CRASH"):
        CACHE.move_to_end(ckey)
        res = copy.deepcopy(hit)
        res["seconds"] = round(time.time() - t_start, 3)
        res["cached"] = True
        return res
    exe = find_ngspice()
    if not exe:
        return {"ok": False, "error": "I can't find ngspice (the simulation engine). Run the launcher again and "
                                      "let it install ngspice, or see README > 'Installing ngspice'.",
                "netlist": net}
    tmp = tempfile.mkdtemp(prefix="se_")
    out = os.path.join(tmp, "out.raw")
    cir = os.path.join(tmp, "circuit.cir")
    with open(cir, "w") as f:
        f.write(net.replace("__OUT__", out.replace("\\", "/")))
    crash = os.environ.get("SE_TEST_CRASH")       # test hook: "hang" or "crash"
    cmd = [exe, "-b", cir]
    if crash == "hang":
        cmd = [sys.executable, "-c", "import time; time.sleep(3600)"]
    elif crash == "stuck":      # says it gave up, then sits there (like ngspice with a floating pin)
        cmd = [sys.executable, "-u", "-c", "import time; print('Error: Transient op failed, timestep too small'); "
                                           "print('run simulation(s) aborted'); time.sleep(3600)"]
    elif crash == "crash":
        cmd = [sys.executable, "-c", "import os; os._exit(139)"]
    try:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, cwd=tmp,
                                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    except OSError as e:
        return {"ok": False, "error": f"Couldn't start ngspice: {e}", "netlist": net}
    if job is not None:
        job["proc"] = proc
    log_chunks = []
    fatal = {"at": None}

    def read_log():
        for line in iter(proc.stdout.readline, b""):
            log_chunks.append(line)
            if fatal["at"] is None and FATAL.search(line.decode("utf-8", "replace")):
                fatal["at"] = time.time()
    reader = threading.Thread(target=read_log, daemon=True)
    reader.start()
    limit = float(circuit.get("time_limit", TIME_LIMIT))

    def stop():
        if proc.poll() is None:
            proc.kill()
            proc.wait(5)
        reader.join(2)
        proc.stdout.close()

    while proc.poll() is None:
        el = time.time() - t_start
        if job is not None:
            st = _proc_stats(proc.pid)
            job["heartbeat"] = {"elapsed": round(el, 1),
                                "cpu": round(st[0], 1) if st else None,
                                "mem_mb": round(st[1] / 1e6) if st else None}
            if job.get("cancel"):
                stop()
                return {"ok": False, "error": "Stopped.", "netlist": net}
        if fatal["at"] and time.time() - fatal["at"] > 1.0:       # it said it gave up; do not wait for the limit
            stop()
            log = b"".join(log_chunks).decode("utf-8", "replace")
            return {"ok": False, "error": friendly_error(log), "details": log[-3000:], "netlist": net}
        if el > limit:
            stop()
            return {"ok": False, "netlist": net,
                    "error": f"The simulation took longer than {limit:.0f} s, so I stopped it. Try a shorter time "
                             "on the 'Show' menu, or a slower signal."}
        time.sleep(0.1)
    stop()
    log = b"".join(log_chunks).decode("utf-8", "replace")
    if proc.returncode != 0 or not os.path.isfile(out):
        msg = friendly_error(log) if log.strip() else "The simulator stopped unexpectedly (it may have crashed)."
        return {"ok": False, "error": msg, "details": log[-3000:], "netlist": net}
    data = _read_raw(out)
    t = data.get("time", [])
    if len(t) < 2:
        return {"ok": False, "error": friendly_error(log), "details": log[-3000:], "netlist": net}
    grid, idx = _grid(t, POINTS)
    res = {"ok": True, "netlist": net, "duration": meta["duration"], "start": meta["start"], "temp": meta["temp"],
           "notes": list(meta["notes"]), "voltages": {"0": [0.0] * POINTS}, "currents": {}, "env": {}, "freq": {},
           "raw_points": len(t)}
    raw = {}                                             # key -> raw array, for envelopes and frequency
    for node in meta["nodes"]:
        y = data.get(f"v({node.lower()})")
        if y is not None:
            res["voltages"][node] = _sample(t, y, grid, idx)
            raw["v:" + node] = y
    for pid, (vec, sign) in meta["currents"].items():
        y = data.get(vec)
        if y is not None:
            res["currents"][pid] = [sign * v for v in _sample(t, y, grid, idx)]
            raw["i:" + pid] = y
    res["pins"] = {}                                     # current INTO each pin of each part (for the moving dots on wires)
    for pid, d in meta["pinvecs"].items():
        npin = next((len(p["nodes"]) for p in meta["parts"] if p["id"] == pid), 0)
        arrs = [None] * npin
        for k, vec in d.items():
            y = data.get(vec)
            if y is not None and k < npin:
                arrs[k] = _sample(t, y, grid, idx)
        if npin == 2 and (arrs[0] is None) != (arrs[1] is None):
            known = arrs[0] if arrs[0] is not None else arrs[1]
            arrs = [known, [-v for v in known]] if arrs[0] is not None else [[-v for v in known], known]
        res["pins"][pid] = arrs
    res["time"] = grid
    if any(not math.isfinite(sum(y)) for y in raw.values()):
        res["notes"].append("Part of this run produced impossible numbers (NaN or infinity), so I drew those bits as 0. "
                            "Something in the circuit is probably being pushed far past what it can do.")
    if len(t) >= 1.5 * POINTS:                             # more raw samples than pixels: keep the min/max band
        for key, y in raw.items():
            kind, name = key.split(":", 1)
            sign = -1.0 if kind == "i" and meta["currents"][name][1] < 0 else 1.0
            centre = res["voltages"][name] if kind == "v" else res["currents"][name]
            lo, hi = _envelope(t, y, grid, [sign * c for c in centre])
            if sign < 0:
                lo, hi = [-x for x in hi], [-x for x in lo]
            if any(h - l > 0 for l, h in zip(lo, hi)):
                res["env"][key] = [lo, hi]
    for node in meta["nodes"]:                           # frequency of anything that is oscillating
        y = raw.get("v:" + node)
        if y is None:
            continue
        f = _frequency(_crossings(t, y, 2e-6), grid)
        if f:
            res["freq"][node] = {"avg": f[0], "trace": f[1]}
    res["warnings"] = safety_warnings(meta["parts"], res)
    res["seconds"] = round(time.time() - t_start, 3)
    # round to keep the reply small
    for pid, arrs in res["pins"].items():
        res["pins"][pid] = [None if a is None else [float(f"{v:.4g}") for v in a] for a in arrs]
    for d in (res["voltages"], res["currents"]):
        for k in d:
            d[k] = [float(f"{v:.5g}") for v in d[k]]
    res["time"] = [float(f"{v:.10g}") for v in res["time"]]
    for key, (lo, hi) in res["env"].items():
        res["env"][key] = [[float(f"{v:.5g}") for v in lo], [float(f"{v:.5g}") for v in hi]]
    for node, f in res["freq"].items():
        f["avg"] = float(f"{f['avg']:.6g}")
        f["trace"] = [None if v is None else float(f"{v:.5g}") for v in f["trace"]]
    try:
        os.remove(out)
        os.remove(cir)
        os.rmdir(tmp)
    except OSError:
        pass
    CACHE[ckey] = copy.deepcopy(res)
    while len(CACHE) > CACHE_MAX:
        CACHE.popitem(last=False)
    return res


# ---------------------------------------------------------------- background jobs
JOBS = {}


def start_job(circuit):
    jid = uuid.uuid4().hex[:10]
    job = {"id": jid, "state": "running", "started": time.time(), "heartbeat": {"elapsed": 0}}
    JOBS[jid] = job

    def work():
        try:
            job["result"] = simulate(circuit, job)
        except Exception as e:   # never let a bug kill the server
            job["result"] = {"ok": False, "error": f"Internal error: {e}"}
        job["state"] = "done"
        job.pop("proc", None)

    threading.Thread(target=work, daemon=True).start()
    # tidy old jobs
    for k in [k for k, j in JOBS.items() if j["state"] == "done" and time.time() - j["started"] > 600]:
        JOBS.pop(k, None)
    return jid
