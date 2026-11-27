// Required Notice: Copyright Matthew Armstrong (https://github.com/The-Dorkknight)
// Licensed under the PolyForm Noncommercial License 1.0.0. No warranty.
//
// Port of src/spiceyelectrons/netlist.py for the web version. The Python file is the REFERENCE:
// tests/test_site_golden.py makes sure this file writes exactly the same netlist and notes for
// every built-in example. If you change netlist.py, change this too (the test will tell you).
import { DATA } from "./data.generated.js";
import { parseValue, pretty, BadValue } from "./units.js";
import { g, e as fe, f as ff, thousands } from "./pyfmt.js";

const CATALOGUE = DATA.catalogue;
const SOURCES = ["battery", "sine", "square"];
const GATES = ["and", "or", "nand", "nor", "xor"];
export const POINTS = 1000;        // samples handed back to the page
export const MAX_STEPS = 800000;   // most time steps we will ask ngspice for
export const STEPS_PER_CYCLE = 40; // time steps per cycle of the fastest oscillation we can predict

export class CircuitError extends Error {
  constructor(msg, part = null) { super(msg); this.part = part; }
}

const safe = (name) => String(name).replace(/[^A-Za-z0-9_]/g, "_") || "x";
const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);

function num(props, key, partId, what, positive = false) {
  let v;
  try { v = parseValue(key in props ? props[key] : "", what); }
  catch (err) { if (err instanceof BadValue) throw new CircuitError(`${partId}: ${err.message}`, partId); throw err; }
  if (positive && v <= 0) throw new CircuitError(`${partId}: the ${what} has to be bigger than zero.`, partId);
  return v;
}

export function check(circuit) {
  if (!isObj(circuit) || (circuit.parts !== undefined && !Array.isArray(circuit.parts)))
    throw new CircuitError("I couldn't make sense of that circuit. Try pressing 🗑 New and building it again.");
  const parts = [];
  for (const p of circuit.parts || []) {
    const idOk = typeof p?.id === "string" || Number.isInteger(p?.id);
    if (!isObj(p) || !Array.isArray(p.nodes) || typeof p.type !== "string" || !idOk ||
        !p.nodes.every((x) => typeof x === "string" || Number.isInteger(x)))
      throw new CircuitError("One of the parts in this circuit is damaged (its details are missing). Delete it and add it again.");
    const q = { ...p };
    q.id = String(p.id); q.nodes = p.nodes.map(String);
    q.props = isObj(p.props) ? p.props : {};
    parts.push(q);
  }
  const notes = [];
  const real = parts.filter((p) => p.type !== "ground");
  if (!real.length) throw new CircuitError("Drag some parts onto the board first - a battery and a resistor are a good start!");
  const seen = new Set();
  for (const p of parts) {
    if (seen.has(p.id)) throw new CircuitError(`Two parts are both called ${p.id}. Delete one and add it again so each has its own name.`, p.id);
    seen.add(p.id);
    if (!(p.type in CATALOGUE)) throw new CircuitError(`I don't know what a '${p.type}' is.`, p.id);
    const pins = CATALOGUE[p.type][0];
    if (p.nodes.length !== pins.length) throw new CircuitError(`${p.id} is missing some legs.`, p.id);
    p.props = { ...CATALOGUE[p.type][1], ...(p.props || {}) };
  }
  if (!parts.some((p) => SOURCES.includes(p.type) || GATES.includes(p.type) || p.type === "not"))
    throw new CircuitError("Nothing is powering the circuit. Add a battery or a signal generator.");

  const nodesUsed = new Set(parts.flatMap((p) => p.nodes));
  const src = parts.find((p) => SOURCES.includes(p.type));
  if (!nodesUsed.has("0") && src) {
    const old = src.nodes[1];
    for (const p of parts) p.nodes = p.nodes.map((n) => (n === old ? "0" : n));
    notes.push(`There's no ground (⏚) in your circuit, so I used the minus (-) side of ${src.id} as 0 V. All voltages are measured from there.`);
  }
  const count = new Map();
  for (const p of parts) {
    if (p.type === "ground") continue;
    for (const n of p.nodes) count.set(n, (count.get(n) || 0) + 1);
  }
  for (const p of real) {
    const pins = CATALOGUE[p.type][0];
    if (new Set(p.nodes).size === 1) {
      if (SOURCES.includes(p.type))
        throw new CircuitError(`${p.id} is shorted out - a wire joins its + and - together. In real life that gets very hot, very fast!`, p.id);
      notes.push(`${p.id} has all its legs on the same wire, so it's shorted out and nothing flows through it.`);
      continue;
    }
    p.nodes.forEach((n, i) => {
      if (n !== "0" && (count.get(n) || 0) < 2) notes.push(`${p.id}'s ${pins[i]} isn't connected to anything.`);
    });
  }
  return { notes, parts };
}

