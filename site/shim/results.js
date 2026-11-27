// Required Notice: Copyright Matthew Armstrong (https://github.com/The-Dorkknight)
// Licensed under the PolyForm Noncommercial License 1.0.0. No warranty.
//
// Port of the result-processing half of src/spiceyelectrons/runner.py (everything after ngspice has produced
// its numbers). The Python file is the reference: tests/test_site_golden.py feeds both the same raw numbers.
import { DATA } from "./data.generated.js";
import { POINTS } from "./netlist.js";
import { parseValue, pretty } from "./units.js";
import { f as ff, sig } from "./pyfmt.js";

const LIMITS = DATA.limits;

function bisectLeft(a, x, lo = 0, hi = a.length) {
  while (lo < hi) { const mid = (lo + hi) >> 1; if (a[mid] < x) lo = mid + 1; else hi = mid; }
  return lo;
}
const minOf = (a) => { let m = Infinity; for (let i = 0; i < a.length; i++) if (a[i] < m) m = a[i]; return m; };
const maxOf = (a) => { let m = -Infinity; for (let i = 0; i < a.length; i++) if (a[i] > m) m = a[i]; return m; };
const sumOf = (a) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s; };
const maxAbs = (a) => { let m = 0; for (let i = 0; i < a.length; i++) { const v = Math.abs(a[i]); if (v > m) m = v; } return m; };

function grid(t, n) {
  const t0 = t[0], t1 = t[t.length - 1];
  const gr = [], idx = [];
  for (let i = 0; i < n; i++) { const x = t0 + (t1 - t0) * i / (n - 1); gr.push(x); idx.push(bisectLeft(t, x)); }
  return [gr, idx];
}

function sample(t, y, gr, idx) {
  const out = [], m = t.length;
  for (let k = 0; k < gr.length; k++) {
    const i = idx[k], x = gr[k];
    let v;
    if (i <= 0) v = y[0];
    else if (i >= m) v = y[m - 1];
    else {
      const ta = t[i - 1], tb = t[i];
      v = tb === ta ? y[i - 1] : y[i - 1] + (y[i] - y[i - 1]) * (x - ta) / (tb - ta);
    }
    out.push(Number.isFinite(v) ? v : 0.0);
  }
  return out;
}

function envelope(t, y, gr, centre) {
  const n = gr.length;
  const h = n > 1 ? (gr[n - 1] - gr[0]) / (n - 1) : 0.0;
  const edges = gr.map((x) => bisectLeft(t, x - h / 2)); edges.push(t.length);
  const lo = [], hi = [];
  for (let j = 0; j < n; j++) {
    const a = edges[j], b = edges[j + 1];
    let l, u;
    if (b - a >= 1) {
      l = Infinity; u = -Infinity;
      for (let i = a; i < b; i++) { const v = y[i]; if (v < l) l = v; if (v > u) u = v; }
      if (!(Number.isFinite(l) && Number.isFinite(u))) l = u = centre[j];
    } else l = u = centre[j];
    lo.push(l); hi.push(u);
  }
  return [lo, hi];
}

function crossings(t, y, minPp) {
  const step = Math.max(1, Math.floor(y.length / 300000));
  const ys = [], ts = [];
  for (let i = 0; i < y.length; i += step) { ys.push(y[i]); ts.push(t[i]); }
  if (ys.length < 8) return null;
  const lo = minOf(ys), hi = maxOf(ys);
  if (!(Number.isFinite(lo) && Number.isFinite(hi)) || hi - lo < minPp) return null;
  const mid = sumOf(ys) / ys.length;
  const dn = mid - 0.08 * (hi - lo);
  const cr = [];
  let armed = false, py = ys[0], pt = ts[0];
  for (let i = 0; i < ys.length; i++) {
    const tt = ts[i], yy = ys[i];
    if (yy < dn) armed = true;
    if (armed && py < mid && mid <= yy) { cr.push(pt + (mid - py) / (yy - py) * (tt - pt)); armed = false; }
    py = yy; pt = tt;
  }
  return cr;
}

