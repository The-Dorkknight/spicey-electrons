# Required Notice: Copyright Matthew Armstrong (https://github.com/The-Dorkknight)
# Licensed under the PolyForm Noncommercial License 1.0.0. No warranty.
"""Real-browser tests of the WEB VERSION (site/dist). Skipped when Playwright, Chromium or the engine is missing."""
import functools, http.server, json, os, subprocess, sys, threading
import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "site"))
pw = pytest.importorskip("playwright.sync_api")

JS_RUN = """async (c) => {
  const r = await fetch('/api/simulate', {method:'POST', body: JSON.stringify(c)});
  const id = (await r.json()).job;
  for (let i = 0; i < 1500; i++) {
    const j = await (await fetch('/api/job/' + id)).json();
    if (j.state === 'done') return j.result;
    await new Promise(r => setTimeout(r, 120));
  }
  return {timeout: true};
}"""


@pytest.fixture(scope="module")
def page():
    import build_site
    try:
        dist = build_site.build()
    except SystemExit as e:
        pytest.skip(str(e))
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=dist)
    handler.log_message = lambda *a, **k: None
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    with pw.sync_playwright() as p:
        try:
            b = p.chromium.launch()
        except Exception as e:
            pytest.skip("no chromium: %s" % e)
        pg = b.new_page()
        pg.goto("http://127.0.0.1:%d/" % srv.server_address[1])
        yield pg
        b.close()
    srv.shutdown()


def circuit(i):
    return json.load(open(os.path.join(ROOT, "tests", "golden", "%02d.circuit.json" % i)))["circuit"]


def test_banner_and_info(page):
    assert "probably very slow" in page.inner_text("#webBanner")
    assert "github.com/The-Dorkknight/spicey-electrons" in page.inner_html("#webBanner")
    info = page.evaluate("fetch('/api/info').then(r=>r.json())")
    assert info["ngspice"] and info["parts"]


def test_simple_examples_run(page):
    for i in (0, 1, 2):
        res = page.evaluate(JS_RUN, circuit(i))
        assert res.get("ok"), (i, res.get("error"))


def test_bad_circuit_stops_early(page):
    c = {"parts": [{"id": "B1", "type": "battery", "nodes": {"+": "a", "-": "0"}, "props": {"V": 5}},
                   {"id": "B2", "type": "battery", "nodes": {"+": "a", "-": "0"}, "props": {"V": 9}}],
         "temp": 27, "duration": None, "start": 0}
    res = page.evaluate(JS_RUN, c)
    assert res.get("ok") is False and res.get("error")
    res = page.evaluate(JS_RUN, circuit(0))      # a fresh worker works afterwards
    assert res.get("ok")


def test_stop(page):
    res = page.evaluate("""async (c) => {
      const id = (await (await fetch('/api/simulate',{method:'POST',body:JSON.stringify(c)})).json()).job;
      await fetch('/api/cancel/' + id, {method:'POST'});
      for (let i=0;i<50;i++){ const j = await (await fetch('/api/job/'+id)).json(); if (j.state==='done') return j.result; await new Promise(r=>setTimeout(r,100)); }
      return {timeout:true}; }""", circuit(3))
    assert res.get("ok") is False


def _tree_hash(root):
    import hashlib
    h = hashlib.sha1()
    for d, _, files in sorted(os.walk(root)):
        if "__pycache__" in d:
            continue
        for f in sorted(files):
            h.update(open(os.path.join(d, f), "rb").read())
    return h.hexdigest()


def test_original_untouched_and_unaware(tmp_path):
    import build_site
    src = os.path.join(ROOT, "src")
    before = _tree_hash(src)
    build_site.build(dist=str(tmp_path / "d"))
    assert _tree_hash(src) == before                      # a web build never writes into src/
    for f in ("app.js", "index.html", "style.css"):
        assert "site/" not in open(os.path.join(src, "spiceyelectrons", "web", f), encoding="utf-8").read()


def test_fm_bug_is_blocked_with_advice(page):
    res = page.evaluate("() => localStorage.removeItem('se_force_slow')")
    res = page.evaluate(JS_RUN, circuit(9))
    assert res.get("ok") is False
    assert "download the full app" in res["error"]


def test_repeat_run_is_instant(page):
    page.evaluate(JS_RUN, circuit(1))
    res = page.evaluate(JS_RUN, circuit(1))
    assert res.get("ok") and res.get("cached")
