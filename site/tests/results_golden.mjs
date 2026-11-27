// Feed captured raw simulator numbers (from the Python run) through the JS netlist builder + result processor.
import fs from "node:fs";
import { build } from "../shim/netlist.js";
import { processResults } from "../shim/results.js";
const [rawFile, dir] = process.argv.slice(2);
const raws = JSON.parse(fs.readFileSync(rawFile, "utf8"));
const out = {};
for (const slug of Object.keys(raws)) {
  const { circuit } = JSON.parse(fs.readFileSync(`${dir}/${slug}.circuit.json`, "utf8"));
  const [netlist, meta] = build(circuit);
  const res = processResults(raws[slug], meta, netlist);
  out[slug] = res;
}
process.stdout.write(JSON.stringify(out));
