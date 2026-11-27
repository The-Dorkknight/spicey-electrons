// Required Notice: Copyright Matthew Armstrong (https://github.com/The-Dorkknight)
// Licensed under the PolyForm Noncommercial License 1.0.0. No warranty.
//
// Python-compatible number formatting, so the web version writes the SAME netlist text as the
// Python reference (netlist.py). The golden tests compare them character for character.

/** Python's format(x, ".<p>g") */
export function g(x, p = 6) {
  if (Number.isNaN(x)) return "nan";
  if (!Number.isFinite(x)) return x > 0 ? "inf" : "-inf";
  if (x === 0) return Object.is(x, -0) ? "-0" : "0";
  let [m, e] = x.toExponential(p - 1).split("e");
  e = +e;
  if (e < -4 || e >= p) {
    if (m.includes(".")) m = m.replace(/0+$/, "").replace(/\.$/, "");
    return m + "e" + (e < 0 ? "-" : "+") + String(Math.abs(e)).padStart(2, "0");
  }
  let s = x.toFixed(Math.max(0, p - 1 - e));
  if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "");
  return s;
}

/** Python's format(x, ".<p>e") */
export function e(x, p) {
  const [m, ex] = x.toExponential(p).split("e");
  const n = +ex;
  return m + "e" + (n < 0 ? "-" : "+") + String(Math.abs(n)).padStart(2, "0");
}

/** Python's format(x, ".<p>f") */
export function f(x, p) {
  return x.toFixed(p);
}

/** Python's repr/str of a float that has no fractional part, e.g. 2.0 -> "2.0" (used for fixed constants) */
export function pyFloat(x) {
  return Number.isInteger(x) ? x.toFixed(1) : String(x);
}

/** Python's f"{n:,.0f}" */
export function thousands(n) {
  return Math.round(n).toLocaleString("en-US", { maximumFractionDigits: 0 });
}

/** float(f"{v:.<p>g}") - round to p significant digits (used to keep replies small) */
export function sig(v, p) {
  return Number(v.toPrecision(p));
}