function frequency(cr, gr) {
  if (cr === null || cr.length < 8) return null;
  const per = [];
  for (let i = 0; i < cr.length - 1; i++) per.push(cr[i + 1] - cr[i]);
  const med = [...per].sort((a, b) => a - b)[Math.floor(per.length / 2)];
  const ok = per.map((p) => 0.7 * med <= p && p <= 1.4 * med);
  const mids = per.map((_, i) => (cr[i] + cr[i + 1]) / 2);
  const avgP = per.filter((_, i) => ok[i]);
  if (avgP.length < 7) return null;
  const trace = [];
  for (const x of gr) {
    if (x < cr[0] || x > cr[cr.length - 1]) { trace.push(null); continue; }
    let j = bisectLeft(mids, x);
    j = Math.min(Math.max(j, 0), per.length - 1);
    if (j > 0 && Math.abs(mids[j - 1] - x) < Math.abs(mids[j] - x)) j -= 1;
    const pick = [];
    for (let k = Math.max(0, j - 1); k < Math.min(per.length, j + 2); k++) if (ok[k]) pick.push(per[k]);
    trace.push(pick.length ? 1.0 / (sumOf(pick) / pick.length) : null);
  }
  return [avgP.length / sumOf(avgP), trace];
}

export function friendlyError(text) {
  const low = String(text).toLowerCase();
  if (low.includes("singular matrix"))
    return "The simulator couldn't find an answer - usually two batteries or signal generators are wired straight across each other, or a part is only connected by one leg.";
  if (low.includes("timestep too small"))
    return "The simulation got stuck because something changes impossibly fast. Try putting a resistor in series with the capacitor, coil or battery.";
  if (low.includes("gmin stepping failed") || low.includes("source stepping failed"))
    return "The simulator couldn't work out how the circuit starts up. Check that every part has both legs connected, and that nothing is shorted.";
  if (low.includes("unknown model") || low.includes("could not find")) return "One of the parts uses a model I don't have.";
  return "The simulator wasn't happy with this circuit. The details below may help.";
}

