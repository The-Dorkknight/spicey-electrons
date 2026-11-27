// Required Notice: Copyright Matthew Armstrong (https://github.com/The-Dorkknight)
// Licensed under the PolyForm Noncommercial License 1.0.0. No warranty.
//
// Port of src/spiceyelectrons/units.py. Kid rule, not SPICE rule: capital M means MEGA, small m means milli.

import { g } from "./pyfmt.js";

const SUFFIX = { f: 1e-15, p: 1e-12, n: 1e-9, u: 1e-6, "µ": 1e-6, "μ": 1e-6, m: 1e-3, k: 1e3, K: 1e3, M: 1e6, meg: 1e6, Meg: 1e6, MEG: 1e6, G: 1e9, "": 1.0 };
const UNITS = ["ohms", "ohm", "Ω", "F", "H", "V", "A", "Hz", "hz", "s", "W", "%"].sort((a, b) => b.length - a.length);
const RE = /^\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)\s*(meg|Meg|MEG|[fpnuµμmkKMG]?)\s*$/;
const RE_INFIX = /^\s*(\d+)([pnuµμmkKMGR])(\d+)\s*$/;

export class BadValue extends Error {}

export function parseValue(text, what = "value") {
  if (typeof text === "number") return text;
  if (typeof text === "boolean") return text ? 1 : 0;
  let s = String(text).trim().replace(",", ".");
  let m = RE_INFIX.exec(s);
  if (m) {
    const [, whole, suf, frac] = m;
    const mult = suf === "R" ? 1.0 : SUFFIX[suf];
    return parseFloat(`${whole}.${frac}`) * mult;
  }
  for (const u of UNITS) {
    if (s.endsWith(u) && s.length > u.length) { s = s.slice(0, -u.length).trim(); break; }
  }
  m = RE.exec(s);
  if (!m) throw new BadValue(`I can't read '${text}' as a ${what}. Try something like 4.7k, 100n or 9.`);
  return parseFloat(m[1]) * SUFFIX[m[2]];
}

export function pretty(x, unit = "") {
  if (x === 0) return `0 ${unit}`.trim();
  const a = Math.abs(x);
  for (const [mult, suf] of [[1e9, "G"], [1e6, "M"], [1e3, "k"], [1, ""], [1e-3, "m"], [1e-6, "µ"], [1e-9, "n"], [1e-12, "p"]]) {
    if (a >= mult * 0.9995) return `${g(x / mult, 3)} ${suf}${unit}`.trim();
  }
  return `${g(x, 3)} ${unit}`.trim();
}