const tryParse = (v, f) => { try { f(parseValue(v)); } catch (err) { if (!(err instanceof BadValue)) throw err; } };

export function autoDuration(parts) {
  const freqs = [], rs = [], cs = [], ls = [];
  for (const p of parts) {
    const t = p.type, pr = p.props;
    if (t === "sine" || t === "square") tryParse(pr.frequency, (v) => freqs.push(v));
    else if (t === "resistor" || t === "pot") tryParse(pr.value, (v) => rs.push(v));
    else if (t === "capacitor") tryParse(pr.value, (v) => cs.push(v));
    else if (t === "inductor") tryParse(pr.value, (v) => ls.push(v));
    else if (t === "transformer") tryParse(pr.inductance, (v) => ls.push(v));
  }
  const fs = freqs.filter((f) => f > 0);
  if (fs.length) return Math.min(10.0, 5.0 / Math.min(...fs));
  let tau = 0.0;
  if (cs.length) tau = Math.max(tau, Math.max(...cs) * (rs.length ? Math.max(...rs) : 1000.0));
  if (ls.length) tau = Math.max(tau, Math.max(...ls) / (rs.length ? Math.min(...rs) : 1.0));
  if (tau <= 0) return parts.some((p) => GATES.includes(p.type) || p.type === "not") ? 1e-6 : 0.01;
  return Math.min(10.0, Math.max(1e-6, 5.0 * tau));
}

export function fastestFrequency(parts) {
  let fs = [], ls = [], cs = [];
  for (const p of parts) {
    const t = p.type, pr = p.props;
    if (t === "sine" || t === "square") tryParse(pr.frequency, (v) => fs.push(v));
    else if (t === "inductor") tryParse(pr.value, (v) => ls.push(v));
    else if (t === "transformer") tryParse(pr.inductance, (v) => ls.push(v));
    else if (t === "capacitor") tryParse(pr.value, (v) => cs.push(v));
  }
  ls = ls.filter((x) => x > 0); cs = cs.filter((x) => x > 0);
  if (ls.length && cs.length) fs.push(1.0 / (2 * Math.PI * Math.sqrt(Math.min(...ls) * Math.min(...cs))));
  fs = fs.filter((f) => f > 0 && Number.isFinite(f));
  return fs.length ? Math.max(...fs) : 0.0;
}

function ledModel(color) {
  const vf = DATA.ledVf[color] ?? 1.8;
  const n = 2.0, vt = 0.02585, i0 = 0.020, rs = 2.0;
  const is_ = i0 / Math.exp((vf - i0 * rs) / (n * vt));
  const eg = vf + 0.5;
  return `D(IS=${fe(is_, 4)} N=${ff(n, 1)} RS=${ff(rs, 1)} EG=${ff(eg, 3)} XTI=3 BV=5 IBV=10u CJO=20p TT=10n)`;
}

const LEG = { npn: 1, nmos: 1, pnp: 1, opamp: 2, "555": 3, not: 1, and: 2, or: 2, nand: 2, nor: 2, xor: 2 };