export function safetyWarnings(parts, res) {
  const out = [];
  const cur = res.currents;
  for (const p of parts) {
    const t = p.type, pid = p.id, pr = p.props;
    const i = cur[pid];
    if (i === undefined || (i.length ? maxAbs(i) : 0.0) < 1e-9) continue;
    let half = i.slice(Math.floor(i.length / 2));
    if (!half.length) half = i;
    let steady = 0, rms2 = 0;
    for (const x of half) { steady += Math.abs(x); rms2 += x * x; }
    steady /= half.length; rms2 /= half.length;
    const surge = maxAbs(i);
    const peak = Math.max(steady, surge / 10.0);
    try {
      if (t === "led" && peak > LIMITS.led_max_a) {
        out.push({ part: pid, level: "burn", text: `${pid} would burn out! ${pretty(peak, "A")} is flowing, but an LED only likes about 20 mA. Add a resistor in series (around 330 Ω to 1 kΩ for a 9 V battery).` });
      } else if (t === "resistor") {
        const r = parseValue(pr.value);
        const w = Math.max(rms2, (surge / 10.0) ** 2) * r;
        if (w > LIMITS.resistor_smoke_w)
          out.push({ part: pid, level: "burn", text: `${pid} would smoke! It's turning ${pretty(w, "W")} into heat, and a normal resistor handles 0.25 W.` });
        else if (w > LIMITS.resistor_w)
          out.push({ part: pid, level: "hot", text: `${pid} is getting hot: ${pretty(w, "W")}. A normal resistor is happy up to 0.25 W - use a bigger (0.5 W or 1 W) one or a larger value.` });
      } else if ((t === "battery" || t === "sine" || t === "square") && peak > LIMITS.battery_short_a) {
        out.push({ part: pid, level: "burn", text: `${pid} is nearly short-circuited: ${pretty(peak, "A")} is flowing. A real ${t === "battery" ? "battery" : "power source"} would get hot or give up. Is there a resistor in the way?` });
      } else if (t === "npn" || t === "pnp") {
        const lim = LIMITS.bjt_max_a[pr.model] ?? 0.2;
        if (peak > lim) out.push({ part: pid, level: "burn", text: `${pid} is overloaded: ${pretty(peak, "A")} through the collector, but it's only good for about ${pretty(lim, "A")}.` });
      } else if (t === "nmos") {
        const lim = LIMITS.mos_max_a[pr.model] ?? 0.2;
        if (peak > lim) out.push({ part: pid, level: "hot", text: `${pid} is working hard: ${pretty(peak, "A")} through the drain (2N7000 is rated ${pretty(lim, "A")} continuous).` });
      } else if (t === "zener") {
        const w = parseValue(pr.vz) * steady;
        if (w > LIMITS.zener_w) out.push({ part: pid, level: "burn", text: `${pid} would burn out! It's turning about ${pretty(w, "W")} into heat; a small Zener handles 0.5 W. Add a bigger series resistor.` });
      } else if (t === "lamp") {
        if (steady > 1.2 * parseValue(pr.amps)) out.push({ part: pid, level: "burn", text: `${pid} would pop! It's getting far more than its ${pr.volts} V - the filament would melt.` });
      } else if (t === "motor" && peak > LIMITS.motor_stall_a) {
        out.push({ part: pid, level: "hot", text: `${pid} is drawing ${pretty(peak, "A")}. That's what a stuck (stalled) motor does - it gets hot fast.` });
      } else if (t === "diode") {
        const lim = LIMITS.diode_max_a[pr.model] ?? 0.3;
        if (peak > lim) out.push({ part: pid, level: "burn", text: `${pid} is overloaded: ${pretty(peak, "A")} (it's rated about ${pretty(lim, "A")}).` });
      } else if (t === "555" && peak > LIMITS.ic555_out_a) {
        out.push({ part: pid, level: "burn", text: `${pid}'s output is overloaded: ${pretty(peak, "A")}, but a 555 can only give about 200 mA. Put a resistor (or a transistor) between the output and what it drives.` });
      } else if (["and", "or", "nand", "nor", "xor", "not"].includes(t) && peak > LIMITS.gate_out_a) {
        out.push({ part: pid, level: "burn", text: `${pid}'s output is overloaded: ${pretty(peak, "A")}, but a logic gate only gives about 25 mA. Add a resistor (about 330 Ω for an LED).` });
      }
    } catch (_) { /* a part we can't judge is simply skipped, as in the Python version */ }
  }
  const swing = (node) => {
    if (node === "0") return [0.0, 0.0];
    const e = res.env["v:" + node];
    if (e && e[0].length) return [minOf(e[0]), maxOf(e[1])];
    const v = res.voltages[node];
    return v && v.length ? [minOf(v), maxOf(v)] : [0.0, 0.0];
  };
  for (const p of parts) {
    if (!["npn", "pnp", "nmos"].includes(p.type) || p.nodes.length < 3) continue;
    const lim = p.type === "nmos" ? 60.0 : 40.0;
    const [loC, hiC] = swing(p.nodes[1]), [loE, hiE] = swing(p.nodes[2]);
    const worst = Math.max(Math.abs(hiC - loE), Math.abs(loC - hiE));
    if (worst > lim * 1.1)
      out.push({ part: p.id, level: "burn", text: `${p.id} would be destroyed! It sees ${pretty(worst, "V")} across it but it's only good for about ${ff(lim, 0)} V. (A coil switched off with nothing to catch its kick does this - add a diode across the coil.)` });
  }
  for (const p of parts) {
    if (p.type !== "555") continue;
    const vc = p.nodes[0], gn = p.nodes[1];
    const va = res.voltages[vc], vb = res.voltages[gn];
    if ((va === undefined && vc !== "0") || (vb === undefined && gn !== "0")) continue;
    const len = (va && va.length ? va : vb || []).length;
    const d = [];
    for (let k = 0; k < len; k++) d.push((va ? va[k] : 0.0) - (vb ? vb[k] : 0.0));
    if (d.length && minOf(d) < -0.5)
      out.push({ part: p.id, level: "burn", text: `${p.id} is wired the wrong way round: pin 8 (+V) is below pin 1 (ground). A real 555 would be ruined.` });
    else if (d.length && maxOf(d) > LIMITS.ic555_max_v)
      out.push({ part: p.id, level: "burn", text: `${p.id} has ${pretty(maxOf(d), "V")} across it, but a 555 is only good up to 16 V.` });
  }
  return out;
}

