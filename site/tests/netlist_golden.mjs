// Runs the JS netlist builder over every golden circuit and prints one JSON object (slug -> result).
import fs from "node:fs";
import { build, CircuitError } from "../shim/netlist.js";
const dir = process.argv[2];
const out = {};
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".circuit.json")).sort()) {
  const slug = f.slice(0, 2);
  const { circuit } = JSON.parse(fs.readFileSync(`${dir}/${f}`, "utf8"));
  try {
    const [netlist, meta] = build(circuit);
    out[slug] = { netlist, error: null, notes: meta.notes, nodes: meta.nodes, steps: meta.steps, fmax: meta.fmax, duration: meta.duration,
                  start: meta.start, temp: meta.temp,
                  currents: Object.fromEntries(meta.currents), pinvecs: Object.fromEntries([...meta.pinvecs].map(([k, m]) => [k, Object.fromEntries(m)])) };
  } catch (e) {
    if (!(e instanceof CircuitError)) throw e;
    out[slug] = { netlist: "", error: e.message };
  }
}
process.stdout.write(JSON.stringify(out));