/** Returns [netlistText, meta]. meta.currents is a Map(pid -> [vector, sign]); meta.pinvecs a Map(pid -> Map(pin -> vector)). */
export function build(circuit) {
  const { notes, parts } = check(circuit);
  const numc = (key, dflt) => {
    const v = circuit[key];
    if (v === undefined || v === null || v === "") return dflt;
    const x = typeof v === "number" ? v : (typeof v === "string" && v.trim() !== "" ? Number(v) : NaN);
    if (Number.isNaN(x) && !(typeof v === "number"))
      throw new CircuitError(`The '${key}' setting isn't a number. Pick one from the menus at the top.`);
    if (!Number.isFinite(x)) throw new CircuitError(`The '${key}' setting isn't a sensible number. Pick one from the menus at the top.`);
    return x;
  };
  const temp = numc("temp", 20.0);
  if (!(temp >= -55 && temp <= 150))
    throw new CircuitError("That temperature is outside what the part models can do (-55 to 150 °C). Pick 0, 20 or 40 °C.");
  const dur = numc("duration", 0.0) || autoDuration(parts);
  const start = Math.max(0.0, numc("start", 0.0));
  if (!(Number.isFinite(dur) && dur > 0) || start + dur > 1e4)
    throw new CircuitError("That time setting doesn't make sense. Pick one from the 'Show' and 'From' menus.");
  const ramp = Math.min(1e-6, dur / 1000.0);
  const fmax = fastestFrequency(parts);
  const tstop = start + dur;
  let tmax = dur / POINTS;
  if (fmax) tmax = Math.min(tmax, 1.0 / (STEPS_PER_CYCLE * fmax));
  let steps = tstop / tmax;
  if (steps > MAX_STEPS) {
    tmax = tstop / MAX_STEPS;
    const why = fmax && 1.0 / (STEPS_PER_CYCLE * fmax) < dur / POINTS
      ? `This circuit has very fast parts (up to about ${pretty(fmax, "Hz")})`
      : "You asked to zoom in a long way after a long delay";
    notes.push(`${why}, so a full run would need ${thousands(steps)} tiny steps. I used bigger steps so it finishes - ` +
               "the waveform may look a bit rough. For a cleaner picture, make 'From' smaller or 'Show' longer.");
    steps = MAX_STEPS;
  } else if (steps > 250000) {
    notes.push(`This one needs about ${thousands(steps)} tiny steps because something in it is very fast, so it can take a little while.`);
  }

  const lines = [`* Spicey Electrons circuit at ${g(temp)} C`, ".options rshunt=1e12 reltol=1e-3 method=gear", `.temp ${g(temp)}`];
  const models = new Map();
  const currents = new Map();
  const pinvecs = new Map();
  const nodes = new Set();

  for (const p of parts) {
    const t = p.type, pid = safe(p.id), pr = p.props;
    if (t === "ground") continue;
    let n = p.nodes.map((x) => (x !== "0" ? safe(x) : "0"));
    n.forEach((x) => { if (x !== "0") nodes.add(x); });
    const leg = LEG[t] ?? 0;
    let sign = SOURCES.includes(t) || ["pnp", "opamp", "555", "not"].includes(t) || GATES.includes(t) ? -1.0 : 1.0;
    if (t === "pnp") sign = -1.0;
    const amm = `vam_${pid}`, inner = `${pid}_am`;
    lines.push(`${amm} ${n[leg]} ${inner} 0`);
    currents.set(p.id, [`i(${amm.toLowerCase()})`, sign]);
    const pv = new Map([[leg, `i(${amm.toLowerCase()})`]]);
    pinvecs.set(p.id, pv);
    n = [...n];
    n[leg] = inner;
    if (["npn", "pnp", "nmos", "555", "pot", "transformer", "relay"].includes(t)) {
      for (let k = 0; k < n.length; k++) {
        if (k !== leg) {
          lines.push(`vam_${pid}_p${k} ${n[k]} ${pid}_p${k} 0`);
          pv.set(k, `i(vam_${pid}_p${k})`.toLowerCase());
          n[k] = `${pid}_p${k}`;
        }
      }
    }
    const N = (key, what, positive = false) => num(pr, key, p.id, what, positive);

    if (t === "resistor") {
      lines.push(`R_${pid} ${n[0]} ${n[1]} ${g(N("value", "resistance", true))}`);
    } else if (t === "capacitor") {
      lines.push(`C_${pid} ${n[0]} ${n[1]} ${g(N("value", "capacitance", true))}`);
    } else if (t === "inductor") {
      lines.push(`L_${pid} ${n[0]} ${pid}_l ${g(N("value", "inductance", true))}`);
      lines.push(`R_${pid}_w ${pid}_l ${n[1]} 0.01`);
    } else if (t === "diode") {
      let m = pr.model ?? "1N4148";
      if (!(m in DATA.diode)) m = "1N4148";
      models.set(m, `.model ${m} ${DATA.diode[m]}`);
      lines.push(`D_${pid} ${n[0]} ${n[1]} ${m}`);
    } else if (t === "led") {
      const c = String(pr.color ?? "red").toLowerCase();
      const mname = `LED_${safe(c)}`;
      models.set(mname, `.model ${mname} ${ledModel(c)}`);
      lines.push(`D_${pid} ${n[0]} ${n[1]} ${mname}`);
    } else if (t === "battery") {
      const v = N("voltage", "voltage");
      lines.push(`V_${pid} ${pid}_int ${n[1]} PWL(0 0 ${g(ramp, 4)} ${g(v)})`);
      lines.push(`R_${pid}_in ${n[0]} ${pid}_int 0.1`);
    } else if (t === "sine") {
      const a = N("amplitude", "amplitude"), f = N("frequency", "frequency", true), o = N("offset", "offset");
      lines.push(`V_${pid} ${pid}_int ${n[1]} SIN(${g(o)} ${g(a)} ${g(f)})`);
      lines.push(`R_${pid}_in ${n[0]} ${pid}_int 0.1`);
    } else if (t === "square") {
      const hi = N("high", "high voltage"), lo = N("low", "low voltage"), f = N("frequency", "frequency", true);
      const duty = Math.max(1.0, Math.min(99.0, N("duty", "duty")));
      const per = 1.0 / f, edge = per / 1000.0, on = per * duty / 100.0 - edge;
      lines.push(`V_${pid} ${pid}_int ${n[1]} PULSE(${g(lo)} ${g(hi)} 0 ${g(edge, 4)} ${g(edge, 4)} ${g(on)} ${g(per)})`);
      lines.push(`R_${pid}_in ${n[0]} ${pid}_int 0.1`);
    } else if (t === "zener") {
      const vz = N("vz", "Zener voltage", true);
      const mname = "DZ" + safe(g(vz));
      models.set(mname, `.model ${mname} D(IS=1e-14 N=1 RS=2 BV=${g(vz)} IBV=5m CJO=50p)`);
      lines.push(`D_${pid} ${n[0]} ${n[1]} ${mname}`);
    } else if (t === "lamp") {
      const v = N("volts", "lamp voltage", true), a = N("amps", "lamp current", true);
      const rh = v / a, pw = v * a, x = `${pid}_x`;
      nodes.add(x);
      const r = `(${g(rh)}*(0.1+0.9*abs(v(${x}))))`;
      lines.push(`B_${pid} ${n[0]} ${n[1]} I = v(${n[0]},${n[1]})/${r}`);
      lines.push(`C_${pid}_x ${x} 0 1`);
      lines.push(`B_${pid}_t 0 ${x} I = (((v(${n[0]},${n[1]})*v(${n[0]},${n[1]})/${r})/${g(pw)}+1e-9)^0.25 - v(${x}))/0.15`);
      lines.push(`.ic v(${x})=0`);
    } else if (t === "speaker") {
      const ohms = N("ohms", "speaker resistance", true);
      lines.push(`R_${pid} ${n[0]} ${pid}_l ${g(ohms)}`);
      lines.push(`L_${pid} ${pid}_l ${n[1]} 0.5m`);
    } else if (t === "relay") {
      const vc = N("coil", "coil voltage", true), rc = vc * vc / 0.36;
      lines.push(`R_${pid}_c ${n[0]} ${pid}_l ${g(rc)}`);
      lines.push(`L_${pid} ${pid}_l ${n[1]} ${g(rc * 1.5e-3)}`);
      const mname = `SWR_${pid}`;
      models.set(mname, `.model ${mname} SW(VT=${g(0.525 * vc)} VH=${g(0.225 * vc)} RON=0.05 ROFF=1e9)`);
      lines.push(`S_${pid} ${n[2]} ${n[3]} ${n[0]} ${n[1]} ${mname}`);
    } else if (t === "motor") {
      const vr = N("volts", "motor voltage", true), ke = vr / 300.0, w = `${pid}_w`;
      nodes.add(w);
      lines.push(`R_${pid} ${n[0]} ${pid}_a 5`);
      lines.push(`L_${pid} ${pid}_a ${pid}_b 2m`);
      lines.push(`V_${pid}_s ${pid}_b ${pid}_c 0`);
      lines.push(`B_${pid}_e ${pid}_c ${n[1]} V = ${g(ke)}*v(${w})`);
      lines.push(`C_${pid}_w ${w} 0 8u`);
      lines.push(`B_${pid}_w 0 ${w} I = ${g(ke)}*i(V_${pid}_s) - ${g(ke * 0.042 / 300.0)}*v(${w})`);
      lines.push(`.ic v(${w})=0`);
    } else if (t === "ldr") {
      const lt = Math.max(0.0, Math.min(100.0, N("light", "light level")));
      lines.push(`R_${pid} ${n[0]} ${n[1]} ${g(100e3 * Math.pow(0.5, lt / 12.5))}`);
    } else if (t === "thermistor") {
      const r25 = N("r25", "resistance at 25 C", true);
      const tk = temp + N("warm", "extra warmth") + 273.15;
      lines.push(`R_${pid} ${n[0]} ${n[1]} ${g(r25 * Math.exp(3950 * (1 / tk - 1 / 298.15)))}`);
    } else if (t === "switch") {
      const closed = [true, "true", "1", 1, "closed"].includes(pr.closed);
      lines.push(`R_${pid} ${n[0]} ${n[1]} ${closed ? "0.01" : "1e9"}`);
    } else if (t === "pot") {
      const total = N("value", "resistance", true);
      const pos = Math.max(0.0, Math.min(100.0, N("position", "position"))) / 100.0;
      lines.push(`R_${pid}_a ${n[0]} ${n[2]} ${g(Math.max(total * pos, 0.01))}`);
      lines.push(`R_${pid}_b ${n[2]} ${n[1]} ${g(Math.max(total * (1 - pos), 0.01))}`);
    } else if (t === "npn" || t === "pnp") {
      let m = pr.model ?? (t === "npn" ? "2N3904" : "2N3906");
      if (!(m in DATA.bjt) || (t === "pnp") !== DATA.bjt[m].startsWith("PNP")) m = t === "npn" ? "2N3904" : "2N3906";
      models.set(m, `.model ${m} ${DATA.bjt[m]}`);
      lines.push(`Q_${pid} ${n[1]} ${n[0]} ${n[2]} ${m}`);
    } else if (t === "nmos") {
      let m = pr.model ?? "2N7000";
      if (!(m in DATA.mos)) m = "2N7000";
      models.set(m, `.model ${m} ${DATA.mos[m]}`);
      lines.push(`M_${pid} ${n[1]} ${n[0]} ${n[2]} ${n[2]} ${m}`);
      for (const [key, a, b, what] of [["cgs", 0, 2, "gate-source capacitance"], ["cgd", 0, 1, "gate-drain capacitance"]]) {
        const cv = N(key, what);
        if (cv < 0) throw new CircuitError(`${p.id}: the ${what} can't be negative.`, p.id);
        if (cv > 0) lines.push(`C_${pid}_${key} ${n[a]} ${n[b]} ${g(cv)}`);
      }
      lines.push(`C_${pid}_ds ${n[1]} ${n[2]} 8p`);
    } else if (t === "transformer") {
      const lp = N("inductance", "primary inductance", true), ratio = N("ratio", "turns ratio", true);
      if (!(ratio >= 0.001 && ratio <= 1000))
        throw new CircuitError(`${p.id}: a turns ratio of ${g(ratio)} is out of range. Try something between 0.001 and 1000 ` +
                               "(0.1 steps the voltage down 10 times, 10 steps it up 10 times).", p.id);
      const k = Math.max(0.01, Math.min(0.9999, N("coupling", "coupling")));
      const ls = lp * ratio * ratio, rs = Math.max(0.01, 0.1 * ratio * ratio);
      lines.push(`L_${pid}p ${n[0]} ${pid}_pl ${g(lp)}`);
      lines.push(`R_${pid}_pw ${pid}_pl ${n[1]} 0.1`);
      lines.push(`L_${pid}s ${n[2]} ${pid}_sl ${g(ls)}`);
      lines.push(`R_${pid}_sw ${pid}_sl ${n[3]} ${g(rs)}`);
      lines.push(`K_${pid} L_${pid}p L_${pid}s ${g(k)}`);
    } else if (GATES.includes(t) || t === "not") {
      const hv = Math.abs(N("level", "logic voltage", true));
      const ins = n.slice(0, -1), hs = [];
      ins.forEach((x, k) => {
        lines.push(`R_${pid}_i${k} ${x} 0 10Meg`);
        hs.push(`(0.5*(1+tanh((v(${x})-${g(hv / 2)})/${g(0.04 * hv)})))`);
      });
      const a_ = hs[0], b_ = hs[hs.length - 1];
      const expr = { and: `${a_}*${b_}`, or: `(1-(1-${a_})*(1-${b_}))`, nand: `(1-${a_}*${b_})`, nor: `((1-${a_})*(1-${b_}))`,
                     xor: `(${a_}+${b_}-2*${a_}*${b_})`, not: `(1-${a_})` }[t];
      lines.push(`B_${pid} ${pid}_x 0 V = ${g(hv)}*${expr}`);
      const gateNo = lines.filter((q) => q.startsWith("B_") && q.includes("_buf ")).length;
      lines.push(`R_${pid}_d ${pid}_x ${pid}_y ${g(1000 * (1 + 0.03 * (gateNo % 7)))}`);
      lines.push(`C_${pid}_d ${pid}_y 0 10p`);
      lines.push(`B_${pid}_buf ${pid}_o 0 V = v(${pid}_y)`);
      lines.push(`R_${pid}_out ${pid}_o ${n[n.length - 1]} 50`);
      lines.push(`.ic v(${pid}_y)=${g(gateNo % 2 ? hv : 0)}`);
    } else if (t === "555") {
      const [vc, gn, tg, out, th, dis] = n;
      lines.push(`R_${pid}_sup ${vc} ${gn} 2k`,
        `C_${pid}_q ${pid}_q ${gn} 100p`,
        `B_${pid}_s ${gn} ${pid}_q I = 1m*(0.5*(1+tanh(((v(${vc},${gn}))/3-v(${tg},${gn}))/0.02))*(1-0.5*(1+tanh((v(${th},${gn})-2*v(${vc},${gn})/3)/0.02)))*(1-v(${pid}_q,${gn}))` +
        ` - 0.5*(1+tanh((v(${th},${gn})-2*v(${vc},${gn})/3)/0.02))*v(${pid}_q,${gn})` +
        ` + 1.2*v(${pid}_q,${gn})*(1-v(${pid}_q,${gn}))*(2*v(${pid}_q,${gn})-1))`,
        `B_${pid}_o ${pid}_o ${gn} V = v(${vc},${gn})*(0.5+0.5*tanh(12*(v(${pid}_q,${gn})-0.5)))`,
        `R_${pid}_out ${pid}_o ${out} 15`,
        `B_${pid}_b ${pid}_qb ${gn} V = 1-v(${pid}_q,${gn})`,
        `S_${pid} ${dis} ${gn} ${pid}_qb ${gn} SW555`);
      models.set("SW555", ".model SW555 SW(Vt=0.5 Vh=0.05 Ron=20 Roff=1e12)");
    } else if (t === "opamp") {
      const rails = Math.abs(N("rails", "supply voltage", true));
      lines.push(`R_${pid}_in ${n[0]} ${n[1]} 10Meg`);
      lines.push(`B_${pid} ${pid}_o 0 V = ${g(rails)}*tanh(1e5*(v(${n[1]})-v(${n[0]}))/${g(rails)})`);
      lines.push(`R_${pid}_out ${pid}_o ${n[2]} 50`);
    }
  }

  lines.push(...models.values());
  const step = dur / POINTS;
  const vecs = [...nodes].sort().map((x) => `v(${x})`).concat([...currents.values()].map(([v]) => v));
  const extra = [];
  for (const d of pinvecs.values()) for (const v of d.values()) if (!vecs.includes(v)) extra.push(v);
  vecs.push(...extra);
  lines.push(".control", "set filetype=binary", `tran ${g(step)} ${g(tstop, 9)} ${g(start, 9)} ${g(tmax)}`,
             "write __OUT__ " + vecs.join(" "), "quit", ".endc", ".end");
  const meta = { nodes: [...nodes].sort(), currents, pinvecs, duration: dur, start, fmax, steps, temp, notes, parts };
  return [lines.join("\n") + "\n", meta];
}