/**
 * Turn raw simulator vectors into the reply the page expects.
 * `data` is { "time": [...], "v(n1)": [...], "i(vam_r1)": [...] } with lower-case names.
 * Returns the same object shape as the Python helper (minus `seconds`, which the caller sets).
 */
export function processResults(data, meta, netlist, log = "") {
  const t = data.time || [];
  if (t.length < 2) return { ok: false, error: friendlyError(log), details: String(log).slice(-3000), netlist };
  const [gr, idx] = grid(t, POINTS);
  const zeros = new Array(POINTS).fill(0.0);
  const res = { ok: true, netlist, duration: meta.duration, start: meta.start, temp: meta.temp, notes: [...meta.notes],
                voltages: { "0": zeros }, currents: {}, env: {}, freq: {}, raw_points: t.length };
  const raw = new Map();
  for (const node of meta.nodes) {
    const y = data[`v(${node.toLowerCase()})`];
    if (y !== undefined) { res.voltages[node] = sample(t, y, gr, idx); raw.set("v:" + node, y); }
  }
  for (const [pid, [vec, sign]] of meta.currents) {
    const y = data[vec];
    if (y !== undefined) { res.currents[pid] = sample(t, y, gr, idx).map((v) => sign * v); raw.set("i:" + pid, y); }
  }
  res.pins = {};
  for (const [pid, d] of meta.pinvecs) {
    const part = meta.parts.find((p) => p.id === pid);
    const npin = part ? part.nodes.length : 0;
    let arrs = new Array(npin).fill(null);
    for (const [k, vec] of d) {
      const y = data[vec];
      if (y !== undefined && k < npin) arrs[k] = sample(t, y, gr, idx);
    }
    if (npin === 2 && (arrs[0] === null) !== (arrs[1] === null)) {
      const known = arrs[0] !== null ? arrs[0] : arrs[1];
      arrs = arrs[0] !== null ? [known, known.map((v) => -v)] : [known.map((v) => -v), known];
    }
    res.pins[pid] = arrs;
  }
  res.time = gr;
  for (const y of raw.values()) {
    if (!Number.isFinite(sumOf(y))) {
      res.notes.push("Part of this run produced impossible numbers (NaN or infinity), so I drew those bits as 0. Something in the circuit is probably being pushed far past what it can do.");
      break;
    }
  }
  if (t.length >= 1.5 * POINTS) {
    for (const [key, y] of raw) {
      const ci = key.indexOf(":"), kind = key.slice(0, ci), name = key.slice(ci + 1);
      const sgn = kind === "i" && meta.currents.get(name)[1] < 0 ? -1.0 : 1.0;
      const centre = kind === "v" ? res.voltages[name] : res.currents[name];
      let [lo, hi] = envelope(t, y, gr, centre.map((c) => sgn * c));
      if (sgn < 0) { const l2 = hi.map((x) => -x), h2 = lo.map((x) => -x); lo = l2; hi = h2; }
      if (lo.some((l, k) => hi[k] - l > 0)) res.env[key] = [lo, hi];
    }
  }
  for (const node of meta.nodes) {
    const y = raw.get("v:" + node);
    if (y === undefined) continue;
    const fr = frequency(crossings(t, y, 2e-6), gr);
    if (fr) res.freq[node] = { avg: fr[0], trace: fr[1] };
  }
  res.warnings = safetyWarnings(meta.parts, res);
  // round to keep the reply small
  for (const pid of Object.keys(res.pins)) res.pins[pid] = res.pins[pid].map((a) => (a === null ? null : a.map((v) => sig(v, 4))));
  for (const d of [res.voltages, res.currents]) for (const k of Object.keys(d)) d[k] = d[k].map((v) => sig(v, 5));
  res.time = res.time.map((v) => sig(v, 10));
  for (const key of Object.keys(res.env)) res.env[key] = [res.env[key][0].map((v) => sig(v, 5)), res.env[key][1].map((v) => sig(v, 5))];
  for (const node of Object.keys(res.freq)) {
    res.freq[node].avg = sig(res.freq[node].avg, 6);
    res.freq[node].trace = res.freq[node].trace.map((v) => (v === null ? null : sig(v, 5)));
  }
  return res;
}
