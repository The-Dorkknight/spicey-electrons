// Required Notice: Copyright Matthew Armstrong (https://github.com/The-Dorkknight)
// Licensed under the PolyForm Noncommercial License 1.0.0. No warranty.
//
// The simulator runs HERE, in a Web Worker, so the page never freezes and Stop can end it by killing the worker.
// Engine: eecircuit-engine (ngspice compiled to WebAssembly), MIT licence - see shim/engine/LICENSE-eecircuit-engine.txt
import { Simulation } from "./engine/eecircuit-engine.mjs";
import { processResults, friendlyError } from "./results.js";

let sim = null, ready = null;
async function getSim() {
  if (!sim) { sim = new Simulation(); ready = sim.start(); }
  await ready;
  return sim;
}

/** The Python side hands ngspice a .control block that writes a file. In the browser the engine runs the
 *  .tran card itself and hands the numbers back, so: drop the control block, add the .tran card.
 *  Inline "# comments" make this engine hang, so they go too. */
export function toRunnable(net) {
  let body = net.replace(/\.control[\s\S]*?\.endc\n?/, "").replace(/[ \t]+#.*$/gm, "");
  const m = /^tran\s+(.+)$/m.exec(net);
  if (m) body = body.replace(/\.end\n?$/, `.tran ${m[1]}\n.end\n`);
  return body;
}

const FAIL = /run simulation\(s\) aborted|timestep too small|no writable vector|circuit not parsed/i;

/** Run the netlist. This engine can HANG (its promise never ends) when a circuit has no solution, e.g. two batteries
 *  wired across each other. Its log still fills in, so we watch the log and give up as soon as it says the run aborted. */
function runWatching(s, startLen) {
  return new Promise((resolve) => {
    let iv = null;
    const finish = (v) => { clearInterval(iv); resolve(v); };
    iv = setInterval(() => {
      const fresh = s.getError().slice(startLen).join("\n");
      if (FAIL.test(fresh)) setTimeout(() => finish({ failed: true, log: s.getError().slice(startLen).join("\n") }), 400);
    }, 250);
    s.runSim().then((r) => finish({ r }), (err) => finish({ failed: true, log: String(err) }));
  });
}

self.onmessage = async (ev) => {
  const { net, meta } = ev.data;
  try {
    postMessage({ type: "phase", text: sim ? "Simulating…" : "Starting the simulation engine (first time only)…" });
    const s = await getSim();
    postMessage({ type: "phase", text: "Simulating…" });
    const startLen = s.getError().length;
    s.setNetList(toRunnable(net));
    const out = await runWatching(s, startLen);
    const log = s.getError().slice(startLen).join("\n");
    if (out.failed) {
      postMessage({ type: "fail", error: friendlyError(out.log || log), details: (out.log || log).slice(-3000), netlist: net });
      self.close();                                  // the engine may be stuck: use a fresh one next time
      return;
    }
    const data = {};
    for (const d of out.r.data || []) data[d.name.toLowerCase()] = d.values;
    const res = processResults(data, meta, net, log);
    if (!res.ok) { postMessage({ type: "fail", error: res.error, details: res.details, netlist: net }); self.close(); return; }
    postMessage({ type: "done", result: res });
  } catch (err) {
    postMessage({ type: "fail", error: "The simulator stopped unexpectedly: " + err, details: String(err && err.stack || err), netlist: net });
    self.close();
  }
};
