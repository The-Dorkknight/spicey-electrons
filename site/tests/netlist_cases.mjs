import fs from "node:fs";
import { build, CircuitError } from "../shim/netlist.js";
const cases = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const out = cases.map(({ name, circuit }) => {
  try { const [netlist, meta] = build(circuit); return { name, netlist, notes: meta.notes, error: null, part: null }; }
  catch (e) { if (!(e instanceof CircuitError)) return { name, crash: String(e) }; return { name, netlist: "", notes: [], error: e.message, part: e.part }; }
});
process.stdout.write(JSON.stringify(out));
