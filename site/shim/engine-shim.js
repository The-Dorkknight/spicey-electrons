/* Required Notice: Copyright Matthew Armstrong (https://github.com/The-Dorkknight)
 * Licensed under the PolyForm Noncommercial License 1.0.0. No warranty.
 *
 * WEB VERSION ONLY. The original app talks to a small Python helper through four calls:
 *     GET /api/info   POST /api/simulate   GET /api/job/<id>   POST /api/cancel/<id>
 * This script answers those same four calls inside the browser (netlist built here, ngspice run as WebAssembly in a
 * Web Worker). app.js is NOT changed: it believes it is talking to the helper. Anything else passes straight through.
 */
(function () {
  "use strict";
  var SHIM = new URL("./", document.currentScript.src).href;          // .../shim/
  var REPO = "https://github.com/The-Dorkknight/spicey-electrons";
  var WARN_STEPS = 20000;      // measured: ~10 s of browser time at 30k steps (native: <1 s)
  var BLOCK_STEPS = 60000;     // measured: 46 s at 80k steps, and minutes (or a crash) beyond that
  var realFetch = window.fetch.bind(window);
  var cache = new Map(), jobs = new Map(), worker = null, seq = 0, warmed = false;

  function forced() { try { return localStorage.getItem("se_force_slow") === "1"; } catch (_) { return false; } }
  function json(obj, code) { return new Response(JSON.stringify(obj), { status: code || 200, headers: { "Content-Type": "application/json" } }); }
  function band(steps) {
    return steps <= 10000 ? "a few seconds" : steps <= 30000 ? "about 10 seconds" : steps <= 60000 ? "up to a minute" : "many minutes (and it may crash the page)";
  }
  function n(x) { return Math.round(x).toLocaleString("en-US"); }

  function killWorker() { if (worker) { try { worker.terminate(); } catch (_) {} worker = null; } }
  function ensureWorker() {
    if (worker) return worker;
    worker = new Worker(SHIM + "worker.js", { type: "module" });
    return worker;
  }
  function warmUp() {                    // start loading the engine while the kid is still building the circuit
    if (warmed) return; warmed = true;
    try { ensureWorker(); } catch (_) {}
  }
  setTimeout(warmUp, 2500);

  function finish(job, result) {
    if (job.state === "done") return;
    job.state = "done";
    result.engine = "browser";
    if (result.ok && result.seconds === undefined) result.seconds = Math.round((performance.now() - job.t0)) / 1000;
    job.result = result;
    // keep the list short
    jobs.forEach(function (j, k) { if (j.state === "done" && performance.now() - j.t0 > 600000) jobs.delete(k); });
  }

  function runInWorker(job, net, meta, limit) {
    return new Promise(function (resolve) {
      var w = ensureWorker(), timer = null;
      job.kill = function () { clearTimeout(timer); killWorker(); resolve({ ok: false, error: "Stopped.", netlist: net }); };
      timer = setTimeout(function () {
        killWorker();
        resolve({ ok: false, netlist: net, error: "The simulation took longer than " + limit + " s, so I stopped it. Try a shorter time on the 'Show' menu, or a slower signal." +
          " The full app (download link in the yellow bar) is much faster for this." });
      }, limit * 1000);
      w.onmessage = function (ev) {
        var m = ev.data;
        if (m.type === "phase") { job.heartbeat.phase = m.text; return; }
        clearTimeout(timer);
        if (m.type === "done") resolve(m.result);
        else { killWorker(); resolve({ ok: false, error: m.error, details: m.details, netlist: m.netlist }); }
      };
      w.onerror = function () {
        clearTimeout(timer); killWorker();
        resolve({ ok: false, netlist: net, error: "The browser's simulation engine stopped unexpectedly (it may have run out of memory). Try a shorter time on the 'Show' menu, or use the full app." });
      };
      w.postMessage({ net: net, meta: meta });
    });
  }

  async function startJob(circuit) {
    var id = "w" + (++seq).toString(36), job = { id: id, state: "running", t0: performance.now(), heartbeat: { elapsed: 0 } };
    jobs.set(id, job);
    // a newer run replaces any older one (the page asks the old one to stop first; this is the safety net)
    jobs.forEach(function (j) { if (j !== job && j.state === "running" && j.kill) j.kill(); });
    (async function () {
      try {
        var nl = await import(SHIM + "netlist.js"), built;
        try { built = nl.build(circuit); }
        catch (e) { if (e instanceof nl.CircuitError) return finish(job, { ok: false, error: e.message, part: e.part }); throw e; }
        var net = built[0], meta = built[1], steps = meta.steps;
        if (steps > BLOCK_STEPS && !forced())
          return finish(job, { ok: false, netlist: net, error:
            "This is a very fast (radio-frequency) circuit: it needs about " + n(steps) + " tiny steps. The web version runs the simulator inside your browser, " +
            "which is far slower than the full app, so this could take many minutes or even crash the page. For full speed, download the full app (link in the yellow bar). " +
            "You can also try a shorter 'Show' time, or tick 'let me try slow ones anyway' in the yellow bar." });
        if (steps > WARN_STEPS)
          meta.notes.push("This is a fast circuit (about " + n(steps) + " steps), so in the web version it may take " + band(steps) + ". The full app is much quicker.");
        var hit = cache.get(net);                       // same circuit again: instant
        if (hit) { var c2 = JSON.parse(hit); c2.seconds = 0; c2.cached = true; return finish(job, c2); }
        var out = await runInWorker(job, net, meta, forced() ? 300 : 120);
        if (out.ok) { cache.set(net, JSON.stringify(out)); if (cache.size > 6) cache.delete(cache.keys().next().value); }
        finish(job, out);
      } catch (err) {
        finish(job, { ok: false, error: "Internal error: " + err });
      }
    })();
    return id;
  }

  window.fetch = async function (input, init) {
    var url = typeof input === "string" ? input : (input && input.url) || "";
    var m = /\/api\/(info|simulate|job\/([^/?#]+)|cancel\/([^/?#]+))/.exec(url);
    if (!m) return realFetch(input, init);
    if (m[1] === "info") {
      var d = (await import(SHIM + "data.generated.js")).DATA, parts = {};
      Object.keys(d.catalogue).forEach(function (k) { parts[k] = { pins: d.catalogue[k][0], props: d.catalogue[k][1] }; });
      return json({ app: d.app, version: d.version, build: d.build + " · web version", ngspice: "in your browser (WebAssembly)", parts: parts });
    }
    if (m[1] === "simulate") {
      var circuit; try { circuit = JSON.parse((init && init.body) || "{}"); } catch (_) { return json({ error: "bad json" }, 400); }
      return json({ job: await startJob(circuit) });
    }
    if (m[3]) {
      var cj = jobs.get(m[3]);
      if (cj && cj.state === "running") { if (cj.kill) cj.kill(); finish(cj, { ok: false, error: "Stopped." }); }
      return json({ ok: true });
    }
    var job = jobs.get(m[2]);
    if (!job) return json({ error: "no such job" }, 404);
    if (job.state === "done") return json({ state: "done", result: job.result });
    job.heartbeat.elapsed = Math.round((performance.now() - job.t0) / 100) / 10;
    return json({ state: "running", heartbeat: job.heartbeat });
  };

  /* ---- the yellow bar: what this version is, and where to get the fast one ---- */
  function bar() {
    try { if (sessionStorage.getItem("se_bar_closed") === "1") return; } catch (_) {}
    var d = document.createElement("div");
    d.id = "webBanner"; d.setAttribute("role", "note");
    d.innerHTML = '<span class="wbText">🌐 <b>Web version</b> - it runs on your own computer, inside your browser, and nothing is sent anywhere. ' +
      'Very fast <b>radio-frequency (RF)</b> circuits, like the FM bug, are <b>probably very slow here</b>. ' +
      'For full speed, <a href="' + REPO + '/releases/latest" target="_blank" rel="noopener">download the full app</a> and run it from the repo.</span>' +
      '<label class="wbForce"><input type="checkbox" id="forceSlow"> let me try slow ones anyway</label>' +
      '<button id="wbClose" title="Hide this bar" aria-label="Hide this bar">×</button>';
    document.body.insertBefore(d, document.body.firstChild);
    var cb = d.querySelector("#forceSlow"); cb.checked = forced();
    cb.onchange = function () { try { localStorage.setItem("se_force_slow", cb.checked ? "1" : "0"); } catch (_) {} };
    d.querySelector("#wbClose").onclick = function () { d.remove(); try { sessionStorage.setItem("se_bar_closed", "1"); } catch (_) {} };
  }
  if (document.body) bar(); else document.addEventListener("DOMContentLoaded", bar);
})();
