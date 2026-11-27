# Required Notice: Copyright Matthew Armstrong (https://github.com/The-Dorkknight)
# Licensed under the PolyForm Noncommercial License 1.0.0. No warranty.
"""The web version (site/) must give the same answers as the Python reference.

The Python app is the safe fallback and the reference: these tests prove the JavaScript port of the netlist
builder and the result processing matches it, for every built-in example plus a set of edge cases.
Skipped when Node.js is not installed (the web build itself needs Node only at publish time).
"""
import json
import math
import os
import shutil
import subprocess
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GOLD = os.path.join(ROOT, "tests", "golden")
sys.path.insert(0, os.path.join(ROOT, "site"))
sys.path.insert(0, os.path.join(ROOT, "src"))
pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="Node.js not installed")

from spiceyelectrons import runner                       # noqa: E402
from spiceyelectrons.netlist import build, CircuitError  # noqa: E402
import build_site                                        # noqa: E402


@pytest.fixture(scope="module", autouse=True)
def data_js():
    build_site.write_data()


def node(script, *args):
    r = subprocess.run(["node", os.path.join(ROOT, "site", "tests", script), *args], capture_output=True, text=True, timeout=300)
    assert r.returncode == 0, r.stderr[-2000:]
    return json.loads(r.stdout)


def test_examples_netlists_identical():
    js = node("netlist_golden.mjs", GOLD)
    assert len(js) >= 41
    for slug, r in js.items():
        g = json.load(open(f"{GOLD}/{slug}.golden.json"))
        assert r["netlist"] == g["netlist"], f"example {slug}: netlist differs"
        assert r["error"] == g["error"]
        m = g["meta"]
        if m:
            assert r["notes"] == m["notes"] and r["nodes"] == m["nodes"] and r["fmax"] == m["fmax"], slug
            assert math.isclose(r["steps"], m["steps"], rel_tol=1e-9), slug
            assert r["currents"] == {k: list(v) for k, v in m["currents"].items()}, slug
            assert r["pinvecs"] == m["pinvecs"], slug


def test_edge_cases_same_messages():
    cases = json.load(open(f"{GOLD}/edge_cases.json"))
    js = node("netlist_cases.mjs", f"{GOLD}/edge_cases.json")
    for r, c in zip(js, cases):
        try:
            text, meta = build(c["circuit"])
            py = {"netlist": text, "notes": meta["notes"], "error": None, "part": None}
        except CircuitError as e:
            py = {"netlist": "", "notes": [], "error": str(e), "part": e.part}
        assert "crash" not in r, f"{c['name']}: {r.get('crash')}"
        for k in ("netlist", "notes", "error", "part"):
            assert r[k] == py[k], f"{c['name']}: {k} differs"


def _close(a, b, rel=3e-4, absol=1e-9):
    if a is None or b is None:
        return a is b
    return abs(a - b) <= absol + rel * max(abs(a), abs(b))


def test_results_processing_matches(tmp_path):
    idx = json.load(open(f"{GOLD}/index.json"))
    slugs = [s for s, n in idx.items() if not n.startswith("FM bug")]       # the 700k-step case is covered by the browser tests
    captured, py_res = {}, {}
    real_read = runner._read_raw
    for slug in slugs:
        circ = json.load(open(f"{GOLD}/{slug}.circuit.json"))["circuit"]
        box = {}
        runner._read_raw = lambda path, _b=box: _b.setdefault("d", real_read(path))
        try:
            res = runner.simulate(circ)
        finally:
            runner._read_raw = real_read
        assert res["ok"], (slug, res.get("error"))
        py_res[slug] = res
        captured[slug] = {k: list(v) for k, v in box["d"].items()}
    raw_file = tmp_path / "raw.json"
    raw_file.write_text(json.dumps(captured))
    js = node("results_golden.mjs", str(raw_file), GOLD)
    for slug in slugs:
        p, j = py_res[slug], js[slug]
        assert j["ok"] and j["raw_points"] == p["raw_points"], slug
        assert j["notes"] == p["notes"], slug
        assert j["warnings"] == p["warnings"], f"{slug}: warnings differ\n{j['warnings']}\n{p['warnings']}"
        for key in ("time",):
            assert len(j[key]) == len(p[key]) == 1000
            assert all(_close(a, b, 1e-8) for a, b in zip(j[key], p[key])), f"{slug}: {key}"
        for sect in ("voltages", "currents"):
            assert set(j[sect]) == set(p[sect]), f"{slug}: {sect} keys"
            for k in p[sect]:
                assert len(j[sect][k]) == len(p[sect][k]) == 1000, f"{slug}: {sect}[{k}] length"
                assert all(_close(a, b) for a, b in zip(j[sect][k], p[sect][k])), f"{slug}: {sect}[{k}]"
        assert set(j["pins"]) == set(p["pins"]), slug
        for k, arrs in p["pins"].items():
            for a, b in zip(arrs, j["pins"][k]):
                assert (a is None) == (b is None), f"{slug}: pins[{k}]"
                if a is not None:
                    assert len(a) == len(b), f"{slug}: pins[{k}] length"
                    assert all(_close(x, y) for x, y in zip(a, b)), f"{slug}: pins[{k}]"
        assert set(j["env"]) == set(p["env"]), f"{slug}: env keys"
        for k, (lo, hi) in p["env"].items():
            assert len(lo) == len(j["env"][k][0]) == len(hi) == len(j["env"][k][1]), f"{slug}: env[{k}] length"
            assert all(_close(x, y) for x, y in zip(lo, j["env"][k][0])) and all(_close(x, y) for x, y in zip(hi, j["env"][k][1])), f"{slug}: env[{k}]"
        assert set(j["freq"]) == set(p["freq"]), f"{slug}: freq keys {set(j['freq'])} vs {set(p['freq'])}"
        for k, f in p["freq"].items():
            assert _close(f["avg"], j["freq"][k]["avg"], 1e-5), f"{slug}: freq avg"
            assert len(f["trace"]) == len(j["freq"][k]["trace"]), f"{slug}: freq trace length"
            assert all(_close(x, y, 1e-4) for x, y in zip(f["trace"], j["freq"][k]["trace"])), f"{slug}: freq trace"
