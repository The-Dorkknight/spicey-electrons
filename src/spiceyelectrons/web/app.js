/* Required Notice: Copyright Matthew Armstrong (https://github.com/The-Dorkknight)
   Licensed under the PolyForm Noncommercial License 1.0.0. No warranty. */
/* Spicey Electrons - friendly circuit editor + scope. Plain JavaScript, no libraries.
 *
 * Board coordinates are in grid units (1 grid = 20 px). Wires are straight segments
 * between grid points. Two things are connected when they share a grid point, or when
 * a wire END (or a leg) lands on the middle of another wire (a T-joint). Wires that
 * just cross do NOT connect - same as a real schematic.
 */
"use strict";
const G = 20;
const $ = (s) => document.querySelector(s);
const svg = $("#board"), world = $("#world");
const L = { flow: $("#flowLayer"), wires: $("#wiresLayer"), parts: $("#partsLayer"), dots: $("#dotsLayer"), probes: $("#probesLayer"), ghost: $("#ghostLayer") };
const PROBE_COLORS = ["#ffb000", "#2fd5ff", "#ff5c8a", "#7dff6b", "#c084ff", "#ff8a3d"];
const LED_RGB = { red: "#ff2a2a", yellow: "#ffd400", green: "#25e04a", blue: "#2f7bff", white: "#ffffff" };
const E12 = ["10", "22", "47", "100", "220", "330", "470", "680", "1k", "2.2k", "4.7k", "10k", "22k", "47k", "100k", "220k", "470k", "1M"];

/* ------------------------------------------------------------------ part definitions */
const TWO = [[-2, 0], [2, 0]];
const lead = (x1, x2) => `<line class="sym" x1="${x1}" y1="0" x2="${x2}" y2="0"/>`;
const leads = (a) => lead(-40, -a) + lead(a, 40);
const DEF = {
  battery: { name: "Battery", group: "power", prefix: "B", pins: TWO, pinNames: ["+", "-"],
    props: { voltage: "9" }, fields: [{ key: "voltage", label: "Voltage (V)", list: ["1.5", "3", "4.5", "5", "6", "9", "12"] }],
    help: "Pushes current round the circuit. The long line is the + side.",
    val: (p) => `${p.props.voltage} V`,
    draw: () => leads(6) + `<line class="sym" x1="-6" y1="-16" x2="-6" y2="16"/><line class="sym" style="stroke-width:5" x1="6" y1="-8" x2="6" y2="8"/>` +
      `<text x="-20" y="-10" style="font-size:14px">+</text>` },
  sine: { name: "Wave maker", group: "power", prefix: "SIG", pins: TWO, pinNames: ["+", "-"],
    props: { amplitude: "5", frequency: "1k", offset: "0" },
    fields: [{ key: "amplitude", label: "How high (peak, V)", list: ["0.1", "0.5", "1", "5", "10"] },
             { key: "frequency", label: "How fast (Hz)", list: ["1", "10", "50", "100", "1k", "10k", "100k"] },
             { key: "offset", label: "Lift it up by (V)", list: ["0", "1", "2.5", "5"] }],
    help: "Makes a smooth wave that goes up and down, like mains electricity (but safe).",
    val: (p) => `${p.props.amplitude} V · ${hz(p.props.frequency)}`,
    draw: () => leads(18) + `<circle class="sym" r="18"/><path class="sym" d="M-11 0 C-7 -14 -2 -14 0 0 S7 14 11 0"/><text x="-30" y="-10" style="font-size:14px">+</text>` },
  square: { name: "Clock / square", group: "power", prefix: "SQ", pins: TWO, pinNames: ["+", "-"],
    props: { high: "5", low: "0", frequency: "1k", duty: "50" },
    fields: [{ key: "high", label: "High (V)", list: ["1", "3.3", "5", "9", "12"] }, { key: "low", label: "Low (V)", list: ["0", "-5"] },
             { key: "frequency", label: "How fast (Hz)", list: ["1", "10", "100", "1k", "10k", "100k"] },
             { key: "duty", label: "Time spent high (%)", range: [1, 99] }],
    help: "Flicks between two voltages over and over, like a clock ticking.",
    val: (p) => `${p.props.low}–${p.props.high} V · ${hz(p.props.frequency)}`,
    draw: () => leads(18) + `<circle class="sym" r="18"/><path class="sym" d="M-11 6 H-5 V-6 H3 V6 H9"/><text x="-30" y="-10" style="font-size:14px">+</text>` },
  ground: { name: "Ground (0 V)", group: "power", prefix: "GND", pins: [[0, 0]], pinNames: ["ground"], props: {}, fields: [],
    help: "The 0 V point. Every voltage on the scope is measured from here.", val: () => "",
    draw: () => `<line class="sym" x1="0" y1="0" x2="0" y2="12"/><line class="sym" x1="-14" y1="12" x2="14" y2="12"/><line class="sym" x1="-9" y1="18" x2="9" y2="18"/><line class="sym" x1="-4" y1="24" x2="4" y2="24"/>` },
  resistor: { name: "Resistor", group: "basic", prefix: "R", pins: TWO, pinNames: ["end 1", "end 2"],
    props: { value: "1k" }, fields: [{ key: "value", label: "Resistance (Ω)", list: E12 }],
    help: "Slows the current down. A bigger number means less current. Real ones show their value with colour bands.",
    val: (p) => ohm(p.props.value),
    draw: () => leads(20) + `<rect class="sym" x="-20" y="-7" width="40" height="14" rx="2"/>` },
  capacitor: { name: "Capacitor", group: "basic", prefix: "C", pins: TWO, pinNames: ["end 1", "end 2"],
    props: { value: "100u" }, fields: [{ key: "value", label: "Capacitance (F)", list: ["10n", "100n", "1u", "10u", "100u", "470u", "1000u"] }],
    help: "Stores a little charge, like a tiny super-fast rechargeable battery. It fills up through a resistor in a smooth curve.",
    val: (p) => `${micro(p.props.value)}F`,
    draw: () => leads(5) + `<line class="sym" x1="-5" y1="-15" x2="-5" y2="15"/><line class="sym" x1="5" y1="-15" x2="5" y2="15"/>` },
  inductor: { name: "Coil (inductor)", group: "basic", prefix: "L", pins: TWO, pinNames: ["end 1", "end 2"],
    props: { value: "10m" }, fields: [{ key: "value", label: "Inductance (H)", list: ["10u", "100u", "1m", "10m", "100m", "1"] }],
    help: "A coil of wire. It hates sudden changes in current and fights back with a voltage spike.",
    val: (p) => `${micro(p.props.value)}H`,
    draw: () => leads(20) + `<path class="sym" d="M-20 0 a5 6 0 0 1 10 0 a5 6 0 0 1 10 0 a5 6 0 0 1 10 0 a5 6 0 0 1 10 0"/>` },
  transformer: { name: "Transformer", group: "basic", prefix: "T", pins: [[-2, -1], [-2, 1], [2, -1], [2, 1]],
    pinNames: ["primary dot (+)", "primary", "secondary dot (+)", "secondary"],
    props: { ratio: "1", inductance: "100m", coupling: "0.99" },
    fields: [{ key: "ratio", label: "Turns ratio (secondary ÷ primary)", list: ["0.1", "0.2", "0.5", "1", "2", "5", "10"] },
             { key: "inductance", label: "Primary coil (H)", list: ["10u", "1m", "10m", "100m", "1"] },
             { key: "coupling", label: "How well the coils share (0-1)", list: ["0.9", "0.95", "0.99", "0.999"] }],
    help: "Two coils on one core. Change the power on one side and the other side gets a scaled copy: ratio 0.1 steps 230 V down to 23 V. It only works with changing power (AC), not steady DC. The dots show which ends go up together.",
    val: (p) => `×${p.props.ratio}`, lab: [30, -34],
    draw: () => `<line class="sym" x1="-40" y1="-20" x2="-12" y2="-20"/><line class="sym" x1="-40" y1="20" x2="-12" y2="20"/>` +
      `<line class="sym" x1="40" y1="-20" x2="12" y2="-20"/><line class="sym" x1="40" y1="20" x2="12" y2="20"/>` +
      `<path class="sym" d="M-12 -20 a7 10 0 0 1 0 20 a7 10 0 0 1 0 20"/><path class="sym" d="M12 -20 a7 10 0 0 0 0 20 a7 10 0 0 0 0 20"/>` +
      `<line class="sym" x1="-3" y1="-22" x2="-3" y2="22"/><line class="sym" x1="3" y1="-22" x2="3" y2="22"/>` +
      `<circle cx="-26" cy="-26" r="2.5" fill="currentColor"/><circle cx="26" cy="-26" r="2.5" fill="currentColor"/>` },
  pot: { name: "Volume knob (pot)", group: "basic", prefix: "VR", pins: [[-2, 0], [2, 0], [0, -2]], pinNames: ["end 1", "end 2", "wiper (middle contact)"],
    props: { value: "10k", position: "50" },
    fields: [{ key: "value", label: "Total resistance (Ω)", list: ["1k", "10k", "100k"] }, { key: "position", label: "Volume knob position (%)", range: [0, 100], live: true }],
    help: "A resistor with a sliding middle contact, like a volume knob. Turn the volume knob and watch the voltage at the middle contact change.",
    val: (p) => `${ohm(p.props.value)} · ${p.props.position}%`, lab: [26, -26],
    draw: () => leads(20) + `<rect class="sym" x="-20" y="-7" width="40" height="14" rx="2"/><line class="sym" x1="0" y1="-40" x2="0" y2="-11" marker-end="url(#arrowHead)"/>` },
  switch: { name: "Switch", group: "basic", prefix: "S", pins: TWO, pinNames: ["end 1", "end 2"],
    props: { closed: true }, fields: [{ key: "closed", toggle: true }],
    help: "Click it to flip it on and off. Real switches click; this one is silent.",
    val: (p) => (isOn(p) ? "ON" : "OFF"),
    draw: (p) => lead(-40, -15) + lead(15, 40) + `<circle class="fill" cx="-15" r="3.5"/><circle class="fill" cx="15" r="3.5"/>` +
      (isOn(p) ? `<line class="sym" x1="-15" y1="0" x2="15" y2="-2"/>` : `<line class="sym" x1="-15" y1="0" x2="12" y2="-16"/>`) },
  diode: { name: "Diode", group: "semi", prefix: "D", pins: TWO, pinNames: ["anode (+)", "cathode (− , the band)"],
    props: { model: "1N4148" }, fields: [{ key: "model", label: "Type", options: { "1N4148": "1N4148 small signal", "1N4007": "1N4007 power (1 A)" } }],
    help: "A one-way valve for current. Current only flows the way the arrow points.",
    val: (p) => p.props.model,
    draw: () => leads(12) + `<path class="fill" d="M-12 -12 L10 0 L-12 12z"/><line class="sym" x1="12" y1="-13" x2="12" y2="13"/>` },
  led: { name: "LED (light)", group: "semi", prefix: "LED", pins: TWO, pinNames: ["anode (+, long leg)", "cathode (−, flat side)"],
    props: { color: "red" }, fields: [{ key: "color", label: "Colour", options: { red: "Red", yellow: "Yellow", green: "Green", blue: "Blue", white: "White" } }],
    help: "A diode that lights up! It always needs a resistor in series, or it burns out.",
    val: (p) => p.props.color,
    draw: (p) => leads(12) + `<path class="fill" d="M-12 -12 L10 0 L-12 12z" style="fill:${LED_RGB[p.props.color] || "#f22"};stroke:#1d2433;stroke-width:1.5"/>` +
      `<line class="sym" x1="12" y1="-13" x2="12" y2="13"/><path class="sym" style="stroke-width:1.8" d="M0 -16 l8 -9 m-5 0 h5 v5 M8 -12 l8 -9 m-5 0 h5 v5"/>` },
  zener: { name: "Zener diode", group: "semi", prefix: "DZ", pins: TWO, pinNames: ["anode (+)", "cathode (−, the band)"],
    props: { vz: "5.1" }, fields: [{ key: "vz", label: "Clamp voltage (V)", list: ["3.3", "5.1", "6.8", "9.1", "12"] }],
    help: "A diode that also blocks BACKWARDS - until the voltage reaches its clamp value, then it holds the voltage steady. Put it backwards (band towards +) with a resistor to make a fixed voltage.",
    val: (p) => `${p.props.vz} V`,
    draw: () => leads(12) + `<path class="fill" d="M-12 -12 L10 0 L-12 12z"/><path class="sym" d="M8 -14 L12 -13 L12 13 L16 14"/>` },
  lamp: { name: "Lamp (bulb)", group: "out", prefix: "LA", pins: TWO, pinNames: ["end 1", "end 2"],
    props: { volts: "6", amps: "0.1" },
    fields: [{ key: "volts", label: "Made for (V)", list: ["3", "6", "12"] }, { key: "amps", label: "Current when lit (A)", list: ["0.05", "0.1", "0.2", "0.5"] }],
    help: "A filament bulb. Cold wire barely resists, so it gulps a big surge when switched on, then heats up, resists more and settles. Too much voltage and it pops!",
    val: (p) => `${p.props.volts} V`,
    draw: (p) => { const x = partV(p.id + "_x"); const b = x === null ? 0 : Math.min(1, Math.max(0, x));
      return leads(18) + (b > 0.02 ? `<circle r="${18 + 14 * b}" fill="#ffd34d" opacity="${0.15 + 0.6 * b}" style="filter:blur(5px)"/>` : "") +
        `<circle class="sym" r="18" style="fill:${b > 0.02 ? `rgba(255,${230 - 60 * b | 0},120,${0.4 + 0.6 * b})` : "#fff"}"/><path class="sym" d="M-13 -13 L13 13 M-13 13 L13 -13"/>`; } },
  speaker: { name: "Speaker / buzzer", group: "out", prefix: "SP", pins: TWO, pinNames: ["end 1", "end 2"],
    props: { ohms: "8" }, fields: [{ key: "ohms", label: "Coil resistance (Ω)", list: ["8", "16", "32", "50"] }],
    help: "A coil that pushes a paper cone. Feed it a wave and it makes sound at that pitch. Waves show when current is flowing.",
    val: (p) => `${p.props.ohms} Ω`,
    draw: (p) => { const i = partI(p.id), a = i === null ? 0 : Math.min(1, Math.abs(i) / 0.3);
      return leads(16) + `<rect class="sym" x="-16" y="-12" width="14" height="24"/><path class="sym" d="M-2 -12 L16 -26 V26 L-2 12z"/>` +
        (a > 0.02 ? `<path class="sym" style="stroke-opacity:${0.3 + 0.7 * a}" d="M22 -10 q6 10 0 20 M28 -16 q10 16 0 32"/>` : ""); } },
  relay: { name: "Relay", group: "out", prefix: "K", box: [100, 70], pins: [[-2, -1], [-2, 1], [2, -1], [2, 1]],
    pinNames: ["coil +", "coil −", "contact 1", "contact 2"],
    props: { coil: "5" }, fields: [{ key: "coil", label: "Coil voltage (V)", list: ["3", "5", "9", "12"] }],
    help: "A switch worked by an electromagnet: a small current in the coil clicks a contact shut that can carry something big, with no wire between. It clicks on at about ¾ of its coil voltage and lets go at about ⅓. Its coil is a coil - watch the spike when it lets go!",
    val: (p) => `${p.props.coil} V coil`, lab: [50, -46],
    draw: (p) => { const on = relayOn(p); return `<rect class="sym" x="-36" y="-28" width="72" height="56" rx="4"/>` +
      `<line class="sym" x1="-40" y1="-20" x2="-22" y2="-20"/><line class="sym" x1="-40" y1="20" x2="-22" y2="20"/><line class="sym" x1="40" y1="-20" x2="22" y2="-20"/><line class="sym" x1="40" y1="20" x2="22" y2="20"/>` +
      `<path class="sym" d="M-22 -20 v8 a5 4 0 0 1 0 8 a5 4 0 0 1 0 8 a5 4 0 0 1 0 8 v8"/>` +
      `<circle class="fill" cx="22" cy="-8" r="3"/><circle class="fill" cx="22" cy="14" r="3"/><line class="sym" x1="22" y1="-20" x2="22" y2="-8"/><line class="sym" x1="22" y1="20" x2="22" y2="14"/>` +
      (on ? `<line class="sym" x1="22" y1="-8" x2="22" y2="14" style="stroke-width:3.5"/>` : `<line class="sym" x1="22" y1="-8" x2="10" y2="8" style="stroke-width:3"/>`) +
      `<text x="-4" y="6" text-anchor="middle" style="font-size:11px">${on ? "CLICK" : "off"}</text>`; } },
  motor: { name: "Motor", group: "out", prefix: "MO", pins: TWO, pinNames: ["+", "−"],
    props: { volts: "6" }, fields: [{ key: "volts", label: "Made for (V)", list: ["3", "6", "9", "12"] }],
    help: "A spinning coil. At the start it's stopped, so it gulps a big current; as it speeds up it makes its own 'back-voltage' that pushes against the battery and the current drops. Watch the spokes spin.",
    val: (p) => `${p.props.volts} V`,
    draw: (p) => { const a = motorAngle(p), sp = [0, 1, 2].map((k) => { const t = (a + k * 120) * Math.PI / 180; return `<line class="sym" x1="0" y1="0" x2="${(14 * Math.cos(t)).toFixed(1)}" y2="${(14 * Math.sin(t)).toFixed(1)}"/>`; }).join("");
      return leads(20) + `<circle class="sym" r="20"/>${sp}<circle class="fill" r="2.5"/><text x="0" y="-26" text-anchor="middle" style="font-size:11px;font-weight:700">M</text>`; } },
  ldr: { name: "Light sensor (LDR)", group: "sense", prefix: "LDR", pins: TWO, pinNames: ["end 1", "end 2"],
    props: { light: "50" }, fields: [{ key: "light", label: "How bright (0 dark - 100 sunny)", range: [0, 100], live: true }],
    help: "A resistor that gets low when light hits it: dark = very high resistance, bright = very low. Slide the brightness and watch.",
    val: (p) => `light ${p.props.light}%`, lab: [0, -34],
    draw: () => leads(20) + `<rect class="sym" x="-20" y="-8" width="40" height="16" rx="2"/><path class="sym" d="M-14 -34 l8 10 m-4 -1 h4 v-4 M-2 -34 l8 10 m-4 -1 h4 v-4" style="stroke-width:1.6"/>` },
  thermistor: { name: "Thermistor (heat sensor)", group: "sense", prefix: "TH", pins: TWO, pinNames: ["end 1", "end 2"],
    props: { r25: "10k", warm: "0" },
    fields: [{ key: "r25", label: "Resistance at 25 °C (Ω)", list: ["1k", "10k", "100k"] }, { key: "warm", label: "Extra warmth (°C) - like holding it", list: ["0", "10", "20", "40"] }],
    help: "A resistor that drops as it warms (an 'NTC'). Press the 0 °C / 20 °C / 40 °C buttons at the top - the whole circuit's temperature changes and so does this part. Add 'extra warmth' to warm just this part.",
    val: (p) => `${ohm(p.props.r25)} NTC`, lab: [0, -30],
    draw: () => leads(20) + `<rect class="sym" x="-20" y="-8" width="40" height="16" rx="2"/><path class="sym" d="M-22 18 H-10 L10 -18" style="stroke-width:1.8"/>` },
  npn: { name: "NPN transistor", group: "semi", prefix: "Q", pins: [[-2, 0], [1, -2], [1, 2]], pinNames: ["base (B)", "collector (C)", "emitter (E)"],
    props: { model: "2N3904" }, fields: [{ key: "model", label: "Type", options: { "2N3904": "2N3904 (small, 200 mA)", "2N2222": "2N2222 (600 mA)" } }],
    help: "A small current into the base lets a big current flow from collector to emitter. It's an electronic switch and amplifier!",
    val: (p) => p.props.model, lab: [30, -6],
    draw: () => bjt(false) },
  pnp: { name: "PNP transistor", group: "semi", prefix: "Q", pins: [[-2, 0], [1, -2], [1, 2]], pinNames: ["base (B)", "collector (C)", "emitter (E)"],
    props: { model: "2N3906" }, fields: [{ key: "model", label: "Type", options: { "2N3906": "2N3906 (small, 200 mA)" } }],
    help: "An NPN turned upside down: put the emitter on +, and pull the base lower to switch it on.",
    val: (p) => p.props.model, lab: [30, -6],
    draw: () => bjt(true) },
  nmos: { name: "MOSFET (N)", group: "semi", prefix: "M", pins: [[-2, 0], [1, -2], [1, 2]], pinNames: ["gate (G)", "drain (D)", "source (S)"],
    props: { model: "2N7000", cgs: "16p", cgd: "4p" },
    fields: [{ key: "model", label: "Type", options: { "2N7000": "2N7000 (small, 200 mA)" } },
             { key: "cgs", label: "Gate-source capacitance (F)", list: ["0", "4p", "16p", "100p"] },
             { key: "cgd", label: "Gate-drain 'Miller' capacitance (F)", list: ["0", "1p", "4p", "20p", "100p"] }],
    help: "A switch you turn on with voltage, not current: about 3 V or more on the gate (compared with the source) turns it on.",
    val: (p) => p.props.model, lab: [30, -6],
    draw: () => `<line class="sym" x1="-40" y1="0" x2="-12" y2="0"/><line class="sym" x1="-12" y1="-14" x2="-12" y2="14"/>` +
      `<line class="sym" x1="-5" y1="-16" x2="-5" y2="-6"/><line class="sym" x1="-5" y1="-4" x2="-5" y2="4"/><line class="sym" x1="-5" y1="6" x2="-5" y2="16"/>` +
      `<path class="sym" d="M-5 -11 H20 V-40 M-5 11 H20 V40 M-5 0 H20 V11"/><path class="fill" d="M-4 0 l9 -5 v10z"/><circle class="sym" cx="4" cy="0" r="24" style="stroke-width:1.5"/>` },
  "555": { name: "555 timer", group: "chip", prefix: "U", box: [100, 130], pins: [[0, -3], [0, 3], [-3, 1], [3, -1], [-3, -1], [3, 1]],
    pinNames: ["+V (pin 8)", "ground (pin 1)", "trigger (pin 2)", "output (pin 3)", "threshold (pin 6)", "discharge (pin 7)"],
    props: {}, fields: [],
    help: "The famous timer chip. It makes the output HIGH when the trigger dips below 1/3 of the supply, and LOW when the threshold rises above 2/3. Add a resistor and capacitor and it blinks or times. Its reset and control pins are tied off for you.",
    val: () => "", lab: [50, -60],
    draw: (p) => { const up = (x, y) => `transform="rotate(${-p.rot * 90} ${x} ${y})"`; return `<rect class="sym" x="-40" y="-50" width="80" height="100" rx="4"/><line class="sym" x1="0" y1="-60" x2="0" y2="-50"/><line class="sym" x1="0" y1="50" x2="0" y2="60"/>` +
      `<line class="sym" x1="-60" y1="-20" x2="-40" y2="-20"/><line class="sym" x1="-60" y1="20" x2="-40" y2="20"/><line class="sym" x1="40" y1="-20" x2="60" y2="-20"/><line class="sym" x1="40" y1="20" x2="60" y2="20"/>` +
      `<text x="0" y="0" dy="7" text-anchor="middle" ${up(0, 0)} style="font-size:20px;font-weight:700">555</text>` +
      `<g style="font-size:10px" text-anchor="middle"><text x="-24" y="-20" dy="4" ${up(-24, -20)}>THR</text><text x="-24" y="20" dy="4" ${up(-24, 20)}>TRG</text>` +
      `<text x="24" y="-20" dy="4" ${up(24, -20)}>OUT</text><text x="24" y="20" dy="4" ${up(24, 20)}>DIS</text>` +
      `<text x="0" y="-32" dy="4" ${up(0, -32)}>+V</text><text x="0" y="33" dy="4" ${up(0, 33)}>GND</text></g>`; } },
  and: { name: "Logic AND", group: "logic", prefix: "G", pins: [[-2, -1], [-2, 1], [2, 0]], pinNames: ["input A", "input B", "output"],
    props: { level: "5" }, fields: [{ key: "level", label: "High level (V)", list: ["3.3", "5", "9", "12"] }],
    help: "Output is HIGH only when A and B are both high.", val: (p) => `${p.props.level} V logic`, lab: [8, -40],
    draw: () => `<line class="sym" x1="-40" y1="-20" x2="-24" y2="-20"/><line class="sym" x1="-40" y1="20" x2="-24" y2="20"/><path class="sym" d="M-24 -28 H-4 a28 28 0 0 1 0 56 H-24 z"/><line class="sym" x1="24" y1="0" x2="40" y2="0"/>` },
  nand: { name: "Logic NAND", group: "logic", prefix: "G", pins: [[-2, -1], [-2, 1], [2, 0]], pinNames: ["input A", "input B", "output"],
    props: { level: "5" }, fields: [{ key: "level", label: "High level (V)", list: ["3.3", "5", "9", "12"] }],
    help: "AND turned upside down: output is LOW only when A and B are both high.", val: (p) => `${p.props.level} V logic`, lab: [8, -40],
    draw: () => `<line class="sym" x1="-40" y1="-20" x2="-24" y2="-20"/><line class="sym" x1="-40" y1="20" x2="-24" y2="20"/><path class="sym" d="M-24 -28 H-4 a28 28 0 0 1 0 56 H-24 z"/><circle class="sym" cx="28" cy="0" r="4"/><line class="sym" x1="32" y1="0" x2="40" y2="0"/>` },
  or: { name: "Logic OR", group: "logic", prefix: "G", pins: [[-2, -1], [-2, 1], [2, 0]], pinNames: ["input A", "input B", "output"],
    props: { level: "5" }, fields: [{ key: "level", label: "High level (V)", list: ["3.3", "5", "9", "12"] }],
    help: "Output is HIGH when A or B (or both) are high.", val: (p) => `${p.props.level} V logic`, lab: [8, -40],
    draw: () => `<line class="sym" x1="-40" y1="-20" x2="-24" y2="-20"/><line class="sym" x1="-40" y1="20" x2="-24" y2="20"/><path class="sym" d="M-28 -28 Q-4 -28 24 0 Q-4 28 -28 28 Q-16 0 -28 -28z"/><line class="sym" x1="24" y1="0" x2="40" y2="0"/>` },
  nor: { name: "Logic NOR", group: "logic", prefix: "G", pins: [[-2, -1], [-2, 1], [2, 0]], pinNames: ["input A", "input B", "output"],
    props: { level: "5" }, fields: [{ key: "level", label: "High level (V)", list: ["3.3", "5", "9", "12"] }],
    help: "OR turned upside down: output is HIGH only when both A and B are low.", val: (p) => `${p.props.level} V logic`, lab: [8, -40],
    draw: () => `<line class="sym" x1="-40" y1="-20" x2="-24" y2="-20"/><line class="sym" x1="-40" y1="20" x2="-24" y2="20"/><path class="sym" d="M-28 -28 Q-4 -28 24 0 Q-4 28 -28 28 Q-16 0 -28 -28z"/><circle class="sym" cx="28" cy="0" r="4"/><line class="sym" x1="32" y1="0" x2="40" y2="0"/>` },
  xor: { name: "Logic XOR", group: "logic", prefix: "G", pins: [[-2, -1], [-2, 1], [2, 0]], pinNames: ["input A", "input B", "output"],
    props: { level: "5" }, fields: [{ key: "level", label: "High level (V)", list: ["3.3", "5", "9", "12"] }],
    help: "Output is HIGH when A and B are different. Add two bits and this is the 'sum' digit.", val: (p) => `${p.props.level} V logic`, lab: [8, -40],
    draw: () => `<line class="sym" x1="-40" y1="-20" x2="-24" y2="-20"/><line class="sym" x1="-40" y1="20" x2="-24" y2="20"/><path class="sym" d="M-28 -28 Q-4 -28 24 0 Q-4 28 -28 28 Q-16 0 -28 -28z"/><path class="sym" d="M-35 -28 Q-23 0 -35 28"/><line class="sym" x1="24" y1="0" x2="40" y2="0"/>` },
  not: { name: "Logic NOT (inverter)", group: "logic", prefix: "G", pins: [[-2, 0], [2, 0]], pinNames: ["input", "output"],
    props: { level: "5" }, fields: [{ key: "level", label: "High level (V)", list: ["3.3", "5", "9", "12"] }],
    help: "Flips the signal: high in, low out and the other way round.", val: (p) => `${p.props.level} V logic`, lab: [8, -40],
    draw: () => `<line class="sym" x1="-40" y1="0" x2="-24" y2="0"/><path class="sym" d="M-24 -24 L-24 24 L20 0z"/><circle class="sym" cx="24" cy="0" r="4"/><line class="sym" x1="28" y1="0" x2="40" y2="0"/>` },
  opamp: { name: "Op-amp", group: "chip", prefix: "U", pins: [[-2, -1], [-2, 1], [2, 0]], pinNames: ["− input", "+ input", "output"],
    props: { rails: "12" }, fields: [{ key: "rails", label: "Powered from ± (V)", list: ["5", "9", "12", "15"] }],
    help: "Makes the difference between its + and − inputs MUCH bigger. Resistors around it set how much. Its power (±12 V) is wired up for you.",
    val: (p) => `±${p.props.rails} V`, lab: [8, -44],
    draw: () => `<path class="sym" d="M-28 -34 L-28 34 L32 0z"/><line class="sym" x1="-40" y1="-20" x2="-28" y2="-20"/><line class="sym" x1="-40" y1="20" x2="-28" y2="20"/>` +
      `<line class="sym" x1="32" y1="0" x2="40" y2="0"/><text x="-24" y="-15" style="font-size:16px">−</text><text x="-24" y="25" style="font-size:16px">+</text>` },
};
function bjt(pnp) {
  const arrow = pnp ? `<path class="fill" d="M0 12 l11 1 l-6 7z"/>` : `<path class="fill" d="M20 23 l-11 -1 l5 -7z"/>`;
  return `<line class="sym" x1="-40" y1="0" x2="-8" y2="0"/><line class="sym" x1="-8" y1="-15" x2="-8" y2="15"/>` +
    `<path class="sym" d="M-8 -6 L20 -22 V-40 M-8 6 L20 22 V40"/>${arrow}<circle class="sym" cx="4" cy="0" r="24" style="stroke-width:1.5"/>`;
}
function partV(node) { return result && !stale && result.voltages[node] ? result.voltages[node][Math.min(cursor, result.time.length - 1)] : null; }
function partI(id) { return result && !stale && result.currents[id] ? result.currents[id][Math.min(cursor, result.time.length - 1)] : null; }
function relayOn(p) {
  if (!result || stale || !nets || !nets.partNodes[p.id]) return false;
  const n = nets.partNodes[p.id], a = result.voltages[n[0]], b = result.voltages[n[1]], t = Math.min(cursor, result.time.length - 1);
  const vc = parseFloat(p.props.coil) || 5, v = (a ? a[t] : 0) - (b ? b[t] : 0);
  // same hysteresis as the engine: on above ~3/4, off below ~1/3 of the coil voltage
  let on = false;
  for (let i = 0; i <= t; i++) { const x = (a ? a[i] : 0) - (b ? b[i] : 0); if (x > 0.75 * vc) on = true; else if (x < 0.3 * vc) on = false; }
  return on;
}
function motorAngle(p) {
  const w = result && !stale ? result.voltages[p.id + "_w"] : null;
  if (!w) return 0;
  let a = 0, t = Math.min(cursor, result.time.length - 1);
  for (let i = 1; i <= t; i++) a += (w[i] + w[i - 1]) / 2 * (result.time[i] - result.time[i - 1]);
  return ((a * 180 / Math.PI) / 30) % 360;      // slowed ~30x so it can be seen
}
const GROUPS = [
  { id: "power", name: "Power", color: "#ffa600", types: ["battery", "sine", "square", "ground"] },
  { id: "basic", name: "Basics", color: "#2f6bff", types: ["resistor", "capacitor", "inductor", "transformer", "pot", "switch"] },
  { id: "semi", name: "Semiconductors", color: "#a347ff", types: ["diode", "zener", "led", "npn", "pnp", "nmos"] },
  { id: "chip", name: "Chips", color: "#ff5c8a", types: ["opamp", "555"] },
  { id: "out", name: "Lights, sound & motion", color: "#ef6c00", types: ["lamp", "speaker", "motor", "relay"] },
  { id: "sense", name: "Sensors", color: "#7cb342", types: ["ldr", "thermistor"] },
  { id: "logic", name: "Logic gates", color: "#12b5a6", types: ["not", "and", "nand", "or", "nor", "xor"] },
];
function isOn(p) { return p.props.closed === true || p.props.closed === "true"; }
function micro(v) { return String(v).replace(/u$/, "µ").replace(/u/, "µ"); }
function ohm(v) { return `${v}Ω`.replace("ΩΩ", "Ω"); }
function hz(v) { return /hz/i.test(v) ? v : `${v}Hz`; }

/* ------------------------------------------------------------------ state */
let S = { parts: [], wires: [], probes: [] };
let sel = null;            // {kind:'part'|'wire', id}
let tool = "select";
let view = { x: 300, y: 220, z: 1 };
let drag = null, placing = null;
let result = null, resultNets = null, stale = false, hasRun = false;
let cursor = 999;          // index into result.time
let temp = 20, job = null, runTimer = null, playing = null;
const undoStack = [];

const key = (p) => p[0] + "," + p[1];
const rot = ([x, y], r) => { for (let i = 0; i < (r & 3); i++) [x, y] = [-y, x]; return [x, y]; };
const pinPos = (p, i) => { const d = rot(DEF[p.type].pins[i], p.rot); return [p.x + d[0], p.y + d[1]]; };
const partById = (id) => S.parts.find((p) => p.id === id);

function newId(type) {
  const pre = DEF[type].prefix;
  let n = 1;
  while (S.parts.some((p) => p.id === pre + n)) n++;
  return pre + n;
}
function snapshot() {
  undoStack.push(JSON.stringify(S));
  if (undoStack.length > 80) undoStack.shift();
}
function undo() {
  if (!undoStack.length) return;
  S = JSON.parse(undoStack.pop());
  sel = null;
  changed();
}

/* ------------------------------------------------------------------ connectivity */
function computeNets() {
  const at = new Map();                    // grid key -> tokens
  const add = (k, t) => { if (!at.has(k)) at.set(k, []); at.get(k).push(t); };
  S.parts.forEach((p) => DEF[p.type].pins.forEach((_, i) => add(key(pinPos(p, i)), `p:${p.id}:${i}`)));
  S.wires.forEach((w, i) => { add(key(w.a), `w:${i}`); add(key(w.b), `w:${i}`); });
  const parent = {};
  const find = (t) => { while (parent[t] && parent[t] !== t) t = parent[t] = parent[parent[t]] || parent[t]; return t; };
  const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[a] = b; };
  for (const toks of at.values()) { toks.forEach((t) => (parent[t] = parent[t] || t)); for (let i = 1; i < toks.length; i++) union(toks[0], toks[i]); }
  S.wires.forEach((w, i) => forInterior(w, (k) => { if (at.has(k)) union(`w:${i}`, at.get(k)[0]); }));
  const nets = {}, size = {};
  for (const toks of at.values()) toks.forEach((t) => { const r = find(t); size[r] = (size[r] || new Set()).add(t); });
  // grounds
  const groundRoots = new Set(S.parts.filter((p) => p.type === "ground").map((p) => find(`p:${p.id}:0`)));
  let n = 1;
  const name = (r) => { if (groundRoots.has(r)) return "0"; if (!nets[r]) nets[r] = "n" + n++; return nets[r]; };
  const partNodes = {}, dangling = new Set();
  S.parts.forEach((p) => {
    partNodes[p.id] = DEF[p.type].pins.map((_, i) => {
      const t = `p:${p.id}:${i}`, r = find(t);
      if (p.type !== "ground" && size[r] && size[r].size === 1) dangling.add(t);
      return name(r);
    });
  });
  const wireNet = S.wires.map((_, i) => name(find(`w:${i}`)));
  const pointNet = (pt) => {
    const k = key(pt);
    if (at.has(k)) return name(find(at.get(k)[0]));
    for (let i = 0; i < S.wires.length; i++) if (onWire(S.wires[i], pt)) return wireNet[i];
    return null;
  };
  // junction dots: 3+ connections at a point
  const junctions = [];
  const count = new Map();
  for (const [k, toks] of at) count.set(k, toks.length);
  S.wires.forEach((w) => forInterior(w, (k) => { if (count.has(k)) count.set(k, count.get(k) + 2); }));
  for (const [k, c] of count) if (c >= 3) junctions.push(k.split(",").map(Number));
  return { partNodes, wireNet, pointNet, dangling, junctions };
}
function forInterior(w, fn) {
  const [ax, ay] = w.a, [bx, by] = w.b;
  if (ax === bx) for (let y = Math.min(ay, by) + 1; y < Math.max(ay, by); y++) fn(ax + "," + y);
  else if (ay === by) for (let x = Math.min(ax, bx) + 1; x < Math.max(ax, bx); x++) fn(x + "," + ay);
}
function onWire(w, [x, y]) {
  const [ax, ay] = w.a, [bx, by] = w.b;
  if (ax === bx && x === ax) return y >= Math.min(ay, by) && y <= Math.max(ay, by);
  if (ay === by && y === ay) return x >= Math.min(ax, bx) && x <= Math.max(ax, bx);
  return false;
}
function hasConnectionAt(pt) {
  const k = key(pt);
  if (S.parts.some((p) => DEF[p.type].pins.some((_, i) => key(pinPos(p, i)) === k))) return true;
  return S.wires.some((w) => onWire(w, pt));
}

/* ------------------------------------------------------------------ editing */
function addPart(type, x, y, r = 0, props) {
  const p = { id: newId(type), type, x, y, rot: r, props: { ...DEF[type].props, ...(props || {}) } };
  S.parts.push(p);
  return p;
}
function addWire(a, b, hFirst = true) {
  if (a[0] === b[0] && a[1] === b[1]) return;
  if (a[0] === b[0] || a[1] === b[1]) { S.wires.push({ a: [...a], b: [...b] }); return; }
  const m = hFirst ? [b[0], a[1]] : [a[0], b[1]];
  S.wires.push({ a: [...a], b: m }, { a: m, b: [...b] });
}
function tidyWires() {
  // turn any diagonal wire (left by dragging a part) into an L, drop zero-length and duplicates
  const out = [], seen = new Set();
  for (const w of S.wires) {
    let segs = [w];
    if (w.a[0] !== w.b[0] && w.a[1] !== w.b[1]) { const m = [w.b[0], w.a[1]]; segs = [{ a: w.a, b: m }, { a: m, b: w.b }]; }
    for (const s of segs) {
      if (s.a[0] === s.b[0] && s.a[1] === s.b[1]) continue;
      const k1 = key(s.a) + "|" + key(s.b), k2 = key(s.b) + "|" + key(s.a);
      if (seen.has(k1) || seen.has(k2)) continue;
      seen.add(k1);
      out.push(s);
    }
  }
  S.wires = out;
}
function deletePart(id) {
  S.parts = S.parts.filter((p) => p.id !== id);
  S.probes = S.probes.filter((q) => q.part !== id);
}
function rotateSel() {
  if (placing) { placing.rot = (placing.rot + 1) & 3; drawGhost(); return; }
  if (!sel || sel.kind !== "part") return;
  const p = partById(sel.id);
  snapshot();
  const old = DEF[p.type].pins.map((_, i) => pinPos(p, i));
  p.rot = (p.rot + 1) & 3;
  const nu = DEF[p.type].pins.map((_, i) => pinPos(p, i));
  moveWireEnds(old, nu);
  tidyWires();
  changed();
}
function moveWireEnds(oldPts, newPts) {
  for (const w of S.wires) for (const end of ["a", "b"]) {
    const i = oldPts.findIndex((q) => q[0] === w[end][0] && q[1] === w[end][1]);
    if (i >= 0) w[end] = [...newPts[i]];
  }
}
function addProbe(probe) {
  if (S.probes.length >= PROBE_COLORS.length) { flash("The scope has room for 6 probes. Remove one first (click its letter)."); return; }
  const used = new Set(S.probes.map((q) => q.color));
  probe.color = PROBE_COLORS.find((c) => !used.has(c));
  probe.letter = "ABCDEF"[PROBE_COLORS.indexOf(probe.color)];
  snapshot();
  S.probes.push(probe);
  changed(false);
}

/* ------------------------------------------------------------------ drawing */
function partSVG(p, extra = "") {
  const d = DEF[p.type];
  const r = p.rot * 90;
  let pins = "";
  d.pins.forEach((pp, i) => (pins += `<circle class="pin" data-kind="pin" data-part="${p.id}" data-pin="${i}" cx="${pp[0] * G}" cy="${pp[1] * G}" r="4"/>`));
  return `<g class="part ${extra}" data-kind="part" data-part="${p.id}" transform="translate(${p.x * G},${p.y * G}) rotate(${r})">` +
    `<rect class="body" x="${-(d.box ? d.box[0] / 2 : 30)}" y="${-(d.box ? d.box[1] / 2 : 30)}" width="${d.box ? d.box[0] : 60}" height="${d.box ? d.box[1] : 60}"/>${d.draw(p)}${pins}</g>`;
}
function labelSVG(p) {
  const d = DEF[p.type];
  if (p.type === "ground") return "";
  const lp = d.lab || (p.rot & 1 ? [0, -24] : [0, -38]);
  let [lx, ly] = rot(lp, p.rot);
  if (d.lab && Math.abs(lx) < 20 && p.rot) {          // turned so the name would sit on the symbol: put it to the right
    const right = Math.max(...d.pins.map((q) => rot(q, p.rot)[0])) * G;
    const half = d.box ? Math.max(d.box[0], d.box[1]) / 2 : 30;
    lx = Math.max(right, half) + 10; ly = -6;
  }
  const anchor = lx > 6 ? "start" : lx < -6 ? "end" : "middle";
  if (p.rot & 1 && !d.lab) ly -= 6;
  const x = p.x * G + lx, y = p.y * G + ly;
  return `<g class="part" data-kind="part" data-part="${p.id}"><text x="${x}" y="${y}" text-anchor="${anchor}">${p.id}</text>` +
    `<text class="val" x="${x}" y="${y + 14}" text-anchor="${anchor}">${esc(d.val(p))}</text>` +
    (() => { const w = String(d.val(p)).length * 8 + 10, rx = anchor === "middle" ? x - w / 2 : anchor === "end" ? x - w : x - 4;
      return `<rect class="valhit" x="${rx}" y="${y + 2}" width="${w}" height="16" fill="transparent" data-kind="part" data-part="${p.id}"/>`; })() + `</g>`;
}
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]); }

let nets = null;
function render() {
  nets = computeNets();
  const warnByPart = {};
  if (result && result.warnings && !stale) result.warnings.forEach((w) => (warnByPart[w.part] = w.level));
  const vAt = (net) => (result && !stale && net && result.voltages[net] ? result.voltages[net][Math.min(cursor, result.time.length - 1)] : null);
  const vmax = result && !stale ? Math.max(0.5, ...Object.values(result.voltages).map((a) => Math.max(...a.map(Math.abs)))) : 1;
  // wires
  let h = "";
  S.wires.forEach((w, i) => {
    const v = vAt(nets.wireNet[i]);
    const col = v === null ? "" : `style="stroke:${voltColor(v / vmax)}"`;
    const isSel = sel && sel.kind === "wire" && sel.id === i ? " sel" : "";
    const d = `M${w.a[0] * G} ${w.a[1] * G} L${w.b[0] * G} ${w.b[1] * G}`;
    h += `<path class="wire${isSel}" d="${d}" ${isSel ? "" : col}/><path class="wirehit" data-kind="wire" data-wire="${i}" d="${d}"/>`;
  });
  L.wires.innerHTML = h;
  drawFlow();
  // parts
  h = "";
  for (const p of S.parts) {
    let cls = sel && sel.kind === "part" && sel.id === p.id ? "sel" : "";
    if (warnByPart[p.id]) cls += " " + warnByPart[p.id];
    h += partSVG(p, cls);
  }
  for (const p of S.parts) h += labelSVG(p);
  // LED glow + flames
  if (result && !stale) for (const p of S.parts) {
    const i = result.currents[p.id];
    if (!i) continue;
    const now = i[Math.min(cursor, i.length - 1)];
    if (p.type === "led" && now > 0.0002) {
      const b = Math.min(1, now / 0.02);
      h += `<circle cx="${p.x * G}" cy="${p.y * G}" r="${14 + 16 * b}" fill="${LED_RGB[p.props.color] || "#f22"}" opacity="${0.15 + 0.55 * b}" style="pointer-events:none;filter:blur(4px)"/>`;
    }
    if (warnByPart[p.id] === "burn") h += `<text class="flame" x="${p.x * G - 40}" y="${p.y * G - 14}">🔥</text>`;
  }
  if (result && !stale) for (const p of S.parts) h += chargeBar(p);
  L.parts.innerHTML = h;
  // junctions + dangling legs
  h = "";
  nets.junctions.forEach(([x, y]) => (h += `<circle class="junction" cx="${x * G}" cy="${y * G}" r="4.5"/>`));
  if (hasRun) nets.dangling.forEach((t) => {
    const [, id, i] = t.split(":");
    const p = partById(id);
    if (p) { const [x, y] = pinPos(p, +i); h += `<circle class="pin dangle" cx="${x * G}" cy="${y * G}" r="5" style="pointer-events:none"/>`; }
  });
  L.dots.innerHTML = h;
  // probes
  h = "";
  S.probes.forEach((q, i) => {
    let x, y;
    if (q.kind === "v") [x, y] = [q.at[0] * G, q.at[1] * G];
    else { const p = partById(q.part); if (!p) return; [x, y] = [p.x * G, p.y * G]; }
    const ox = 16, oy = -22;
    h += `<g class="probe" data-kind="probe" data-probe="${i}"><line x1="${x}" y1="${y}" x2="${x + ox}" y2="${y + oy}" stroke="${q.color}" stroke-width="2.5"/>` +
      `<circle cx="${x}" cy="${y}" r="4" fill="${q.color}" stroke-width="1"/>` +
      `${q.kind === "i" ? `<rect x="${x + ox - 11}" y="${y + oy - 11}" width="22" height="22" rx="5" fill="${q.color}" stroke="#fff" stroke-width="2"/>` : `<circle cx="${x + ox}" cy="${y + oy}" r="11" fill="${q.color}"/>`}<text x="${x + ox}" y="${y + oy}">${q.letter}</text></g>`;
  });
  L.probes.innerHTML = h;
  world.setAttribute("transform", `translate(${view.x},${view.y}) scale(${view.z})`);
  drawScope();
  status();
}
// 5-segment "battery" bar that shows a capacitor's charge or a MOSFET's gate voltage.
// It hangs under its part on a tether, carries the part's name, and its border takes the part's colour.
function chargeBar(p) {
  if (p.type !== "capacitor" && p.type !== "nmos") return "";
  const n = nets.partNodes[p.id];
  if (!n) return "";
  const ti = Math.min(cursor, result.time.length - 1);
  const V = (net) => (result.voltages[net] ? result.voltages[net] : null);
  const gate = p.type === "nmos";
  const a = V(n[gate ? 0 : 0]), b = V(n[gate ? 2 : 1]);
  const zero = (arr) => (arr ? arr : result.time.map(() => 0));
  const A = zero(a), B = zero(b);
  const d = A.map((x, i) => x - B[i]);
  const now = d[ti];
  const vth = gate ? 2.1 : 0;
  const top = Math.max(gate ? vth * 1.6 : 0.1, ...d.map(Math.abs));
  const frac = Math.max(0, Math.min(1, Math.abs(now) / top));
  const lit = Math.ceil(frac * 5 - 1e-9);
  const on = gate && now >= vth;
  const col = gate ? (on ? "#10b04a" : "#f59e0b") : "#2a7fff";
  const pr = DEF[p.type].pins.map((q) => rot(q, p.rot));
  const ext = (f) => f(...pr.map((q) => q[0])) * G, exy = (f) => f(...pr.map((q) => q[1])) * G;
  const w = 78, bh = 46, px = p.x * G, py = p.y * G;
  // pick the free spot (below / right / left / above) that crosses the fewest wires, labels and other parts
  const spots = [
    [px - w / 2, py + exy(Math.max) + 16], [px + Math.max(ext(Math.max), 24) + 70, py - bh / 2],
    [px - Math.max(-ext(Math.min), 24) - 70 - w, py - bh / 2], [px - w / 2, py + exy(Math.min) - 16 - bh]];
  const hit = (x0_, y0_) => {
    let n = 0;
    for (const wi of S.wires) for (let t = 0; t <= 1; t += 0.05) {
      const X = (wi.a[0] + (wi.b[0] - wi.a[0]) * t) * G, Y = (wi.a[1] + (wi.b[1] - wi.a[1]) * t) * G;
      if (X > x0_ - 8 && X < x0_ + w + 8 && Y > y0_ - 6 && Y < y0_ + bh + 6) n++;
    }
    for (const q of S.parts) if (q !== p) { const dx = q.x * G, dy = q.y * G; if (dx > x0_ - 40 && dx < x0_ + w + 40 && dy > y0_ - 40 && dy < y0_ + bh + 40) n += 40; }
    return n;
  };
  let best = spots[0], bs = 1e9;
  spots.forEach((sp, i) => { const sc = hit(sp[0], sp[1]) + i * 0.5; if (sc < bs) { bs = sc; best = sp; } });
  const x0 = best[0], y0 = best[1], cx = x0 + w / 2;
  const tx0 = Math.min(Math.max(px, x0), x0 + w), ty0 = Math.min(Math.max(py, y0), y0 + bh);
  let h = `<g class="cbar" style="pointer-events:none">`;
  h += `<line x1="${px}" y1="${py}" x2="${tx0}" y2="${ty0}" stroke="${col}" stroke-width="2" stroke-dasharray="3 3"/>`;
  h += `<rect x="${x0 - 5}" y="${y0}" width="${w + 10}" height="46" rx="8" fill="#fff" stroke="${col}" stroke-width="2.5"/>`;
  h += `<text x="${cx}" y="${y0 + 13}" text-anchor="middle" font-size="11" font-weight="700" fill="${col}">${p.id} ${gate ? "gate" : "charge"}</text>`;
  for (let i = 0; i < 5; i++) h += `<rect x="${x0 + i * 16}" y="${y0 + 18}" width="13" height="12" rx="2" fill="${i < lit ? col : "#e5e7eb"}"/>`;
  if (gate) { const tx = x0 + Math.min(1, vth / top) * w; h += `<line x1="${tx}" y1="${y0 + 15}" x2="${tx}" y2="${y0 + 33}" stroke="#111" stroke-width="2"/>`; }
  h += `<text x="${cx}" y="${y0 + 42}" text-anchor="middle" font-size="10.5" fill="#444">${fmt(now, "V")}${gate ? (on ? " · ON" : " · off") : ""}</text></g>`;
  return h;
}
/* ------------------------------------------------------------------ moving current dots
   Every part pin's current is known from the engine, so the current in each bit of wire follows from
   Kirchhoff's current law - as long as the wires of a net form a tree (no loop of wire on its own). */
function wireFlows() {
  if (!result || stale || !result.pins || !nets) return [];
  const t = Math.min(cursor, result.time.length - 1);
  const out = [];
  const pk = (x, y) => x + "," + y;
  const byNet = {};
  S.wires.forEach((w, i) => (byNet[nets.wireNet[i]] = byNet[nets.wireNet[i]] || []).push(i));
  const pinsOf = {};                          // net -> [{key, into}]
  for (const p of S.parts) {
    const arr = result.pins[p.id];
    DEF[p.type].pins.forEach((_, k) => {
      const net = nets.partNodes[p.id][k];
      const [x, y] = pinPos(p, k);
      const into = p.type === "ground" ? null : (arr && arr[k] ? arr[k][t] : 0);
      (pinsOf[net] = pinsOf[net] || []).push({ key: pk(x, y), into });
    });
  }
  for (const net in byNet) {
    const ws = byNet[net], pins = pinsOf[net] || [];
    const grounds = pins.filter((q) => q.into === null);
    if (grounds.length > 1) continue;
    const pts = new Set(pins.map((q) => q.key));
    ws.forEach((i) => { pts.add(pk(...S.wires[i].a)); pts.add(pk(...S.wires[i].b)); });
    const edges = [];
    for (const i of ws) {
      const w = S.wires[i], [ax, ay] = w.a, [bx, by] = w.b;
      const horiz = ay === by, steps = horiz ? Math.abs(bx - ax) : Math.abs(by - ay), dx = Math.sign(bx - ax), dy = Math.sign(by - ay);
      let prev = [ax, ay];
      for (let s = 1; s <= steps; s++) {
        const cur = [ax + dx * s, ay + dy * s];
        if (s === steps || pts.has(pk(...cur))) { edges.push({ u: pk(...prev), v: pk(...cur), a: prev, b: cur }); prev = cur; }
      }
    }
    const nodes = new Set(); edges.forEach((e) => { nodes.add(e.u); nodes.add(e.v); });
    if (edges.length !== nodes.size - 1) continue;                    // a loop of wire: can't tell which way it goes
    const inj = {};
    let total = 0;
    for (const q of pins) if (q.into !== null) { inj[q.key] = (inj[q.key] || 0) - q.into; total -= q.into; }
    if (grounds.length === 1) inj[grounds[0].key] = (inj[grounds[0].key] || 0) - total;
    const adj = {}; edges.forEach((e, n) => { (adj[e.u] = adj[e.u] || []).push([e.v, n]); (adj[e.v] = adj[e.v] || []).push([e.u, n]); });
    const root = [...nodes][0], par = { [root]: null }, order = [root], via = {};
    for (let q = 0; q < order.length; q++) for (const [v, n] of adj[order[q]]) if (!(v in par)) { par[v] = order[q]; via[v] = n; order.push(v); }
    if (order.length !== nodes.size) continue;
    const sub = {};
    for (let q = order.length - 1; q >= 0; q--) { const u = order[q]; sub[u] = (sub[u] || 0) + (inj[u] || 0); if (par[u] !== null) sub[par[u]] = (sub[par[u]] || 0) + sub[u]; }
    for (const v of order) if (par[v] !== null) {
      const e = edges[via[v]], f = sub[v];                            // f = current flowing from v up to its parent
      out.push({ a: e.a, b: e.b, flow: e.v === par[v] ? f : -f });  // flow along a -> b (e.v is the parent end: v is e.u)
    }
  }
  return out;
}
const flowPhase = new Map();      // wire piece -> how far its dots have travelled (px), so they keep moving smoothly
let flowItems = [];
function drawFlow() {
  flowItems = [];
  if (!$("#flowDots") || !$("#flowDots").checked) { L.flow.innerHTML = ""; return; }
  let h = "", k = 0;
  for (const f of wireFlows()) {
    const a = Math.abs(f.flow);
    if (!(a > 1e-6)) continue;
    const dec = Math.log10(a / 1e-6);                                // 0 at 1 uA, 3 at 1 mA, 6 at 1 A
    const speed = Math.min(160, 14 + 24 * dec) * Math.sign(f.flow);   // px per second; negative = flows b -> a
    const r = Math.min(4.2, 2.1 + 0.35 * dec);
    const key = f.a + ">" + f.b;
    flowItems.push({ key, speed });
    const ph = flowPhase.get(key) || 0;
    h += `<path class="flow" data-k="${k++}" d="M${f.a[0] * G} ${f.a[1] * G} L${f.b[0] * G} ${f.b[1] * G}" stroke-width="${(r * 2).toFixed(1)}" stroke-dasharray="0.1 15.9" stroke-dashoffset="${(-ph).toFixed(2)}"/>`;
  }
  L.flow.innerHTML = h;
}
// Moves every dot by (speed x time). Because the speed is signed, dots turn round when the current reverses (AC).
function stepDots(dt) {
  const els = L.flow.children;
  for (let i = 0; i < flowItems.length && i < els.length; i++) {
    const it = flowItems[i];
    const ph = ((flowPhase.get(it.key) || 0) + it.speed * dt) % 16;
    flowPhase.set(it.key, ph);
    els[i].setAttribute("stroke-dashoffset", (-ph).toFixed(2));
  }
}
function voltColor(f) {
  // 0 V grey, + green, − red (like Falstad)
  f = Math.max(-1, Math.min(1, f));
  const g = [140, 150, 165];
  const t = f >= 0 ? [16, 190, 70] : [235, 50, 50];
  const k = Math.abs(f);
  return `rgb(${g.map((c, i) => Math.round(c + (t[i] - c) * k)).join(",")})`;
}
function drawGhost(pt) {
  if (!placing) { L.ghost.innerHTML = ""; return; }
  if (pt) [placing.x, placing.y] = pt;
  L.ghost.innerHTML = `<g class="ghost">${partSVG({ ...placing, id: "ghost" })}</g>`;
}
function status() {
  const tips = {
    select: "Drag parts to move them · double-click a part (or its blue value) to change its value · drag from a leg dot to draw a wire · right-click for more",
    wire: "Click or drag to draw wires · Esc to stop",
    probe: "Click a wire to see its voltage · click a part to see the current through it",
    erase: "Click a part, wire or probe to remove it",
  };
  $("#status").textContent = placing ? `Click the board to drop the ${DEF[placing.type].name.toLowerCase()} · R to turn it · Esc to cancel` : tips[tool];
}

/* ------------------------------------------------------------------ palette + panels */
function iconSVG(type) {
  const p = { type, rot: 0, props: { ...DEF[type].props } };
  return `<svg viewBox="-48 -44 96 88"><g class="part">${DEF[type].draw(p)}</g></svg>`;
}
function buildPalette() {
  const pal = $("#palette");
  for (const g of GROUPS) {
    const div = document.createElement("div");
    div.className = "group";
    div.innerHTML = `<div class="gh" style="background:${g.color}"><span class="arrow">▾</span>${g.name}</div><div class="items"></div>`;
    div.querySelector(".gh").onclick = () => div.classList.toggle("closed");
    for (const t of g.types) {
      const it = document.createElement("div");
      it.className = "item";
      it.innerHTML = iconSVG(t) + `<span>${DEF[t].name}</span>`;
      it.onpointerdown = (e) => { e.preventDefault(); try { it.releasePointerCapture(e.pointerId); } catch (_) {} startPlacing(t); };
      it.onpointerenter = () => showPreview(t);
      div.querySelector(".items").appendChild(it);
    }
    pal.appendChild(div);
  }
}
function showPreview(t) {
  const d = DEF[t];
  $("#preview").innerHTML = `<h3>${d.name}</h3><div style="text-align:center">${iconSVG(t).replace("<svg", '<svg style="width:140px;height:90px"')}</div>` +
    `<div>${d.help}</div><div class="hint" style="margin-top:6px">Legs: ${d.pinNames.join(" · ")}</div>`;
}
function startPlacing(type) {
  sel = null;
  placing = { type, x: 0, y: 0, rot: 0, props: { ...DEF[type].props } };
  setTool("select");
  showPreview(type);
  render();
}
function showProps() {
  const box = $("#props");
  if (!sel || sel.kind !== "part") { box.classList.add("hidden"); return; }
  const p = partById(sel.id);
  if (!p) { box.classList.add("hidden"); return; }
  const d = DEF[p.type];
  let h = `<h3>${p.id} · ${d.name}</h3><div class="hint">${d.help}</div>`;
  d.fields.forEach((f) => {
    if (f.toggle) {
      h += `<div class="row"><button data-toggle="${f.key}" style="flex:1;font-size:15px;padding:9px;background:${isOn(p) ? "#18b25a" : "#ef3b3b"};color:#fff">${isOn(p) ? "Switch is ON - click to turn off" : "Switch is OFF - click to turn on"}</button></div>`;
    } else if (f.options) {
      h += `<label>${f.label}</label><select data-key="${f.key}">` +
        Object.entries(f.options).map(([k, v]) => `<option value="${k}" ${p.props[f.key] === k ? "selected" : ""}>${v}</option>`).join("") + `</select>`;
    } else if (f.range) {
      h += `<label>${f.label}: <b id="rv_${f.key}">${p.props[f.key]}</b></label><input type="range" min="${f.range[0]}" max="${f.range[1]}" value="${p.props[f.key]}" data-key="${f.key}" data-range="1">`;
    } else {
      const sv = splitSI(p.props[f.key]), unitful = /[(, ](V|Ω|F|H|Hz|A)\)/.test(f.label);
      const pre = [["", "— plain"], ["G", "G giga"], ["M", "M mega"], ["k", "k kilo"], ["m", "m milli"], ["u", "µ micro"], ["n", "n nano"], ["p", "p pico"]];
      h += `<label>${f.label}</label><div class="valrow"><input type="text" inputmode="decimal" data-key="${f.key}" data-num="1" value="${esc(unitful && sv ? sv.n : p.props[f.key])}" list="dl_${f.key}">` +
        (unitful ? `<select data-pre="${f.key}" title="Pick the size: k = kilo, µ = micro, n = nano, p = pico">${pre.map(([k, t]) => `<option value="${k}" ${sv && sv.p === k ? "selected" : ""}>${t}</option>`).join("")}</select>` : "") +
        `</div><div class="bad hidden" data-bad="${f.key}">That isn't a number I can read. Type something like 4.7, then pick k, µ, n or p from the list.</div>` +
        `<datalist id="dl_${f.key}">${(f.list || []).map((v) => `<option value="${v}">`).join("")}</datalist>`;
    }
  });
  h += `<div class="row"><button data-act="rot">↻ Turn</button><button data-act="probe">🔎 Probe current</button><button data-act="del">🗑</button></div>`;
  box.innerHTML = `<button class="close" title="Close">×</button>` + h + `<div class="hint" style="margin-top:8px">Type a new value and press Enter.</div>`;
  box.classList.remove("hidden");
  box.querySelector(".close").onclick = () => { sel = null; showProps(); render(); };
  box.querySelectorAll("input[data-num]").forEach((el) => {
    const key = el.dataset.key, sel2 = box.querySelector(`select[data-pre="${key}"]`), bad = box.querySelector(`[data-bad="${key}"]`);
    const commitNum = () => {
      const t = el.value.trim(), typed = splitSI(t);
      let str = t;
      if (sel2) {
        if (typed && typed.p) { el.value = typed.n; sel2.value = typed.p; str = typed.n + typed.p; }   // they typed "10u" or "4k7" themselves
        else str = t + sel2.value;
      }
      if (parseSI(str) === null) { bad.classList.remove("hidden"); el.classList.add("wrong"); return; }
      bad.classList.add("hidden"); el.classList.remove("wrong");
      if (p.props[key] === str) return;
      snapshot(); p.props[key] = str; changed(true, 400, true);
    };
    el.addEventListener("change", commitNum);
    el.addEventListener("keydown", (e) => { if (e.key === "Enter") commitNum(); });
    if (sel2) sel2.addEventListener("change", commitNum);
  });
  box.querySelectorAll("[data-key]:not([data-num])").forEach((el) => {
    const commit = () => {
      if (p.props[el.dataset.key] === el.value) return;
      snapshot();
      p.props[el.dataset.key] = el.value;
      changed(true, el.dataset.range ? 150 : 400, true);
    };
    el.addEventListener("change", commit);
    if (el.dataset.range) el.addEventListener("input", () => { $("#rv_" + el.dataset.key).textContent = el.value; commit(); });
    if (el.tagName === "INPUT" && !el.dataset.range) el.addEventListener("keydown", (e) => { if (e.key === "Enter") commit(); });
  });
  box.querySelectorAll("[data-toggle]").forEach((el) => (el.onclick = () => toggleSwitch(p)));
  box.querySelector('[data-act="rot"]').onclick = rotateSel;
  box.querySelector('[data-act="del"]').onclick = () => { snapshot(); deletePart(p.id); sel = null; changed(); };
  box.querySelector('[data-act="probe"]').onclick = () => addProbe({ kind: "i", part: p.id });
}
/* Friendly numbers: "4.7k", "100n", "4k7", "10 uF", "2.2 kΩ". Capital M = mega, small m = milli (same rule as the engine). */
const SI = { f: 1e-15, p: 1e-12, n: 1e-9, u: 1e-6, "µ": 1e-6, "μ": 1e-6, m: 1e-3, k: 1e3, K: 1e3, M: 1e6, meg: 1e6, Meg: 1e6, G: 1e9, "": 1 };
function cleanSI(s) {
  s = String(s).trim().replace(",", ".");
  for (const u of ["ohms", "ohm", "Ω", "Hz", "hz", "F", "H", "V", "A", "s"]) if (s.length > u.length && s.endsWith(u)) { s = s.slice(0, -u.length).trim(); break; }
  return s;
}
function splitSI(str) {
  const s = cleanSI(str);
  let m = s.match(/^(\d+)([pnuµμmkKMGR])(\d+)$/);
  if (m) return { n: m[1] + "." + m[3], p: m[2] === "R" ? "" : m[2] === "µ" || m[2] === "μ" ? "u" : m[2] === "K" ? "k" : m[2] };
  m = s.match(/^([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)\s*(meg|Meg|MEG|[fpnuµμmkKMG]?)$/);
  if (!m) return null;
  let pp = m[2]; if (pp === "µ" || pp === "μ") pp = "u"; if (pp === "K") pp = "k"; if (/^meg$/i.test(pp)) pp = "M";
  return { n: m[1], p: pp };
}
function parseSI(str) {
  const v = splitSI(str);
  if (!v) return null;
  const x = parseFloat(v.n) * (SI[v.p] ?? 1);
  return Number.isFinite(x) ? x : null;
}
function editValue(id) {
  sel = { kind: "part", id };
  showProps(); render();
  const el = $("#props input[type=text]") || $("#props select, #props input");
  if (el) { el.focus(); if (el.select) el.select(); }
}
let lastPartClick = { id: null, t: 0 };
function toggleSwitch(p) {
  snapshot();
  p.props.closed = !isOn(p);
  changed(true, 50);
}

/* ------------------------------------------------------------------ pointer handling */
function toWorld(e) {
  const r = svg.getBoundingClientRect();
  return [(e.clientX - r.left - view.x) / view.z, (e.clientY - r.top - view.y) / view.z];
}
const snap = (w) => [Math.round(w[0] / G), Math.round(w[1] / G)];
function hit(e) {
  const t = e.target.closest ? e.target.closest("[data-kind]") : null;
  if (!t) return { kind: "empty" };
  return { kind: t.dataset.kind, part: t.dataset.part, pin: t.dataset.pin !== undefined ? +t.dataset.pin : null,
           wire: t.dataset.wire !== undefined ? +t.dataset.wire : null, probe: t.dataset.probe !== undefined ? +t.dataset.probe : null };
}

svg.addEventListener("pointerdown", (e) => {
  hideCtx();
  svg.focus();
  if (e.button === 2) return;
  const w = toWorld(e), g = snap(w), h = hit(e);
  if (placing) return;                      // dropped on pointerup
  if (drag && drag.type === "wire" && drag.click) { finishWireClick(g); return; }
  if (tool === "erase") { eraseAt(h); return; }
  if (tool === "probe") { probeAt(h, g, w); return; }
  if (tool === "wire" || h.kind === "pin") {
    const start = h.kind === "pin" ? pinPos(partById(h.part), h.pin) : g;
    drag = { type: "wire", from: start, to: start, hFirst: null, moved: false };
    svg.setPointerCapture(e.pointerId);
    return;
  }
  if (h.kind === "part") {
    const p = partById(h.part);
    sel = { kind: "part", id: p.id };
    drag = { type: "move", id: p.id, start: g, orig: [p.x, p.y], moved: false, onVal: !!(e.target.classList && e.target.classList.contains("valhit")), snap: JSON.stringify(S),
             pins: DEF[p.type].pins.map((_, i) => pinPos(p, i)) };
    svg.setPointerCapture(e.pointerId);
    showProps();
    render();
    return;
  }
  if (h.kind === "wire") {
    sel = { kind: "wire", id: h.wire };
    // dragging from the middle of a wire starts a new branch
    drag = { type: "wire", from: g, to: g, hFirst: null, moved: false, fromWire: true };
    svg.setPointerCapture(e.pointerId);
    showProps();
    render();
    return;
  }
  if (h.kind === "probe") { selectProbe(h.probe); return; }
  sel = null;
  showProps();
  drag = { type: "pan", sx: e.clientX, sy: e.clientY, v: { ...view } };
  svg.setPointerCapture(e.pointerId);
  render();
});
svg.addEventListener("pointermove", (e) => {
  const w = toWorld(e), g = snap(w);
  if (placing) { drawGhost(g); return; }
  if (!drag) { hover(e, w); return; }
  if (drag.type === "pan") {
    view.x = drag.v.x + e.clientX - drag.sx;
    view.y = drag.v.y + e.clientY - drag.sy;
    world.setAttribute("transform", `translate(${view.x},${view.y}) scale(${view.z})`);
  } else if (drag.type === "move") {
    const p = partById(drag.id);
    const nx = drag.orig[0] + g[0] - drag.start[0], ny = drag.orig[1] + g[1] - drag.start[1];
    if (nx === p.x && ny === p.y) return;
    if (!drag.moved) { undoStack.push(drag.snap); drag.moved = true; }
    const old = DEF[p.type].pins.map((_, i) => pinPos(p, i));
    p.x = nx; p.y = ny;
    moveWireEnds(old, DEF[p.type].pins.map((_, i) => pinPos(p, i)));
    stale = true;
    render();
  } else if (drag.type === "wire") {
    drag.to = g;
    const dx = g[0] - drag.from[0], dy = g[1] - drag.from[1];
    if (drag.hFirst === null && (dx || dy)) drag.hFirst = Math.abs(dx) >= Math.abs(dy);
    if (dx || dy) drag.moved = true;
    drawWireGhost();
  }
});
svg.addEventListener("pointerup", (e) => {
  const g = snap(toWorld(e));
  if (placing) {
    // only drop when released over the board
    snapshot();
    const p = addPart(placing.type, g[0], g[1], placing.rot, placing.props);
    placing = null;
    L.ghost.innerHTML = "";
    sel = { kind: "part", id: p.id };
    showProps();
    changed();
    return;
  }
  if (!drag) return;
  const d = drag;
  if (d.type === "move" && !d.moved) {          // a plain click: second click within 0.5 s, or a click on the blue value, edits it
    const now = Date.now(), onVal = d.onVal;
    if (onVal || (lastPartClick.id === d.id && now - lastPartClick.t < 500)) { lastPartClick = { id: null, t: 0 }; setTimeout(() => editValue(d.id), 0); }
    else lastPartClick = { id: d.id, t: now };
  }
  if (d.type === "move") {
    drag = null;
    if (d.moved) { tidyWires(); changed(); }
    else {
      const p = partById(d.id);
      if (p && p.type === "switch") toggleSwitch(p);
    }
  } else if (d.type === "wire") {
    if (d.moved) {
      snapshot();
      addWire(d.from, d.to, d.hFirst !== false);
      drag = null;
      L.ghost.innerHTML = "";
      changed();
    } else if (tool === "wire" || !d.fromWire) {
      d.click = true;                   // click-click mode: next click places the corner/end
      drawWireGhost();
    } else drag = null;
  } else drag = null;
});
function finishWireClick(g) {
  const d = drag;
  if (g[0] === d.from[0] && g[1] === d.from[1]) { drag = null; L.ghost.innerHTML = ""; return; }
  snapshot();
  const hFirst = d.hFirst !== null ? d.hFirst : Math.abs(g[0] - d.from[0]) >= Math.abs(g[1] - d.from[1]);
  const endsOnSomething = hasConnectionAt(g);
  addWire(d.from, g, hFirst);
  if (endsOnSomething) { drag = null; L.ghost.innerHTML = ""; }
  else drag = { type: "wire", from: g, to: g, hFirst: null, moved: false, click: true };
  changed();
}
function drawWireGhost() {
  const d = drag, a = d.from, b = d.to;
  let pts = [a, b];
  if (a[0] !== b[0] && a[1] !== b[1]) pts = [a, d.hFirst !== false ? [b[0], a[1]] : [a[0], b[1]], b];
  L.ghost.innerHTML = `<polyline class="ghostwire" points="${pts.map((p) => p[0] * G + "," + p[1] * G).join(" ")}"/>` +
    `<circle cx="${b[0] * G}" cy="${b[1] * G}" r="5" fill="#18b25a"/>`;
}
svg.addEventListener("wheel", (e) => {
  e.preventDefault();
  const r = svg.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
  const z = Math.max(0.3, Math.min(3, view.z * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
  view.x = mx - ((mx - view.x) * z) / view.z;
  view.y = my - ((my - view.y) * z) / view.z;
  view.z = z;
  world.setAttribute("transform", `translate(${view.x},${view.y}) scale(${view.z})`);
}, { passive: false });
svg.addEventListener("pointerleave", () => $("#tip").classList.add("hidden"));
svg.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  if (drag && drag.type === "wire") { drag = null; L.ghost.innerHTML = ""; return; }
  if (placing) { placing = null; drawGhost(); status(); return; }
  const h = hit(e), w = toWorld(e), g = snap(w);
  const items = [];
  if (h.kind === "part") {
    const p = partById(h.part);
    sel = { kind: "part", id: p.id }; showProps(); render();
    if (p.type === "switch") items.push(["Flip switch", () => toggleSwitch(p)]);
    items.push(["↻ Turn", rotateSel], ["🔎 Probe current through " + p.id, () => addProbe({ kind: "i", part: p.id })],
      ["🗑 Delete " + p.id, () => { snapshot(); deletePart(p.id); sel = null; changed(); }]);
  } else if (h.kind === "wire" || h.kind === "pin") {
    const at = h.kind === "pin" ? pinPos(partById(h.part), h.pin) : nearestOnWire(S.wires[h.wire], w);
    items.push(["🔎 Probe voltage here", () => addProbe({ kind: "v", at })]);
    if (h.kind === "wire") items.push(["🗑 Delete wire", () => { snapshot(); S.wires.splice(h.wire, 1); sel = null; changed(); }]);
  } else if (h.kind === "probe") {
    items.push(["Remove probe " + S.probes[h.probe].letter, () => removeProbe(h.probe)]);
  } else {
    items.push(["▶ Run", run], ["Fit to screen", fitView]);
  }
  const m = $("#ctx"), r = svg.getBoundingClientRect();
  m.innerHTML = "";
  items.forEach(([label, fn]) => { const b = document.createElement("button"); b.textContent = label; b.onclick = () => { hideCtx(); fn(); }; m.appendChild(b); });
  m.style.left = e.clientX - r.left + "px";
  m.style.top = e.clientY - r.top + "px";
  m.classList.remove("hidden");
});
function hideCtx() { $("#ctx").classList.add("hidden"); }
function nearestOnWire(w, wpt) {
  const g = snap(wpt);
  if (w.a[0] === w.b[0]) return [w.a[0], Math.max(Math.min(w.a[1], w.b[1]), Math.min(Math.max(w.a[1], w.b[1]), g[1]))];
  return [Math.max(Math.min(w.a[0], w.b[0]), Math.min(Math.max(w.a[0], w.b[0]), g[0])), w.a[1]];
}
function eraseAt(h) {
  if (h.kind === "part" || h.kind === "pin") { snapshot(); deletePart(h.part); sel = null; changed(); }
  else if (h.kind === "wire") { snapshot(); S.wires.splice(h.wire, 1); sel = null; changed(); }
  else if (h.kind === "probe") removeProbe(h.probe);
}
function probeAt(h, g, w) {
  if (h.kind === "probe") return removeProbe(h.probe);
  if (h.kind === "pin") return addProbe({ kind: "v", at: pinPos(partById(h.part), h.pin) });
  if (h.kind === "wire") return addProbe({ kind: "v", at: nearestOnWire(S.wires[h.wire], w) });
  if (h.kind === "part") {
    const p = partById(h.part);
    if (p.type === "ground") return addProbe({ kind: "v", at: [p.x, p.y] });
    return addProbe({ kind: "i", part: p.id });
  }
  flash("Click on a wire (for voltage) or on a part (for current).");
}
function removeProbe(i) { snapshot(); S.probes.splice(i, 1); changed(false); }
function selectProbe(i) { if (tool === "erase") removeProbe(i); }

function hover(e, w) {
  const tip = $("#tip");
  const h = hit(e);
  let text = "";
  const ti = Math.min(cursor, result ? result.time.length - 1 : 0);
  const haveRes = result && !stale;
  if (h.kind === "pin") {
    const p = partById(h.part);
    text = `${p.id}: ${DEF[p.type].pinNames[h.pin]}`;
    if (haveRes) { const n = nets.partNodes[p.id][h.pin]; const v = result.voltages[n]; if (v) text += ` · ${fmt(v[ti], "V")}`; }
  } else if (h.kind === "wire" && haveRes) {
    const v = result.voltages[nets.wireNet[h.wire]];
    if (v) text = `${fmt(v[ti], "V")} at ${fmt(result.time[ti], "s")}`;
  } else if (h.kind === "part" && haveRes) {
    const p = partById(h.part), i = result.currents[p.id], n = nets.partNodes[p.id];
    if (i) {
      text = `${p.id}: ${fmt(i[ti], "A")}`;
      if (n.length === 2 && result.voltages[n[0]] && result.voltages[n[1]]) text += ` · ${fmt(result.voltages[n[0]][ti] - result.voltages[n[1]][ti], "V")} across it`;
    }
  }
  if (!text) { tip.classList.add("hidden"); return; }
  const r = svg.getBoundingClientRect();
  tip.textContent = text;
  tip.style.left = e.clientX - r.left + 14 + "px";
  tip.style.top = e.clientY - r.top + 14 + "px";
  tip.classList.remove("hidden");
}

document.addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && k === "z") { e.preventDefault(); undo(); return; }
  if (k === "r") rotateSel();
  else if (k === "escape") { placing = null; drag = null; L.ghost.innerHTML = ""; hideCtx(); status(); }
  else if (k === "delete" || k === "backspace") {
    if (!sel) return;
    snapshot();
    if (sel.kind === "part") deletePart(sel.id); else S.wires.splice(sel.id, 1);
    sel = null; changed();
  } else if (k === "v") setTool("select");
  else if (k === "w") setTool("wire");
  else if (k === "p") setTool("probe");
  else if (k === "e") setTool("erase");
  else if (k === "enter") run();
});
function setTool(t) {
  tool = t;
  document.querySelectorAll(".tool").forEach((b) => b.classList.toggle("active", b.dataset.tool === t));
  svg.setAttribute("class", "tool-" + t);
  if (drag && drag.type === "wire") { drag = null; L.ghost.innerHTML = ""; }
  status();
}
function fitView() {
  if (!S.parts.length) return;
  const xs = [], ys = [];
  S.parts.forEach((p) => { xs.push(p.x); ys.push(p.y); });
  S.wires.forEach((w) => { xs.push(w.a[0], w.b[0]); ys.push(w.a[1], w.b[1]); });
  const r = svg.getBoundingClientRect();
  const minx = Math.min(...xs) - 4, maxx = Math.max(...xs) + 4, miny = Math.min(...ys) - 4, maxy = Math.max(...ys) + 4;
  view.z = Math.max(0.4, Math.min(1.6, Math.min(r.width / ((maxx - minx) * G), r.height / ((maxy - miny) * G))));
  view.x = r.width / 2 - ((minx + maxx) / 2) * G * view.z;
  view.y = r.height / 2 - ((miny + maxy) / 2) * G * view.z;
  render();
}

/* ------------------------------------------------------------------ change tracking + running */
function changed(electrical = true, delay = 450, keepProps = false) {
  if (electrical) stale = true;
  render();
  if (!keepProps) showProps();
  save();
  if (electrical && hasRun && $("#autoRun").checked) {
    clearTimeout(runTimer);
    runTimer = setTimeout(run, delay);
  }
}
function save() { try { localStorage.setItem("se_circuit", JSON.stringify(S)); } catch (_) {} }

async function run() {
  clearTimeout(runTimer);
  if (job) { fetch("/api/cancel/" + job, { method: "POST" }).catch(() => {}); job = null; }
  nets = computeNets();
  const circuit = {
    parts: S.parts.map((p) => ({ id: p.id, type: p.type, nodes: nets.partNodes[p.id], props: p.props })),
    temp, duration: $("#duration").value ? +$("#duration").value : null, start: +$("#from").value || 0,
  };
  hasRun = true;
  const busy = $("#busy"), bt = $("#busyText");
  const showTimer = setTimeout(() => busy.classList.remove("hidden"), 250);
  bt.textContent = "Simulating…";
  let myJob;
  try {
    const r = await (await fetch("/api/simulate", { method: "POST", body: JSON.stringify(circuit) })).json();
    myJob = job = r.job;
    for (;;) {
      await new Promise((ok) => setTimeout(ok, 120));
      if (job !== myJob) return;           // a newer run replaced this one
      const s = await (await fetch("/api/job/" + myJob)).json();
      if (s.state === "done") { useResult(s.result, nets); break; }
      const hb = s.heartbeat || {};
      bt.textContent = `Simulating… ${hb.elapsed ?? 0} s` + (hb.cpu != null ? ` · engine busy (${hb.cpu} s CPU, ${hb.mem_mb} MB)` : " · engine running");
    }
  } catch (err) {
    showMessages([{ level: "error", text: "Lost contact with the Spicey Electrons window. Is it still open? (" + err + ")" }]);
  } finally {
    clearTimeout(showTimer);
    if (job === myJob) { job = null; busy.classList.add("hidden"); }
  }
}
function useResult(r, netsAtRun) {
  if (!r.ok) {
    result = null;
    showMessages([{ level: "error", text: r.error, details: r.details, netlist: r.netlist, part: r.part }]);
    if (r.part) { sel = { kind: "part", id: r.part }; showProps(); }
    render();
    return;
  }
  result = r; resultNets = netsAtRun; stale = false;
  cursor = 0; cursorF = 0; lastDraw = 0;
  setPlaying(true);
  const msgs = [];
  (r.notes || []).forEach((t) => msgs.push({ level: "note", text: t }));
  (r.warnings || []).forEach((w) => msgs.push(w));
  if (!S.probes.length) msgs.push({ level: "note", text: "Tip: pick 🔎 Probe and click a wire to see its voltage on the scope, or click a part to see the current through it." });
  msgs.push({ level: "note", text: `Done in ${r.seconds} s · showing ${fmt(r.duration, "s")} at ${r.temp} °C.`, netlist: r.netlist });
  showMessages(msgs);
  render();
}
function showMessages(list) {
  const box = $("#messages");
  box.innerHTML = "";
  for (const m of list) {
    const d = document.createElement("div");
    d.className = "msg " + (m.level || "note");
    d.textContent = (m.level === "burn" ? "🔥 " : m.level === "hot" ? "♨️ " : m.level === "error" ? "⚠️ " : "") + m.text;
    if (m.details || m.netlist) {
      const det = document.createElement("details");
      det.innerHTML = `<summary>For the curious: what the SPICE engine saw</summary>`;
      const pre = document.createElement("pre");
      pre.textContent = (m.netlist || "") + (m.details ? "\n----- engine says -----\n" + m.details : "");
      det.appendChild(pre);
      d.appendChild(det);
    }
    box.appendChild(d);
  }
}
function flash(t) { showMessages([{ level: "note", text: t }]); }

/* ------------------------------------------------------------------ scope */
const cv = $("#scope"), cx = cv.getContext("2d");
function probeTrace(q) {
  if (!result || !resultNets) return null;
  if (q.kind === "v") {
    const n = resultNets.pointNet(q.at);
    if (n === null) return null;
    const fr = result.freq && result.freq[n];
    if (q.hz && fr) return { data: fr.trace, unit: "Hz", label: `Frequency at ${q.letter}`, avg: fr.avg, canHz: true };
    return { data: result.voltages[n] || null, env: result.env && result.env["v:" + n], unit: "V", label: `Voltage at ${q.letter}`, canHz: !!fr };
  }
  return { data: result.currents[q.part] || null, env: result.env && result.env["i:" + q.part], unit: "A", label: `Current through ${q.part}` };
}
const tinySet = new Set();
let tinyHits = [];
function zoomToggle(q) {
  q.zoom = !q.zoom;
  if (q.zoom) S.probes.forEach((o) => { if (o !== q && probeTrace(o) && probeTrace(o).unit === probeTrace(q).unit) o.zoom = false; });
  save(); drawScope();
}
function smoothHz(d) {                              // frequency is measured once per wave, so it looks steppy: average neighbours
  const out = new Array(d.length), R = Math.max(2, Math.round(d.length / 80));
  for (let i = 0; i < d.length; i++) {
    if (d[i] === null) { out[i] = null; continue; }
    let s = 0, n = 0;
    for (let k = Math.max(0, i - R); k <= Math.min(d.length - 1, i + R); k++) if (d[k] !== null && isFinite(d[k])) { s += d[k]; n++; }
    out[i] = n ? s / n : d[i];
  }
  return out;
}
function drawScope() {
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth, h = cv.clientHeight;
  if (!w || !h) return;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  cx.setTransform(dpr, 0, 0, dpr, 0, 0);
  cx.clearRect(0, 0, w, h);
  const padL = 62, padR = 62, padT = 8, padB = 22, pw = w - padL - padR, ph = h - padT - padB;
  cx.strokeStyle = "#22304a"; cx.lineWidth = 1;
  for (let i = 0; i <= 10; i++) { const x = padL + (pw * i) / 10; cx.beginPath(); cx.moveTo(x, padT); cx.lineTo(x, padT + ph); cx.stroke(); }
  for (let i = 0; i <= 8; i++) { const y = padT + (ph * i) / 8; cx.beginPath(); cx.moveTo(padL, y); cx.lineTo(padL + pw, y); cx.stroke(); }
  const legend = $("#legend");
  if (!result) {
    cx.fillStyle = "#6f80a3"; cx.font = "14px system-ui"; cx.textAlign = "center";
    cx.fillText(hasRun ? "Fix the problem below, then press ▶ Run." : "Build a circuit (or pick 📚 Examples), then press ▶ Run.", padL + pw / 2, padT + ph / 2);
    legend.innerHTML = "";
    return;
  }
  const traces = S.probes.map((q) => ({ q, t: probeTrace(q) })).filter((x) => x.t && x.t.data);
  const range = (unit) => {
    let lo = Infinity, hi = -Infinity;
    const pool = traces.filter((x) => x.t.unit === unit), zs = pool.filter((x) => x.q.zoom);
    (zs.length ? zs : pool).forEach((x) => {
      const src = x.t.env ? [x.t.env[0], x.t.env[1]] : [x.t.data];
      src.forEach((arr) => arr.forEach((v) => { if (v !== null && isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }));
    });
    if (lo === Infinity) return null;
    if (unit === "Hz") {                           // frequency: zoom in on the wobble instead of starting from 0
      const mid = (lo + hi) / 2, span = Math.max(hi - lo, Math.abs(mid) * 0.004, 1) * 1.3;
      lo = mid - span / 2; hi = mid + span / 2;
      const rawS = (hi - lo) / 4, mg = 10 ** Math.floor(Math.log10(rawS)), nn = rawS / mg;
      const st = (nn <= 1 ? 1 : nn <= 2 ? 2 : nn <= 2.5 ? 2.5 : nn <= 5 ? 5 : 10) * mg;
      return [Math.floor(lo / st) * st, Math.ceil(hi / st) * st, st];
    }
    const tiny = zs.length ? (unit === "V" ? 1e-9 : 1e-12) : unit === "V" ? 0.05 : 5e-5;   // zoomed in: no minimum size
    if (hi - lo < tiny) { hi = Math.max(hi, 0) + tiny * 5; lo = Math.min(lo, 0); }
    if (lo > 0 || Math.abs(lo) < (hi - lo) * 0.02) lo = Math.min(0, lo > 0 ? 0 : lo);
    if (hi < 0 || Math.abs(hi) < (hi - lo) * 0.02) hi = Math.max(0, hi < 0 ? 0 : hi);
    if (Math.abs(lo) < (hi - lo) * 0.02) lo = 0;
    if (Math.abs(hi) < (hi - lo) * 0.02) hi = 0;
    const raw = (hi - lo) / 4, mag = 10 ** Math.floor(Math.log10(raw)), n = raw / mag;
    const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
    return [Math.floor(lo / step + 1e-9) * step, Math.ceil(hi / step - 1e-9) * step, step];
  };
  const rv = range("V"), ri = range("A"), rh = range("Hz");
  const t = result.time, t0 = result.start || 0, T = (t[t.length - 1] - t0) || 1;
  const X = (i) => padL + (pw * (t[i] - t0)) / T;
  cx.font = "11px system-ui";
  const axis = (r, side, unit, color) => {
    if (!r) return;
    cx.fillStyle = color; cx.textAlign = side === "L" ? "right" : "left";
    for (let v = r[0]; v <= r[1] + r[2] * 0.01; v += r[2]) {
      const y = padT + ph - (ph * (v - r[0])) / (r[1] - r[0]);
      cx.fillText(fmt(Math.abs(v) < r[2] * 1e-6 ? 0 : v, unit), side === "L" ? padL - 6 : padL + pw + 6, y + 4);
    }
    if (r[0] < 0 && r[1] > 0) {
      const y0 = padT + ph - (ph * (0 - r[0])) / (r[1] - r[0]);
      cx.strokeStyle = "#56688f"; cx.setLineDash([4, 4]); cx.beginPath(); cx.moveTo(padL, y0); cx.lineTo(padL + pw, y0); cx.stroke(); cx.setLineDash([]);
    }
  };
  axis(rv, "L", "V", "#c8d4ea");
  axis(rh || ri, "R", rh ? "Hz" : "A", "#9fe2ff");
  cx.fillStyle = "#8091b3"; cx.textAlign = "center";
  for (let i = 0; i <= 10; i += 2) cx.fillText(T < Math.abs(t0) * 0.01 ? (i ? "+" : "") + fmt((T * i) / 10, "s") + (i ? "" : " @ " + fmt(t0, "s")) : fmt(t0 + (T * i) / 10, "s"), padL + (pw * i) / 10, h - 6);   // tiny window far from 0: label the offset so every tick is different
  tinySet.clear(); tinyHits = [];
  cx.save(); cx.beginPath(); cx.rect(padL, padT, pw, ph); cx.clip();          // a zoomed-in trace must not spill over the axes
  for (const { q, t: tr } of traces) {
    const r = tr.unit === "V" ? rv : tr.unit === "Hz" ? rh : ri;
    cx.globalAlpha = traces.some((o) => o.q.zoom && o.t.unit === tr.unit) && !q.zoom ? 0.22 : 1;   // zoomed on another trace: this one is mostly off the scale
    const Y = (v) => padT + ph - (ph * (v - r[0])) / (r[1] - r[0]);
    // A trace far smaller than the scale would just look like a flat line at 0: draw it as a fat dashed line with its size written on it.
    if (tr.unit !== "Hz") {
      let lo = Infinity, hi = -Infinity, sum = 0, cnt = 0;
      for (const v of (tr.env ? tr.env[0].concat(tr.env[1]) : tr.data)) if (v !== null && isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); if (!tr.env) { sum += v; cnt++; } }
      const pp = hi - lo, span = r[1] - r[0], peak = Math.max(Math.abs(lo), Math.abs(hi));
      if (isFinite(pp) && peak > 0 && pp < span * 0.03 && peak < span * 0.5 + 1e-30 && !q.zoom && traces.some((o) => o !== undefined && o.t.unit === tr.unit && o.q !== q)) {
        tinySet.add(q);
        const mean = cnt ? sum / cnt : (lo + hi) / 2;
        const y = Y(mean), lbl = Math.abs(mean) <= pp * 3 ? fmt(peak, tr.unit) : `${fmt(mean, tr.unit)} ±${fmt(pp / 2, tr.unit)}`;
        cx.strokeStyle = q.color; cx.globalAlpha = 0.9; cx.lineWidth = 5; cx.lineCap = "butt"; cx.setLineDash([14, 8]);
        cx.beginPath(); cx.moveTo(padL, y); cx.lineTo(padL + pw, y); cx.stroke();
        cx.setLineDash([]); cx.globalAlpha = 1;
        cx.font = "bold 12px system-ui"; cx.fillStyle = q.color; cx.textAlign = "right";
        const ty = y > padT + 22 ? y - 9 : y + 20;
        const Pq = tracePeriod(q);
        const txt = `${q.letter}: ${lbl}${Pq ? " · " + fmt(1 / Pq, "Hz") : ""}   ← click to enlarge`;
        cx.font = "bold 13px system-ui";
        const tw = cx.measureText(txt).width;
        cx.fillStyle = "#0f1522ee"; cx.fillRect(padL + pw - 14 - tw, ty - 14, tw + 12, 20);
        cx.fillStyle = q.color; cx.fillText(txt, padL + pw - 8, ty);
        tinyHits.push({ q, y });
        cx.font = "11px system-ui";
        continue;
      }
    }
    if (tr.env) {                                   // too fast to draw: show the min/max band like a real scope
      cx.fillStyle = q.color + "55"; cx.beginPath();
      tr.env[1].forEach((v, i) => (i ? cx.lineTo(X(i), Y(v)) : cx.moveTo(X(i), Y(v))));
      for (let i = tr.env[0].length - 1; i >= 0; i--) cx.lineTo(X(i), Y(tr.env[0][i]));
      cx.closePath(); cx.fill();
    }
    cx.strokeStyle = q.color; cx.lineWidth = tr.env ? 1.2 : 2.2; cx.setLineDash(tr.unit === "A" ? [7, 3] : []);
    cx.beginPath();
    if (tr.env) {                                   // carrier too fast to draw: outline the band (the raw samples would just be random streaks)
      tr.env[1].forEach((v, i) => (i ? cx.lineTo(X(i), Y(v)) : cx.moveTo(X(i), Y(v))));
      tr.env[0].forEach((v, i) => (i ? cx.lineTo(X(i), Y(v)) : cx.moveTo(X(i), Y(v))));
    } else {
      let pen = false;
      const dd = tr.unit === "Hz" ? smoothHz(tr.data) : tr.data;
      dd.forEach((v, i) => { if (v === null) { pen = false; return; } if (pen) cx.lineTo(X(i), Y(v)); else cx.moveTo(X(i), Y(v)); pen = true; });
    }
    cx.stroke();
    cx.setLineDash([]); cx.globalAlpha = 1;
  }
  cx.restore();
  const ci = Math.min(cursor, t.length - 1), xc = X(ci);
  cx.strokeStyle = "#ffffffaa"; cx.lineWidth = 1; cx.beginPath(); cx.moveTo(xc, padT); cx.lineTo(xc, padT + ph); cx.stroke();
  // legend with values at cursor
  legend.innerHTML = "";
  S.probes.forEach((q, i) => {
    const tr = probeTrace(q);
    const chip = document.createElement("span");
    chip.className = "chip";
    let cur = tr && tr.data ? tr.data[ci] : null;
    if (tr && tr.unit === "Hz" && cur == null) { for (let d = 1; d < 400 && cur == null; d++) cur = tr.data[ci - d] ?? tr.data[ci + d] ?? null; }
    const now = cur === null || cur === undefined ? "-" : fmt(cur, tr.unit);
    let pk = "";
    if (tr && tr.data) { let m = 0; const src = tr.env ? tr.env[0].concat(tr.env[1]) : tr.data; for (const v of src) if (v !== null && Math.abs(v) > m) m = Math.abs(v); pk = fmt(m, tr.unit); }
    const Pq = tr && tr.unit !== "Hz" ? tracePeriod(q) : null;
    const extra = tr && tr.avg ? ` · avg ${fmt(tr.avg, "Hz")}` : (Pq ? ` · ${fmt(1 / Pq, "Hz")}` : "");
    chip.innerHTML = `<b style="background:${q.color}">${q.letter}</b>${tr ? tr.label : "?"}: <strong>${now}</strong> <span style="opacity:.6">(${(tr && tr.unit === "Hz" ? "" : "peak " + pk) + (tr && tr.unit === "Hz" ? extra.replace(" · ", "") : extra)})</span>${tr && (tinySet.has(q) || q.zoom) ? `<button class="zbtn" title="${q.zoom ? "Go back to the shared scale" : "Scale the graph to fit this small trace"}">${q.zoom ? "↩" : "🔍"}</button>` : ""}${tr && tr.canHz ? `<button class="hzbtn" title="Switch between voltage and frequency">${tr.unit === "Hz" ? "V" : "Hz"}</button>` : ""}<span class="x">✕</span>`;
    chip.title = "Click to remove this probe";
    chip.onclick = (e) => { if (e.target.classList.contains("zbtn")) zoomToggle(q); else if (e.target.classList.contains("hzbtn")) { q.hz = !q.hz; save(); drawScope(); } else removeProbe(i); };
    legend.appendChild(chip);
  });
  const tt = document.createElement("span");
  tt.className = "chip time";
  tt.style.paddingLeft = "9px";
  tt.textContent = `⏱ ${fmt(t[ci], "s")}${stale ? " · out of date - press ▶ Run" : ""}`;
  legend.appendChild(tt);
  const zb = $("#zoomBtn"), zoomed = S.probes.find((q) => q.zoom), tq = [...tinySet][0];
  zb.classList.toggle("ghost", !(zoomed || tq));
  if (zoomed) { zb.textContent = "↩ Back to shared scale"; zb.onclick = () => zoomToggle(zoomed); }
  else if (tq) { zb.textContent = "🔍 Enlarge small signal " + tq.letter; zb.onclick = () => zoomToggle(tq); }
}
let pendingZoom = null;
cv.addEventListener("pointerdown", (e) => {
  const rc = cv.getBoundingClientRect(), y = e.clientY - rc.top;
  const hit = tinyHits.find((h) => Math.abs(h.y - y) < 9 || (y > h.y - 28 && y < h.y - 2 && e.clientX - rc.left > rc.width * 0.5));
  cv.setPointerCapture(e.pointerId);
  // Over a small-signal line a quick tap enlarges it; dragging (even a little) scrubs the time cursor instead, so scrubbing never flips the scale by accident.
  if (hit) { pendingZoom = { q: hit.q, x: e.clientX, y: e.clientY }; cv.onpointermove = (ev) => { if (pendingZoom && Math.hypot(ev.clientX - pendingZoom.x, ev.clientY - pendingZoom.y) > 4) pendingZoom = null; if (!pendingZoom) scrub(ev); }; return; }
  scrub(e); cv.onpointermove = scrub;
});
cv.addEventListener("pointermove", (e) => {
  if (cv.onpointermove) return;
  const rc = cv.getBoundingClientRect(), y = e.clientY - rc.top;
  cv.style.cursor = tinyHits.some((h) => Math.abs(h.y - y) < 14) ? "zoom-in" : "ew-resize";
});
cv.addEventListener("pointerup", () => { cv.onpointermove = null; if (pendingZoom) { const q = pendingZoom.q; pendingZoom = null; zoomToggle(q); } });
function scrub(e) {
  if (!result) return;
  const r = cv.getBoundingClientRect(), pw = r.width - 124;
  const f = Math.max(0, Math.min(1, (e.clientX - r.left - 62) / pw));
  cursor = Math.round(f * (result.time.length - 1)); cursorF = cursor;
  setPlaying(false);
  render();
}
/* ---- playback: one "playhead" drives the scope cursor, the board's charge bars / LED glow and the current dots */
const SPEEDS = [0.1, 0.25, 0.5, 1, 2, 4, 10];
let speedIdx = 3, cursorF = 0, lastTick = 0, lastDraw = 0;
try { const raw = localStorage.getItem("se.speed"); if (raw !== null && +raw >= 0 && +raw <= 6) speedIdx = +raw; } catch (e) {}
function setPlaying(on) {
  playing = on ? true : null;
  $("#playBtn").textContent = on ? "⏸ Pause" : "▶ Play";
}
function speedUI() { $("#speed").value = speedIdx; $("#speedLbl").textContent = SPEEDS[speedIdx] + "×"; }
$("#speed").oninput = () => { speedIdx = +$("#speed").value; speedUI(); try { localStorage.setItem("se.speed", speedIdx); } catch (e) {} };
speedUI();
$("#playBtn").onclick = () => {
  if (playing) { setPlaying(false); return; }
  if (!result) return;
  if (cursor >= result.time.length - 1) { cursor = 0; cursorF = 0; }
  setPlaying(true);
};
function tick(now) {
  requestAnimationFrame(tick);
  const dt = Math.min(0.1, (now - (lastTick || now)) / 1000);
  lastTick = now;
  if (document.hidden || !result || stale) return;
  if (playing) {
    const n = result.time.length;
    cursorF = Math.max(cursorF, 0);
    cursorF += (n / 6) * SPEEDS[speedIdx] * dt;                                  // 1x = whole window in 6 s
    if (cursorF >= n - 1) {
      if ($("#loopPlay").checked) cursorF = 0; else { cursorF = n - 1; setPlaying(false); }
    }
    const ni = Math.floor(cursorF);
    if (ni !== cursor && now - lastDraw > 40) { cursor = ni; lastDraw = now; render(); }
  }
  if (flowItems.length) stepDots(dt);
}
requestAnimationFrame(tick);
/* ---- zoom to N repeating waves: finds the period, then re-runs the simulation over exactly N cycles ---- */
let waveMem = null, preWave = null;
const circuitKey = () => JSON.stringify(S.parts) + temp;
function wavePeriod() {
  const P = wavePeriod0();
  if (P) waveMem = { P, key: circuitKey() };
  else if (waveMem && waveMem.key === circuitKey()) return waveMem.P;       // already zoomed in: remember what it was
  return P;
}
function tracePeriod(q) {
  if (!result || !resultNets) return null;
  if (q.kind === "v") {                                              // 1) engine's own frequency count (works even when too fast to draw)
    const n = resultNets.pointNet(q.at), fr = n !== null && result.freq && result.freq[n];
    if (fr && fr.avg > 0) return 1 / fr.avg;
  }
  const tr = probeTrace(q);                                           // 2) rising crossings of the middle level (works for tiny signals too)
  if (!tr || !tr.data || tr.unit === "Hz") return null;
  const t = result.time, d = tr.data, h = Math.floor(d.length / 3);
  let lo = Infinity, hi = -Infinity, sum = 0, cnt = 0;
  for (let i = h; i < d.length; i++) if (d[i] !== null) { lo = Math.min(lo, d[i]); hi = Math.max(hi, d[i]); sum += d[i]; cnt++; }
  if (!(hi - lo > (tr.unit === "V" ? 1e-7 : 1e-10))) return null;
  const mid = sum / cnt, hy = (hi - lo) * 0.1, ups = [];
  let low = d[h] < mid;
  for (let i = h + 1; i < d.length; i++) {
    if (d[i] === null) continue;
    if (low && d[i] > mid + hy) { ups.push(t[i]); low = false; } else if (!low && d[i] < mid - hy) low = true;
  }
  if (ups.length < 3) return null;
  const gaps = ups.slice(1).map((x, i) => x - ups[i]).sort((x, y) => x - y);
  return gaps[Math.floor(gaps.length / 2)];
}
function wavePeriod0() {
  for (const q of S.probes) { const P = tracePeriod(q); if (P) return P; }
  return null;
}
function setSel(sel, v, label) {                                      // choose a value even if the drop-down doesn't list it
  let o = [...sel.options].find((x) => +x.value === +v && x.value !== "");
  if (!o) { o = document.createElement("option"); o.value = String(v); o.className = "custom"; o.textContent = label; sel.appendChild(o); }
  sel.value = o.value;
}
function markWaves(w) { document.querySelectorAll("#waveSeg button").forEach((b) => b.classList.toggle("on", w !== null && +b.dataset.w === w)); }
const HF_PERIOD = 1e-6, HF_MAX_WAVES = 30;          // faster than 1 MHz: never draw more than 30 waves (keeps old PCs light)
document.querySelectorAll("#waveSeg button").forEach((b) => (b.onclick = () => {
  let w = +b.dataset.w;
  if (!hasRun || !result) { flash("Run the circuit first, then pick how many waves to look at."); return; }
  const P = wavePeriod();
  const hf = P && P < HF_PERIOD;
  if (hf && (w === 0 || w > HF_MAX_WAVES)) {                          // high frequency: 'max' and 50 mean 30
    w = HF_MAX_WAVES;
    flash(`This circuit wobbles faster than 1 MHz, so I show at most ${HF_MAX_WAVES} waves. That keeps it quick on older computers.`);
  }
  if (w === 0) {                                                      // max: back to the slice we started from
    const pw = preWave || { d: "", f: "0" };
    $("#duration").value = pw.d; $("#from").value = pw.f; preWave = null; markWaves(0); run(); return;
  }
  if (!P) { flash("I can't see a repeating wave on the scope yet. Add a probe on something that wobbles, or run a longer slice."); return; }
  const end = result.time[result.time.length - 1], dur = +(P * w).toPrecision(3);
  if (!preWave) preWave = { d: $("#duration").value, f: $("#from").value };
  const from = dur >= end * 0.999 ? 0 : Math.max(0, +(end - dur).toPrecision(3));   // too many for the run so far: run longer from the start
  setSel($("#duration"), dur, fmt(dur, "s")); setSel($("#from"), from, fmt(from, "s"));
  markWaves(+b.dataset.w); run();
}));
["#duration", "#from"].forEach((id) => $(id).addEventListener("change", () => { markWaves(null); preWave = null; }));

/* ---- resizable scope ---- */
(function () {
  const main = document.querySelector("main"), grip = $("#scopeGrip");
  const setH = (px) => {
    const max = Math.round(window.innerHeight * 0.75);
    px = Math.max(110, Math.min(max, Math.round(px)));
    main.style.setProperty("--scopeH", px + "px");
    try { localStorage.setItem("se.scopeH", px); } catch (e) {}
    drawScope(); if (typeof fitView === "function" && false) fitView();
  };
  try { const v = +localStorage.getItem("se.scopeH"); if (v) main.style.setProperty("--scopeH", Math.max(110, Math.min(Math.round(window.innerHeight * 0.75), v)) + "px"); } catch (e) {}
  let drag = null;
  grip.addEventListener("pointerdown", (e) => { grip.setPointerCapture(e.pointerId); drag = { y: e.clientY, h: $("#scopeWrap").getBoundingClientRect().height }; e.preventDefault(); });
  grip.addEventListener("pointermove", (e) => { if (drag) setH(drag.h + (drag.y - e.clientY)); });
  grip.addEventListener("pointerup", () => (drag = null));
  grip.addEventListener("dblclick", () => setH(290));
})();
window.addEventListener("resize", () => drawScope());
new ResizeObserver(() => drawScope()).observe($("#scopeBox"));

function fmt(x, unit) {
  if (x === null || x === undefined || !isFinite(x)) return "-";
  const a = Math.abs(x);
  if (a < 1e-12) return "0 " + unit;
  const S2 = [[1e9, "G"], [1e6, "M"], [1e3, "k"], [1, ""], [1e-3, "m"], [1e-6, "µ"], [1e-9, "n"], [1e-12, "p"]];
  for (const [m, s] of S2) if (a >= m * 0.9995) return `${+(x / m).toPrecision(3)} ${s}${unit}`;
  return `${x.toPrecision(3)} ${unit}`;
}

/* ------------------------------------------------------------------ examples */
const EXAMPLES = {
  "LED + resistor": {
    parts: [["battery", 0, 0, 1, { voltage: "9" }], ["resistor", 4, -4, 0, { value: "470" }], ["led", 8, 0, 1, { color: "red" }], ["ground", 0, 4, 0]],
    wires: [[[0, -2], [0, -4]], [[0, -4], [2, -4]], [[6, -4], [8, -4]], [[8, -4], [8, -2]], [[8, 2], [8, 4]], [[8, 4], [0, 4]], [[0, 2], [0, 4]]],
    probes: [{ kind: "i", part: "LED1" }, { kind: "v", at: [8, -4] }],
    say: "A battery, a resistor and an LED. Try changing the resistor to 10 Ω and watch what happens!" },
  "Capacitor charging": {
    parts: [["battery", 0, 0, 1, { voltage: "9" }], ["switch", 4, -4, 0, { closed: true }], ["resistor", 9, -4, 0, { value: "1k" }], ["capacitor", 13, 0, 1, { value: "100u" }], ["ground", 0, 4, 0]],
    wires: [[[0, -2], [0, -4]], [[0, -4], [2, -4]], [[6, -4], [7, -4]], [[11, -4], [13, -4]], [[13, -4], [13, -2]], [[13, 2], [13, 4]], [[13, 4], [0, 4]], [[0, 2], [0, 4]]],
    probes: [{ kind: "v", at: [13, -4] }, { kind: "i", part: "C1" }],
    say: "The capacitor fills up in a curve. After 1 'time constant' (1 kΩ × 100 µF = 0.1 s) it's 63% full." },
  "Transistor switch": {
    parts: [["battery", 0, 0, 1, { voltage: "9" }], ["led", 14, -2, 1, { color: "green" }], ["resistor", 14, 2, 1, { value: "470" }], ["npn", 13, 8, 0],
            ["resistor", 8, 8, 0, { value: "10k" }], ["switch", 4, 2, 1, { closed: true }], ["ground", 0, 12, 0]],
    wires: [[[0, -2], [0, -6]], [[0, -6], [14, -6]], [[14, -6], [14, -4]], [[14, 4], [14, 6]], [[14, 10], [14, 12]], [[14, 12], [0, 12]], [[0, 12], [0, 2]],
            [[10, 8], [11, 8]], [[4, 0], [4, -6]], [[4, 4], [4, 8]], [[4, 8], [6, 8]]],
    probes: [{ kind: "i", part: "R2" }, { kind: "i", part: "Q1" }],
    say: "A tiny base current (through 10 kΩ) switches a much bigger LED current. Click the switch to flip it!" },
  "Op-amp amplifier (×10)": {
    parts: [["sine", 0, 0, 1, { amplitude: "0.5", frequency: "1k" }], ["resistor", 6, -3, 0, { value: "1k" }], ["opamp", 12, -2, 0], ["resistor", 12, -7, 0, { value: "10k" }],
            ["resistor", 16, 0, 1, { value: "10k" }], ["ground", 0, 2, 0]],
    wires: [[[0, -2], [0, -3]], [[0, -3], [4, -3]], [[8, -3], [10, -3]], [[9, -3], [9, -7]], [[9, -7], [10, -7]], [[14, -7], [14, -2]], [[14, -2], [16, -2]],
            [[10, -1], [10, 2]], [[10, 2], [0, 2]], [[16, 2], [10, 2]]],
    probes: [{ kind: "v", at: [0, -2] }, { kind: "v", at: [14, -2] }],
    say: "Input A is 0.5 V; output B is 10 times bigger and upside down (10 kΩ ÷ 1 kΩ = 10). Try a 2 V input: it hits the ±12 V ceiling!" },
  "Rounding a square wave": {
    parts: [["square", 0, 0, 1, { high: "5", low: "0", frequency: "1k" }], ["resistor", 4, -4, 0, { value: "1k" }], ["capacitor", 8, 0, 1, { value: "100n" }], ["ground", 0, 4, 0]],
    wires: [[[0, -2], [0, -4]], [[0, -4], [2, -4]], [[6, -4], [8, -4]], [[8, -4], [8, -2]], [[8, 2], [8, 4]], [[8, 4], [0, 4]], [[0, 2], [0, 4]]],
    probes: [{ kind: "v", at: [0, -2] }, { kind: "v", at: [8, -4] }],
    say: "A resistor and capacitor smooth the sharp edges off a square wave. Try 10 µF to smooth it even more." },
  "Rectifier (AC to DC)": {
    parts: [["sine", 0, 0, 1, { amplitude: "10", frequency: "50" }], ["diode", 4, -2, 0, { model: "1N4007" }], ["capacitor", 8, 0, 1, { value: "470u" }], ["resistor", 12, 0, 1, { value: "1k" }], ["ground", 0, 2, 0]],
    wires: [[[0, -2], [2, -2]], [[6, -2], [8, -2]], [[8, -2], [12, -2]], [[12, 2], [8, 2]], [[8, 2], [0, 2]]],
    probes: [{ kind: "v", at: [0, -2] }, { kind: "v", at: [8, -2] }],
    say: "The diode only lets the top half of the 50 Hz wave through, and the capacitor fills in the gaps. Delete C1 to see the bumpy version." },
  "Ringing coil + capacitor (RLC)": {
    parts: [["square", 0, 0, 1, { high: "5", low: "0", frequency: "1k" }], ["resistor", 4, -4, 0, { value: "10" }], ["inductor", 9, -4, 0, { value: "1m" }], ["capacitor", 13, 0, 1, { value: "100n" }], ["ground", 0, 4, 0]],
    wires: [[[0, -2], [0, -4]], [[0, -4], [2, -4]], [[6, -4], [7, -4]], [[11, -4], [13, -4]], [[13, -4], [13, -2]], [[13, 2], [13, 4]], [[13, 4], [0, 4]], [[0, 2], [0, 4]]],
    probes: [{ kind: "v", at: [0, -2] }, { kind: "v", at: [13, -4] }],
    show: "1e-3",
    say: "A coil and a capacitor swap energy back and forth, so the voltage overshoots and rings like a bell. It rings at 1/(2π√LC) = 15.9 kHz. Try a bigger resistor to damp it out." },
  "Transformer power supply": {
    parts: [["sine", 0, 0, 1, { amplitude: "20", frequency: "50" }], ["transformer", 6, 0, 0, { ratio: "0.5", inductance: "1", coupling: "0.999" }], ["diode", 11, -1, 0, { model: "1N4007" }],
            ["capacitor", 15, 1, 1, { value: "470u" }], ["resistor", 19, 1, 1, { value: "470" }], ["ground", 0, 4, 0]],
    wires: [[[0, -2], [2, -2]], [[2, -2], [2, -1]], [[2, -1], [4, -1]], [[4, 1], [4, 4]], [[0, 2], [0, 4]], [[19, 4], [0, 4]], [[8, 1], [8, 4]],
            [[8, -1], [9, -1]], [[13, -1], [19, -1]], [[15, 3], [15, 4]], [[19, 3], [19, 4]]],
    probes: [{ kind: "v", at: [0, -2] }, { kind: "v", at: [8, -1] }, { kind: "v", at: [17, -1] }],
    show: "0.1",
    say: "A transformer steps 20 V down to 10 V (ratio 0.5). The diode and capacitor turn it into DC, just like a phone charger. It only works because the power is changing - try a battery instead and the output goes dead." },
  "Joule thief (1.5 V lights an LED)": {
    parts: [["battery", 0, 0, 1, { voltage: "1.5" }], ["transformer", 8, -2, 0, { ratio: "1", inductance: "10u", coupling: "0.99" }], ["npn", 16, 2, 0],
            ["resistor", 14, -4, 1, { value: "1k" }], ["led", 3, -3, 3, { color: "red" }], ["ground", 0, 4, 0]],
    wires: [[[0, -2], [0, -6]], [[0, -6], [14, -6]], [[0, 2], [0, 4]], [[0, 4], [17, 4]], [[6, -3], [6, -6]], [[6, -1], [6, 0]], [[3, 0], [17, 0]],
            [[3, -5], [3, -6]], [[3, -1], [3, 0]], [[10, -3], [12, -3]], [[12, -3], [12, 2]], [[12, 2], [14, 2]], [[10, -1], [14, -1]], [[14, -2], [14, -1]]],
    probes: [{ kind: "v", at: [17, 0] }, { kind: "i", part: "LED1" }],
    from: "1e-5", show: "4e-5",
    say: "One transistor and a coil make a tiny oscillator that boosts 1.5 V up past the LED's 1.8 V - the battery is too weak to light it on its own! Press Probe, then click the collector wire." },
  "FM bug (one transistor radio transmitter)": {
    parts: [["battery", 0, 0, 1, { voltage: "9" }], ["resistor", 6, -4, 1, { value: "33k" }], ["resistor", 6, 3, 1, { value: "10k" }], ["npn", 11, 0, 0, { model: "2N2222" }],
            ["capacitor", 8, 3, 1, { value: "100p" }], ["resistor", 12, 4, 1, { value: "470" }], ["capacitor", 15, 0, 1, { value: "5p" }], ["inductor", 12, -5, 1, { value: "0.2u" }],
            ["capacitor", 15, -5, 1, { value: "10p" }], ["capacitor", 19, -1, 1, { value: "10n" }], ["sine", -6, 0, 1, { amplitude: "0.2", frequency: "20k" }],
            ["resistor", -4, -4, 0, { value: "4.7k" }], ["capacitor", 3, -4, 0, { value: "100n" }], ["ground", 0, 6, 0]],
    wires: [[[0, -2], [0, -8]], [[0, -8], [19, -8]], [[0, 2], [0, 6]], [[-6, 6], [19, 6]], [[-6, 2], [-6, 6]], [[6, -6], [6, -8]], [[6, -2], [6, 1]], [[6, 0], [9, 0]], [[8, 0], [8, 1]], [[8, 5], [8, 6]], [[6, 5], [6, 6]],
            [[12, -2], [15, -2]], [[12, 2], [15, 2]], [[12, -7], [12, -8]], [[12, -3], [12, -2]], [[15, -7], [15, -8]], [[15, -3], [15, -2]], [[19, -3], [19, -8]], [[19, 1], [19, 6]],
            [[-6, -2], [-6, -4]], [[-2, -4], [1, -4]], [[5, -4], [5, -2]], [[5, -2], [6, -2]]],
    probes: [{ kind: "v", at: [12, -2] }, { kind: "v", at: [12, -2], hz: true }, { kind: "v", at: [-6, -4] }],
    from: "1e-5", show: "1e-4",
    say: "A single-transistor oscillator at about 90 MHz (right in the FM radio band). The 20 kHz 'voice' wiggles the transistor's bias, which wobbles the frequency - that wobble IS frequency modulation. The cyan line (probe B) is the frequency, zoomed in so you can see it swing - the Hz button on a probe switches it between volts and frequency. It takes a few seconds: 95 million wiggles a second is a lot of maths." },
  "555 LED flasher (astable)": {
    parts: [["battery", 0, 0, 1, {"voltage": "9"}], ["555", 10, 0, 0], ["resistor", 16, -4, 1, {"value": "1k"}], ["resistor", 16, 3, 1, {"value": "47k"}], ["capacitor", 4, 6, 1, {"value": "10u"}], ["resistor", 19, 1, 1, {"value": "470"}], ["led", 19, 5, 1, {"color": "red"}], ["ground", 0, 8, 0]],
    wires: [[[0,-2],[0,-8]],[[0,-8],[20,-8]],[[0,2],[0,8]],[[0,8],[20,8]],[[10,-3],[10,-8]],[[10,3],[10,8]],[[16,-6],[16,-8]],[[16,-2],[16,1]],[[13,1],[16,1]],[[16,5],[7,5]],[[7,5],[4,5]],[[7,5],[7,1]],[[7,1],[7,-1]],[[4,4],[4,5]],[[13,-1],[19,-1]],[[19,7],[19,8]]],
    probes: [{"kind": "v", "at": [13, -1]}, {"kind": "v", "at": [7, 5]}, {"kind": "i", "part": "LED1"}],
    show: "5",
    say: "The 555 charges the capacitor through R1 + R2 until it hits 2/3 of the supply (6 V), then discharges it through R2 until it hits 1/3 (3 V), over and over. Watch B go up and down between 3 V and 6 V while the output A flips. Rate = 1.44 \u00f7 ((R1 + 2\u00d7R2) \u00d7 C) \u2248 1.5 times a second. Try 100 \u00b5F for a slower blink!" },
  "555 one-shot timer (monostable)": {
    parts: [["battery", 0, 0, 1, {"voltage": "9"}], ["square", -5, 0, 1, {"high": "9", "low": "0", "frequency": "0.5", "duty": "90"}], ["555", 10, 0, 0], ["resistor", 16, -4, 1, {"value": "100k"}], ["capacitor", 19, 3, 1, {"value": "10u"}], ["resistor", 22, 1, 1, {"value": "470"}], ["led", 22, 5, 1, {"color": "green"}], ["ground", 0, 8, 0]],
    wires: [[[0,-2],[0,-8]],[[0,-8],[19,-8]],[[0,2],[0,8]],[[-5,8],[22,8]],[[-5,2],[-5,8]],[[-5,-2],[-5,-4]],[[-5,-4],[2,-4]],[[2,-4],[2,1]],[[2,1],[7,1]],[[10,-3],[10,-8]],[[10,3],[10,8]],[[16,-6],[16,-8]],[[16,-2],[16,1]],[[13,1],[16,1]],[[16,1],[19,1]],[[19,5],[19,8]],[[7,-1],[5,-1]],[[5,-1],[5,-7]],[[5,-7],[18,-7]],[[18,-7],[18,1]],[[13,-1],[22,-1]],[[22,7],[22,8]]],
    probes: [{"kind": "v", "at": [4, 1]}, {"kind": "v", "at": [13, -1]}, {"kind": "v", "at": [18, 1]}],
    show: "5",
    say: "A short dip on the trigger (A) starts the timer: the output (B) goes high for exactly 1.1 \u00d7 R \u00d7 C = 1.1 seconds, however long or short the dip was. The capacitor (C) charges up to 6 V and the 555 then switches off. This is how a 'press for 1 second' timer works." },
  "Two-transistor LED flasher": {
    parts: [["battery", 0, -2, 1, {"voltage": "9"}], ["resistor", 7, -9, 1, {"value": "330"}], ["led", 7, -4, 1, {"color": "red"}], ["npn", 6, 2, 0], ["resistor", 4, -4, 1, {"value": "47k"}], ["capacitor", 11, 0, 0, {"value": "10u"}], ["npn", 18, 2, 0], ["resistor", 19, -9, 1, {"value": "330"}], ["led", 19, -4, 1, {"color": "green"}], ["resistor", 16, -4, 1, {"value": "56k"}], ["capacitor", 11, 6, 0, {"value": "10u"}], ["ground", 0, 8, 0]],
    wires: [[[0,-4],[0,-12]],[[0,-12],[19,-12]],[[0,0],[0,8]],[[0,8],[19,8]],[[7,-11],[7,-12]],[[7,-7],[7,-6]],[[7,-2],[7,0]],[[4,-6],[4,-12]],[[4,-2],[4,2]],[[7,4],[7,8]],[[7,0],[9,0]],[[13,0],[13,2]],[[13,2],[16,2]],[[16,-6],[16,-12]],[[16,-2],[16,2]],[[19,-11],[19,-12]],[[19,-7],[19,-6]],[[19,-2],[19,0]],[[19,4],[19,8]],[[19,0],[21,0]],[[21,0],[21,6]],[[21,6],[13,6]],[[9,6],[2,6]],[[2,6],[2,2]],[[2,2],[4,2]]],
    probes: [{"kind": "v", "at": [7, 0]}, {"kind": "v", "at": [19, 0]}],
    show: "5",
    say: "The classic first oscillator. Each transistor switches the other one off through a capacitor, so the two LEDs take turns. Neither can stay on: that's why it flashes. The two sides are made slightly different (47 k and 56 k) so it always starts. A longer blink needs bigger capacitors." },
  "Common-emitter amplifier": {
    parts: [["battery", -10, 0, 1, {"voltage": "9"}], ["sine", -4, 4, 1, {"amplitude": "0.005", "frequency": "1k"}], ["capacitor", 3, 2, 0, {"value": "10u"}], ["resistor", 7, -5, 1, {"value": "33k"}], ["resistor", 7, 6, 1, {"value": "10k"}], ["resistor", 13, -5, 1, {"value": "2.2k"}], ["resistor", 13, 7, 1, {"value": "470"}], ["npn", 12, 2, 0], ["capacitor", 16, 7, 1, {"value": "47u"}], ["ground", -10, 10, 0]],
    wires: [[[-10,-2],[-10,-10]],[[-10,-10],[13,-10]],[[-10,2],[-10,10]],[[-10,10],[16,10]],[[-4,6],[-4,10]],[[-4,2],[1,2]],[[5,2],[7,2]],[[7,-7],[7,-10]],[[7,-3],[7,2]],[[7,2],[7,4]],[[7,8],[7,10]],[[7,2],[10,2]],[[13,-7],[13,-10]],[[13,-3],[13,0]],[[13,4],[13,5]],[[13,9],[13,10]],[[13,5],[16,5]],[[16,9],[16,10]],[[13,0],[19,0]]],
    probes: [{"kind": "v", "at": [-4, 2]}, {"kind": "v", "at": [16, 0]}],
    show: "1e-2", from: "0.1",
    say: "A tiny 5 mV signal in (A) comes out about 140 times bigger and upside down (B). A is so small it looks like a flat line at 0 V on this scale - that is the point! The two resistors on the left (33 k and 10 k) hold the transistor half-on, the big capacitor lets the signal past the 470 \u03a9 so the gain stays high. Remove C2 and the gain drops to about 5." },
  "MOSFET Miller plateau": {
    parts: [["battery", 0, 0, 1, {"voltage": "12"}], ["resistor", 11, -4, 1, {"value": "470"}], ["resistor", 5, 4, 0, {"value": "22k"}], ["nmos", 10, 2, 0, {"cgs": "60p", "cgd": "30p"}], ["square", -3, 6, 1, {"high": "10", "low": "0", "frequency": "20k", "duty": "50"}], ["ground", 0, 8, 0]],
    wires: [[[0,-2],[0,-8]],[[0,-8],[14,-8]],[[0,2],[0,8]],[[-3,8],[11,8]],[[-3,4],[3,4]],[[7,4],[8,4]],[[8,4],[8,2]],[[11,-6],[11,-8]],[[11,-2],[11,0]],[[11,4],[11,8]]],
    probes: [{"kind": "v", "at": [8, 2]}, {"kind": "v", "at": [11, 0]}, {"kind": "i", "part": "R2"}],
    show: "4e-5",
    say: "Watch the gate (A) when it switches off, around 26 µs: it falls, then STALLS on a flat 'plateau' near 2.8 V while the drain (B) climbs from 0 V to 12 V (the same happens, shorter, at turn-on). All the gate current (C) is busy charging the drain-to-gate 'Miller' capacitance instead of raising the gate. (This example uses power-MOSFET sized capacitances, 60 pF and 30 pF, to make it easy to see.) Click the MOSFET and set the gate-drain capacitance to 0: the plateau vanishes. A bigger gate resistor means a slower rise, a longer plateau and hotter switching." },
  "MOSFET false turn-on (Miller kick)": {
    parts: [["square", 0, 0, 1, {"high": "12", "low": "0", "frequency": "1M", "duty": "50"}], ["resistor", 4, -4, 0, {"value": "100"}], ["resistor", 8, 5, 1, {"value": "10k"}], ["nmos", 10, 2, 0], ["ground", 0, 8, 0]],
    wires: [[[0,-2],[0,-4]],[[0,-4],[2,-4]],[[6,-4],[11,-4]],[[11,-4],[11,0]],[[0,2],[0,8]],[[0,8],[11,8]],[[8,2],[8,3]],[[8,7],[8,8]],[[11,4],[11,8]]],
    probes: [{"kind": "v", "at": [8, 2]}, {"kind": "i", "part": "R1"}, {"kind": "v", "at": [11, 0]}],
    show: "5e-6",
    say: "The gate is held at 0 V by a 10 k\u03a9 resistor, so this MOSFET should stay OFF. But the drain jumps 12 V in 1 ns, and the tiny drain-gate capacitance (4 pF) passes that jump to the gate. The gate kicks up to about 2.4 V (A), past the 2.1 V threshold, so the MOSFET briefly turns ON and a current spike (B) flows. This 'Miller turn-on' wrecks real power supplies. Fix: change the 10 k\u03a9 gate resistor to 100 \u03a9 - the kick shrinks away." },
  "Logic gates: half adder": {
    parts: [["square", 0, -6, 1, {"high": "5", "low": "0", "frequency": "500", "duty": "50"}], ["square", 0, 4, 1, {"high": "5", "low": "0", "frequency": "1k", "duty": "50"}], ["xor", 10, -2, 0], ["and", 10, 6, 0], ["resistor", 15, 0, 1, {"value": "10k"}], ["resistor", 15, 8, 1, {"value": "10k"}], ["ground", -3, -4, 0], ["ground", -3, 6, 0], ["ground", 15, 4, 0], ["ground", 15, 12, 0]],
    wires: [[[0,-4],[-3,-4]],[[0,6],[-3,6]],[[0,-8],[6,-8]],[[6,-8],[6,-3]],[[6,-3],[8,-3]],[[6,-3],[6,5]],[[6,5],[8,5]],[[0,2],[4,2]],[[4,2],[4,-1]],[[4,-1],[8,-1]],[[4,2],[4,7]],[[4,7],[8,7]],[[12,-2],[15,-2]],[[15,2],[15,4]],[[12,6],[15,6]],[[15,10],[15,12]]],
    probes: [{"kind": "v", "at": [0, -8]}, {"kind": "v", "at": [0, 2]}, {"kind": "v", "at": [12, -2]}, {"kind": "v", "at": [12, 6]}],
    show: "1e-2",
    say: "Adding two one-bit numbers: A and B are the inputs. XOR (C) is the 'sum' digit: high when exactly one input is high. AND (D) is the 'carry': high only when both are. 1 + 1 = 10 in binary, so the sum is 0 and the carry is 1. Chain these together and you have a calculator!" },
  "Ring oscillator (3 NOT gates)": {
    parts: [["not", 0, 0, 0], ["not", 6, 0, 0], ["not", 12, 0, 0]],
    wires: [[[2, 0], [4, 0]], [[8, 0], [10, 0]], [[14, 0], [16, 0]], [[16, 0], [16, 4]], [[16, 4], [-4, 4]], [[-4, 4], [-4, 0]], [[-4, 0], [-2, 0]]],
    probes: [{ kind: "v", at: [2, 0] }, { kind: "v", at: [8, 0] }, { kind: "v", at: [14, 0] }],
    show: "1e-6",
    say: "Each NOT gate flips its input, and three flips in a loop can never agree, so the signal chases itself round the ring forever. How fast depends on how long each gate takes to react (about 10 ns here), giving about 30 MHz. Try 5 gates: it slows down. With 2 or 4 gates it just gets stuck - try it!" },
  "Voltage divider (two resistors share the battery)": {
    parts: [["battery", 0, 0, 1, {"voltage": "9"}],["resistor", 6, -3, 1, {"value": "1k"}],["resistor", 6, 3, 1, {"value": "2k"}],["ground", 0, 8, 0]],
    wires: [[[0, -2], [0, -6]],[[0, -6], [6, -6]],[[6, -6], [6, -5]],[[6, -1], [6, 1]],[[6, 5], [6, 8]],[[6, 8], [0, 8]],[[0, 2], [0, 8]]],
    probes: [{"kind": "v", "at": [6, 0]}, {"kind": "v", "at": [0, -4]}],
    say: "Two resistors in a row share the voltage in proportion to their size: 1 kΩ and 2 kΩ split 9 V into 3 V and 6 V. A is the middle point. Change R2 to 1 kΩ and A drops to 4.5 V - the bigger resistor always takes the bigger share." },
  "Ohm's law (volts, amps and ohms)": {
    parts: [["battery", 0, 0, 1, {"voltage": "9"}],["resistor", 8, -6, 0, {"value": "1k"}],["ground", 0, 6, 0]],
    wires: [[[0, -2], [0, -6]],[[0, -6], [6, -6]],[[10, -6], [14, -6]],[[14, -6], [14, 6]],[[14, 6], [0, 6]],[[0, 2], [0, 6]]],
    probes: [{"kind": "v", "at": [2, -6]}, {"kind": "i", "part": "R1"}],
    say: "Ohm's law: volts = amps × ohms. Here 9 V across 1 kΩ pushes 9 mA (9 ÷ 1000 = 0.009 A). Change R1 to 3 kΩ and the current drops to 3 mA; change the battery to 3 V and it drops to 3 mA too." },
  "Kirchhoff's loop (the voltages add up to the battery)": {
    parts: [["battery", 0, 0, 1, {"voltage": "12"}],["resistor", 6, -6, 0, {"value": "1k"}],["resistor", 12, -6, 0, {"value": "2k"}],["resistor", 18, -6, 0, {"value": "3k"}],["ground", 0, 6, 0]],
    wires: [[[0, -2], [0, -6]],[[0, -6], [4, -6]],[[8, -6], [10, -6]],[[14, -6], [16, -6]],[[20, -6], [20, 6]],[[20, 6], [0, 6]],[[0, 2], [0, 6]]],
    probes: [{"kind": "v", "at": [2, -6]}, {"kind": "v", "at": [9, -6]}, {"kind": "v", "at": [15, -6]}],
    say: "Kirchhoff's voltage law: go once round a loop and the ups and downs cancel out. The battery lifts 12 V (A). R1 drops 2 V (B is 10 V), R2 drops 4 V (C is 6 V) and R3 drops the last 6 V down to ground. 2 + 4 + 6 = 12. The same 2 mA flows through all three." },
  "Current divider (parallel resistors share the flow)": {
    parts: [["battery", 0, 0, 1, {"voltage": "9"}],["resistor", 6, 0, 1, {"value": "1k"}],["resistor", 12, 0, 1, {"value": "2k"}],["ground", 0, 8, 0]],
    wires: [[[0, -2], [0, -6]],[[0, -6], [12, -6]],[[6, -6], [6, -2]],[[12, -6], [12, -2]],[[0, 2], [0, 8]],[[0, 8], [12, 8]],[[6, 2], [6, 8]],[[12, 2], [12, 8]]],
    probes: [{"kind": "i", "part": "R1"}, {"kind": "i", "part": "R2"}, {"kind": "i", "part": "B1"}],
    say: "Kirchhoff's current law: what flows into a junction must flow out. The battery's current splits between the two paths, and the easier path (the smaller resistor) takes more. R1 (1 kΩ) takes 9 mA, R2 (2 kΩ) takes 4.5 mA, and the battery supplies the total, 13.5 mA. Watch the dots split at the top and join again at the bottom." },
  "Zener regulator (a fixed voltage from a wobbly one)": {
    parts: [["battery", 0, 0, 1, {"voltage": "12"}],["resistor", 6, -6, 0, {"value": "470"}],["zener", 11, 0, 3, {"vz": "5.1"}],["resistor", 16, 0, 1, {"value": "1k"}],["ground", 0, 6, 0]],
    wires: [[[0, -2], [0, -6]],[[0, -6], [4, -6]],[[8, -6], [16, -6]],[[16, -6], [16, -2]],[[11, -6], [11, -2]],[[11, 2], [11, 6]],[[16, 2], [16, 6]],[[0, 2], [0, 6]],[[0, 6], [16, 6]]],
    probes: [{"kind": "v", "at": [13, -6]}, {"kind": "i", "part": "DZ1"}],
    say: "The Zener diode is wired backwards on purpose. Once the voltage across it reaches 5.1 V it refuses to go higher, so the load (R2) gets a steady 5.1 V even though the battery is 12 V. Change the battery to 9 V or 15 V and A hardly moves!" },
  "Light bulb surge (cold wire gulps current)": {
    parts: [["battery", 0, 0, 1, {"voltage": "6"}],["switch", 4, -5, 0, {"closed": true}],["lamp", 10, 0, 1, {"volts": "6", "amps": "0.1"}],["ground", 0, 5, 0]],
    wires: [[[0, -2], [0, -5]],[[0, -5], [2, -5]],[[6, -5], [10, -5]],[[10, -5], [10, -2]],[[10, 2], [10, 5]],[[10, 5], [0, 5]],[[0, 2], [0, 5]]],
    probes: [{"kind": "i", "part": "LA1"}, {"kind": "v", "at": [8, -5]}],
    show: "1",
    say: "A cold filament has about a tenth of its hot resistance, so the moment you switch on, a big surge flows (that's why bulbs usually blow at switch-on). As the wire heats and glows the current settles to its rated 0.1 A. Press ▶ Play to watch the bulb light up." },
  "Motor spin-up (it makes its own back-voltage)": {
    parts: [["battery", 0, 0, 1, {"voltage": "6"}],["switch", 4, -5, 0, {"closed": true}],["motor", 10, 0, 1, {"volts": "6"}],["ground", 0, 5, 0]],
    wires: [[[0, -2], [0, -5]],[[0, -5], [2, -5]],[[6, -5], [10, -5]],[[10, -5], [10, -2]],[[10, 2], [10, 5]],[[10, 5], [0, 5]],[[0, 2], [0, 5]]],
    probes: [{"kind": "i", "part": "MO1"}, {"kind": "v", "at": [8, -5]}],
    show: "1",
    say: "A stopped motor is just a coil of wire, so the current surges (about 1.2 A). As it speeds up it generates a voltage that pushes BACK against the battery, and the current drops to a trickle. Press ▶ Play: the spokes spin up (slowed down so you can see them). Real motors do this too - it's why a stuck motor gets hot." },
  "Relay with a flyback diode (the click and the spike)": {
    parts: [["battery", -14, 0, 1, {"voltage": "9"}],["relay", 8, -4, 0, {"coil": "9"}],["diode", 2, -4, 3, {"model": "1N4148"}],["npn", 5, 4, 0],["resistor", -1, 4, 0, {"value": "1k"}],["square", -6, 6, 1, {"high": "5", "low": "0", "frequency": "20", "duty": "50"}],["resistor", 14, 0, 1, {"value": "470"}],["led", 14, 6, 1, {"color": "green"}],["ground", -14, 10, 0]],
    wires: [[[-14, -2], [-14, -10]],[[-14, -10], [10, -10]],[[6, -5], [6, -10]],[[2, -6], [2, -10]],[[10, -5], [10, -10]],[[6, -3], [6, 2]],[[2, -2], [2, 2]],[[2, 2], [6, 2]],[[6, 6], [6, 10]],[[-6, 4], [-3, 4]],[[1, 4], [3, 4]],[[-6, 8], [-6, 10]],[[-14, 2], [-14, 10]],[[-14, 10], [14, 10]],[[10, -3], [14, -3]],[[14, -3], [14, -2]],[[14, 2], [14, 4]],[[14, 8], [14, 10]]],
    probes: [{"kind": "v", "at": [6, 0]}, {"kind": "i", "part": "K1"}, {"kind": "i", "part": "LED1"}],
    show: "0.1",
    say: "A square wave switches the transistor, which switches the relay's coil, which clicks the contacts and lights the LED (watch CLICK on the relay). When the coil is cut off it kicks a voltage spike - the diode D1 across the coil safely catches it. Select D1 and press Delete, then run again: the spike shoots up to thousands of volts and the app warns that the transistor would be destroyed." },
  "Night light (light sensor + transistor)": {
    parts: [["battery", 0, 0, 1, {"voltage": "9"}],["resistor", 6, -3, 1, {"value": "100k"}],["ldr", 6, 3, 1, {"light": "10"}],["npn", 11, 0, 0],["resistor", 12, -8, 1, {"value": "470"}],["led", 12, -4, 1, {"color": "yellow"}],["ground", 0, 8, 0]],
    wires: [[[0, -2], [0, -10]],[[0, -10], [12, -10]],[[6, -5], [6, -10]],[[6, -1], [6, 1]],[[6, 0], [9, 0]],[[6, 5], [6, 8]],[[12, 2], [12, 8]],[[0, 2], [0, 8]],[[0, 8], [12, 8]]],
    probes: [{"kind": "v", "at": [7, 0]}, {"kind": "i", "part": "LED1"}],
    say: "The light sensor (LDR) is a resistor that gets low in bright light. In the dark its resistance is huge, which lets current into the transistor's base and the LED turns on. Click LDR1 and slide 'How bright' up: the LED fades out around the middle of the slider. A tiny signal controlling a bigger one - that's how a transistor works as a switch." },
  "Heat alarm (thermistor + comparator)": {
    parts: [["battery", 0, 0, 1, {"voltage": "9"}],["resistor", 6, -3, 1, {"value": "10k"}],["resistor", 6, 3, 1, {"value": "10k"}],["thermistor", 12, -3, 1, {"r25": "10k", "warm": "0"}],["resistor", 12, 3, 1, {"value": "10k"}],["opamp", 18, 0, 0, {"rails": "9"}],["resistor", 23, 0, 0, {"value": "470"}],["diode", 27, 0, 0, {"model": "1N4007"}],["led", 31, 0, 0, {"color": "red"}],["ground", 0, 8, 0]],
    wires: [[[0, -2], [0, -9]],[[0, -9], [12, -9]],[[6, -5], [6, -9]],[[12, -5], [12, -9]],[[6, -1], [6, 1]],[[12, -1], [12, 1]],[[6, 5], [6, 8]],[[12, 5], [12, 8]],[[0, 2], [0, 8]],[[0, 8], [33, 8]],[[12, 0], [14, 0]],[[14, 0], [14, 1]],[[14, 1], [16, 1]],[[6, 0], [8, 0]],[[8, 0], [8, -7]],[[8, -7], [14, -7]],[[14, -7], [14, -1]],[[14, -1], [16, -1]],[[20, 0], [21, 0]],[[33, 0], [33, 8]]],
    probes: [{"kind": "v", "at": [13, 0]}, {"kind": "v", "at": [8, -3]}, {"kind": "i", "part": "LED1"}],
    show: "1e-3",
    say: "The thermistor is a resistor that drops as it warms. Its voltage (A) rises with heat; the op-amp compares it with a fixed 4.5 V (B) and switches the LED on when it's hotter (the extra diode stops the op-amp's negative output pushing current backwards through the LED). Press the 0 °C / 20 °C / 40 °C buttons at the top: the whole circuit's temperature changes. At 40 °C the alarm lights! (Click the thermistor and add 'extra warmth' to warm just that part.)" },
  "Schmitt trigger (hysteresis: it remembers which way it was going)": {
    parts: [["sine", 0, 0, 1, {"amplitude": "4", "frequency": "200", "offset": "0"}],["resistor", 5, -2, 0, {"value": "10k"}],["opamp", 13, 0, 0, {"rails": "5"}],["resistor", 13, 5, 0, {"value": "22k"}],["ground", 0, 4, 0],["ground", 11, -4, 0]],
    wires: [[[0, -2], [3, -2]],[[7, -2], [9, -2]],[[9, -2], [9, 1]],[[9, 1], [11, 1]],[[15, 0], [17, 0]],[[17, 0], [17, 5]],[[17, 5], [15, 5]],[[11, 5], [9, 5]],[[9, 5], [9, 1]],[[11, -1], [11, -4]],[[0, 2], [0, 4]]],
    probes: [{"kind": "v", "at": [1, -2]}, {"kind": "v", "at": [16, 0]}],
    show: "1e-2",
    say: "Positive feedback gives the op-amp TWO switching points, about +2.3 V going up and -2.3 V going down, instead of one. So a wobbly or noisy input can't make the output chatter: it only flips when the input clearly crosses a threshold. Watch B flip well after A passes zero. Remove R2's feedback to see a plain comparator." },
  "Emitter follower (a transistor buffer)": {
    parts: [["battery", 0, 0, 1, {"voltage": "12"}],["sine", 2, 5, 1, {"amplitude": "1", "frequency": "1k", "offset": "4"}],["npn", 8, 0, 0],["resistor", 9, 6, 1, {"value": "1k"}],["ground", 0, 10, 0]],
    wires: [[[0, -2], [0, -6]],[[0, -6], [9, -6]],[[9, -6], [9, -2]],[[2, 3], [2, 0]],[[2, 0], [6, 0]],[[9, 2], [9, 4]],[[9, 8], [9, 10]],[[2, 7], [2, 10]],[[0, 2], [0, 10]],[[0, 10], [9, 10]]],
    probes: [{"kind": "v", "at": [4, 0]}, {"kind": "v", "at": [9, 3]}],
    show: "5e-3",
    say: "The output (B) copies the input (A) but 0.65 V lower and with plenty of current to spare: voltage gain of 1, current gain of hundreds. A buffer lets a weak signal drive a heavy load without sagging. Try making the load RL 100 Ω." },
  "Transistor inverter (a NOT gate made from one transistor)": {
    parts: [["battery", -12, 0, 1, {"voltage": "5"}],["square", -6, 4, 1, {"high": "5", "low": "0", "frequency": "1k", "duty": "50"}],["resistor", -2, 3, 0, {"value": "10k"}],["resistor", 8, -4, 1, {"value": "1k"}],["npn", 7, 3, 0],["ground", -12, 9, 0]],
    wires: [[[-12, -2], [-12, -8]],[[-12, -8], [8, -8]],[[8, -6], [8, -8]],[[8, -2], [8, 1]],[[-6, 2], [-6, 3]],[[-6, 3], [-4, 3]],[[0, 3], [5, 3]],[[-6, 6], [-6, 9]],[[8, 5], [8, 9]],[[-12, 2], [-12, 9]],[[-12, 9], [8, 9]]],
    probes: [{"kind": "v", "at": [-4, 3]}, {"kind": "v", "at": [8, -1]}],
    show: "5e-3",
    say: "When the input (A) is high the transistor switches on and pulls the output (B) low; when the input is low the output is pulled high by the 1 kΩ. So the output is always the opposite: that's a NOT gate - the building block of every computer chip." },
  "Monostable multivibrator (one pulse per poke)": {
    parts: [["battery", -22, 0, 1, {"voltage": "9"}],["npn", -4, 2, 0],["npn", 10, 2, 0],["resistor", -3, -7, 1, {"value": "1k"}],["resistor", 11, -7, 1, {"value": "1k"}],["resistor", 8, -6, 1, {"value": "47k"}],["capacitor", 3, -2, 0, {"value": "10u"}],["resistor", 3, 8, 0, {"value": "10k"}],["resistor", -9, 6, 1, {"value": "22k"}],["capacitor", -13, 2, 0, {"value": "100n"}],["square", -18, 5, 1, {"high": "5", "low": "0", "frequency": "1", "duty": "50"}],["ground", -22, 10, 0]],
    wires: [[[-22, -2], [-22, -10]],[[-22, -10], [11, -10]],[[-3, -9], [-3, -10]],[[8, -8], [8, -10]],[[11, -9], [11, -10]],[[-3, -5], [-3, 0]],[[-3, -2], [1, -2]],[[-3, -2], [1, -2]],[[5, -2], [8, -2]],[[8, -2], [8, 2]],[[8, -4], [8, -2]],[[11, -5], [11, 0]],[[11, 0], [13, 0]],[[13, 0], [13, 8]],[[13, 8], [5, 8]],[[1, 8], [-6, 8]],[[-6, 8], [-6, 2]],[[-9, 4], [-9, 2]],[[-9, 2], [-6, 2]],[[-11, 2], [-9, 2]],[[-18, 3], [-18, 2]],[[-18, 2], [-15, 2]],[[-9, 8], [-9, 10]],[[-18, 7], [-18, 10]],[[-3, 4], [-3, 10]],[[11, 4], [11, 10]],[[-22, 2], [-22, 10]],[[-22, 10], [13, 10]]],
    probes: [{"kind": "v", "at": [-17, 2]}, {"kind": "v", "at": [11, -3]}, {"kind": "v", "at": [-3, -3]}],
    show: "5",
    say: "This circuit has ONE stable state. Poke it with a tiny trigger (A) and the output (B) dips low for one pulse of its own length, then snaps back (C is the other transistor, doing the opposite). The pulse length is set by R3 and C1, roughly 0.69 × 47 kΩ × 10 µF ≈ 0.3 s. Try 100 µF for a pulse ten times longer." },
  "Class B push-pull amplifier (watch the crossover glitch)": {
    parts: [["battery", -14, -3, 1, {"voltage": "9"}],["battery", -14, 5, 1, {"voltage": "9"}],["sine", -8, 1, 1, {"amplitude": "3", "frequency": "1k", "offset": "0"}],["npn", 4, -3, 0],["pnp", 4, 5, 2],["resistor", 10, 5, 1, {"value": "100"}],["ground", -16, 1, 0],["ground", 10, 10, 0],["ground", -8, 5, 0]],
    wires: [[[-14, -5], [-14, -9]],[[-14, -9], [5, -9]],[[5, -9], [5, -5]],[[-14, -1], [-14, 3]],[[-16, 1], [-14, 1]],[[-14, 7], [-14, 13]],[[-14, 13], [3, 13]],[[3, 7], [3, 13]],[[-8, -1], [-4, -1]],[[-4, -1], [-4, -3]],[[-4, -3], [2, -3]],[[5, -1], [5, 1]],[[5, 1], [3, 1]],[[3, 1], [3, 3]],[[5, 1], [10, 1]],[[10, 1], [10, 3]],[[10, 7], [10, 10]],[[6, 5], [7, 5]],[[7, 5], [7, 10]],[[7, 10], [-4, 10]],[[-4, 10], [-4, -1]],[[-8, 3], [-8, 5]]],
    probes: [{"kind": "v", "at": [-6, -1]}, {"kind": "v", "at": [8, 1]}],
    show: "5e-3",
    say: "An NPN handles the top half of the wave and a PNP the bottom half, so each transistor rests half the time (efficient!). But a transistor needs about 0.65 V on its base before it wakes up, so around zero BOTH are off and the output (B) has a flat 'dead zone' where it ignores the input (A). That kink is called crossover distortion - you can hear it as buzzing." },
  "Class AB amplifier (two diodes fix the glitch)": {
    parts: [["battery", -20, -3, 1, {"voltage": "9"}],["battery", -20, 5, 1, {"voltage": "9"}],["sine", -12, -1, 1, {"amplitude": "3", "frequency": "1k", "offset": "0"}],["capacitor", -6, -3, 0, {"value": "10u"}],["resistor", 0, -6, 1, {"value": "1k"}],["diode", 0, 0, 1, {"model": "1N4148"}],["diode", 0, 4, 1, {"model": "1N4148"}],["resistor", 0, 10, 1, {"value": "1k"}],["npn", 4, -3, 0],["pnp", 4, 5, 2],["resistor", 10, 5, 1, {"value": "100"}],["ground", -22, 1, 0],["ground", 10, 10, 0],["ground", -12, 3, 0]],
    wires: [[[-20, -5], [-20, -9]],[[-20, -9], [5, -9]],[[0, -8], [0, -9]],[[5, -5], [5, -9]],[[-20, -1], [-20, 3]],[[-22, 1], [-20, 1]],[[-20, 7], [-20, 13]],[[-20, 13], [3, 13]],[[3, 7], [3, 13]],[[0, 12], [0, 13]],[[-12, -3], [-8, -3]],[[-4, -3], [0, -3]],[[2, -3], [0, -3]],[[0, -4], [0, -2]],[[0, 6], [0, 8]],[[6, 5], [7, 5]],[[7, 5], [7, 8]],[[7, 8], [0, 8]],[[5, -1], [5, 1]],[[5, 1], [3, 1]],[[3, 1], [3, 3]],[[5, 1], [10, 1]],[[10, 1], [10, 3]],[[10, 7], [10, 10]],[[-12, 1], [-12, 3]]],
    probes: [{"kind": "v", "at": [-10, -3]}, {"kind": "v", "at": [8, 1]}],
    show: "5e-3",
    say: "Same push-pull pair as before, but two diodes (D1, D2) and two resistors hold both bases about 0.65 V away from 'asleep', so one transistor is already waking as the other goes to sleep. The dead zone vanishes and B is a clean copy of A. Select D1 and press Delete, then run again, to bring the crossover glitch back." },
  "Class D amplifier (a switch pretending to be a speaker driver)": {
    parts: [["square", -4, 1, 1, {"high": "2", "low": "-2", "frequency": "100k", "duty": "50"}],["resistor", 4, -1, 0, {"value": "10k"}],["opamp", 10, 0, 0, {"rails": "5"}],["capacitor", 10, -6, 0, {"value": "1n"}],["resistor", 10, -10, 0, {"value": "100k"}],["ground", 8, 5, 0],["ground", -4, 5, 0],["sine", 18, 5, 1, {"amplitude": "0.3", "frequency": "5k", "offset": "0"}],["ground", 18, 9, 0],["opamp", 24, 0, 0, {"rails": "5"}],["inductor", 30, 0, 0, {"value": "1m"}],["capacitor", 34, 3, 1, {"value": "100n"}],["resistor", 36, 3, 1, {"value": "1k"}],["ground", 36, 8, 0]],
    wires: [[[-4, -1], [2, -1]],[[-4, 3], [-4, 5]],[[6, -1], [8, -1]],[[6, -1], [6, -6]],[[6, -6], [8, -6]],[[6, -6], [6, -10]],[[6, -10], [8, -10]],[[12, 0], [14, 0]],[[14, 0], [14, -10]],[[14, -10], [12, -10]],[[14, -6], [12, -6]],[[8, 1], [8, 5]],[[14, 0], [18, 0]],[[18, 0], [18, -1]],[[18, -1], [22, -1]],[[18, 3], [18, 1]],[[18, 1], [22, 1]],[[18, 7], [18, 9]],[[26, 0], [28, 0]],[[32, 0], [36, 0]],[[34, 0], [34, 1]],[[36, 0], [36, 1]],[[34, 5], [34, 8]],[[34, 8], [36, 8]],[[36, 5], [36, 8]]],
    probes: [{"kind": "v", "at": [16, 0]}, {"kind": "v", "at": [27, 0]}, {"kind": "v", "at": [33, 0]}],
    show: "1e-3",
    from: "1e-3",
    say: "The clever trick: instead of amplifying smoothly, make the output flick fully on/off very fast (PWM) and let the width of the pulses carry the sound. A comparator checks the music (SIG1, a 5 kHz sine) against a fast triangle wave (A, made by the first op-amp); its output (B) is wide pulses when the music is high and thin pulses when low. A coil and capacitor (L1, C2) smooth the pulses back into the sine wave (C). Because the output only ever switches, almost no power is wasted as heat - that's why Class D is in phones and soundbars." },
  "555 tone maker (a speaker that beeps)": {
    parts: [["battery", 0, 0, 1, {"voltage": "9"}],["555", 10, 0, 0],["resistor", 16, -4, 1, {"value": "1k"}],["resistor", 16, 3, 1, {"value": "10k"}],["capacitor", 4, 6, 1, {"value": "100n"}],["capacitor", 19, 1, 1, {"value": "10u"}],["speaker", 19, 6, 1, {"ohms": "8"}],["ground", 0, 8, 0]],
    wires: [[[0, -2], [0, -8]],[[0, -8], [20, -8]],[[0, 2], [0, 8]],[[0, 8], [20, 8]],[[10, -3], [10, -8]],[[10, 3], [10, 8]],[[16, -6], [16, -8]],[[16, -2], [16, 1]],[[13, 1], [16, 1]],[[16, 5], [7, 5]],[[7, 5], [4, 5]],[[7, 5], [7, 1]],[[7, 1], [7, -1]],[[4, 4], [4, 5]],[[13, -1], [19, -1]],[[19, 3], [19, 4]]],
    probes: [{"kind": "v", "at": [14, -1]}, {"kind": "i", "part": "SP1"}],
    show: "1e-2",
    say: "The same 555 blinker, but 100 times faster and wired to a speaker through a capacitor (which blocks DC so the speaker just gets the wiggle). The pitch is 1.44 ÷ ((R1 + 2×R2) × C1) ≈ 690 Hz. Make C1 smaller for a higher note, bigger for a lower one. Press ▶ Play to see the speaker's sound waves." },
  "Diode clipper (a wave with its tops sliced off)": {
    parts: [["sine", 0, 0, 1, {"amplitude": "5", "frequency": "1k", "offset": "0"}],["resistor", 4, -4, 0, {"value": "1k"}],["diode", 8, 0, 1, {"model": "1N4148"}],["diode", 11, 0, 3, {"model": "1N4148"}],["ground", 0, 6, 0]],
    wires: [[[0, -2], [0, -4]],[[0, -4], [2, -4]],[[6, -4], [11, -4]],[[11, -4], [11, -2]],[[8, -4], [8, -2]],[[8, 2], [8, 6]],[[11, 2], [11, 6]],[[0, 2], [0, 6]],[[0, 6], [11, 6]]],
    probes: [{"kind": "v", "at": [1, -4]}, {"kind": "v", "at": [9, -4]}],
    show: "5e-3",
    say: "The two diodes face opposite ways. Neither does anything until the voltage reaches about 0.65 V, then it conducts and won't let it go any higher - so the big 5 V sine (A) gets its peaks sliced flat at ±0.65 V (B). Guitar distortion pedals are built from exactly this!" },
  "RC high-pass (it only passes the changes)": {
    parts: [["square", 0, 0, 1, {"high": "5", "low": "0", "frequency": "1k", "duty": "50"}],["capacitor", 4, -4, 0, {"value": "100n"}],["resistor", 8, 0, 1, {"value": "1k"}],["ground", 0, 4, 0]],
    wires: [[[0, -2], [0, -4]],[[0, -4], [2, -4]],[[6, -4], [8, -4]],[[8, -4], [8, -2]],[[8, 2], [8, 4]],[[8, 4], [0, 4]],[[0, 2], [0, 4]]],
    probes: [{"kind": "v", "at": [1, -4]}, {"kind": "v", "at": [8, -3]}],
    show: "5e-3",
    say: "A capacitor lets changes through but blocks steady voltage. At each edge of the square wave (A) a spike gets through (B) which then fades away as the capacitor charges. Where the low-pass example rounds edges off, this one keeps ONLY the edges. Try a bigger resistor and watch the spikes last longer." },
  "Coil current builds slowly (a coil resists change)": {
    parts: [["battery", 0, 0, 1, {"voltage": "9"}],["switch", 4, -4, 0, {"closed": true}],["resistor", 9, -4, 0, {"value": "1k"}],["inductor", 13, 0, 1, {"value": "1"}],["ground", 0, 4, 0]],
    wires: [[[0, -2], [0, -4]],[[0, -4], [2, -4]],[[6, -4], [7, -4]],[[11, -4], [13, -4]],[[13, -4], [13, -2]],[[13, 2], [13, 4]],[[13, 4], [0, 4]],[[0, 2], [0, 4]]],
    probes: [{"kind": "i", "part": "L1"}, {"kind": "v", "at": [11, -4]}],
    show: "1e-2",
    say: "A coil fights any change in current, so when you close the switch the current doesn't jump to 9 V ÷ 1 kΩ = 9 mA - it climbs gradually, with 'time constant' L ÷ R = 1 H ÷ 1 kΩ = 1 ms. (The capacitor example is the mirror image: it fights changes in VOLTAGE.) Try 100 mH for a faster climb." },
  "Dim an LED with a volume knob": {
    parts: [["battery", 0, 0, 1, { voltage: "9" }], ["pot", 5, -4, 0, { value: "10k", position: "20" }], ["led", 11, 0, 1, { color: "blue" }], ["resistor", 11, 4, 1, { value: "220" }], ["ground", 0, 8, 0]],
    wires: [[[0, -2], [0, -4]], [[0, -4], [3, -4]], [[5, -6], [3, -6]], [[3, -6], [3, -4]], [[7, -4], [11, -4]], [[11, -4], [11, -2]], [[11, 6], [11, 8]], [[11, 8], [0, 8]], [[0, 2], [0, 8]]],
    probes: [{ kind: "i", part: "LED1" }],
    say: "Select the volume knob (VR1) and slide 'Volume knob position' - the LED dims and brightens as you go." },
};
EXAMPLES["Astable multivibrator (see its waveforms)"] = { ...EXAMPLES["Two-transistor LED flasher"], show: "5",
  probes: [{ kind: "v", at: [7, 0] }, { kind: "v", at: [19, 0] }, { kind: "v", at: [4, 0] }, { kind: "v", at: [16, 0] }],
  say: "Two transistors take turns: each one switches the other off through a capacitor, so the two collectors (A, B) swap high and low over and over - a square-wave generator from two transistors. Look at the sharp edges on the collectors and the slow ramps on the bases (C, D) where the capacitors recharge. Rate is roughly 1 ÷ (1.4 × R × C)." };
function loadExample(name) {
  const ex = EXAMPLES[name];
  snapshot();
  S = { parts: [], wires: [], probes: [] };
  ex.parts.forEach(([t, x, y, r, pr]) => addPart(t, x, y, r, pr));
  ex.wires.forEach(([a, b]) => S.wires.push({ a, b }));
  ex.probes.forEach((q) => { const used = S.probes.length; S.probes.push({ ...q, color: PROBE_COLORS[used], letter: "ABCDEF"[used] }); });
  $("#duration").value = ex.show || ""; $("#from").value = ex.from || "0"; markWaves(null); preWave = null; waveMem = null;
  sel = null; result = null; stale = true;
  showProps();
  fitView();
  save();
  run().then(() => { const m = $("#messages"); const d = document.createElement("div"); d.className = "msg"; d.textContent = "💡 " + ex.say; m.prepend(d); });
}

/* ------------------------------------------------------------------ wiring up the buttons */
document.querySelectorAll(".tool").forEach((b) => (b.onclick = () => setTool(b.dataset.tool)));
$("#rotateBtn").onclick = rotateSel;
$("#undoBtn").onclick = undo;
$("#runBtn").onclick = run;
$("#stopBtn").onclick = () => { if (job) fetch("/api/cancel/" + job, { method: "POST" }); };
document.querySelectorAll("#tempSeg button").forEach((b) => (b.onclick = () => {
  temp = +b.dataset.t;
  document.querySelectorAll("#tempSeg button").forEach((x) => x.classList.toggle("on", x === b));
  if (hasRun) run();
}));
$("#duration").onchange = () => hasRun && run();
$("#from").onchange = () => hasRun && run();
const exSel = $("#examples");
Object.keys(EXAMPLES).forEach((n) => { const o = document.createElement("option"); o.value = o.textContent = n; exSel.appendChild(o); });
exSel.onchange = () => { if (exSel.value) loadExample(exSel.value); exSel.value = ""; };
$("#newBtn").onclick = () => { snapshot(); S = { parts: [], wires: [], probes: [] }; result = null; hasRun = false; sel = null; showProps(); showMessages([]); changed(false); };
$("#saveBtn").onclick = () => {
  const blob = new Blob([JSON.stringify({ app: "Spicey Electrons", version: 1, circuit: S, temp }, null, 1)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "my-circuit.se.json";
  a.click();
};
// Make a loaded circuit safe to use: files and saved sessions may be old, hand-edited or damaged.
function cleanCircuit(d) {
  const out = { parts: [], wires: [], probes: [] }, dropped = [], seen = new Set();
  if (!d || typeof d !== "object") throw new Error("not a circuit");
  const num = (v) => typeof v === "number" && isFinite(v);
  (Array.isArray(d.parts) ? d.parts : []).forEach((p) => {
    if (!p || !DEF[p.type] || !num(p.x) || !num(p.y)) { dropped.push(p && p.type ? String(p.type) : "?"); return; }
    let id = typeof p.id === "string" && p.id && !seen.has(p.id) ? p.id : null;
    const q = { id: id || "", type: p.type, x: Math.round(p.x), y: Math.round(p.y), rot: ((p.rot | 0) % 4 + 4) % 4,
                props: { ...DEF[p.type].props, ...(p.props && typeof p.props === "object" ? p.props : {}) } };
    if (!id) { const keep = S; S = out; q.id = newId(p.type); S = keep; }
    seen.add(q.id); out.parts.push(q);
  });
  const pt = (a) => Array.isArray(a) && a.length === 2 && num(a[0]) && num(a[1]);
  (Array.isArray(d.wires) ? d.wires : []).forEach((w) => { if (w && pt(w.a) && pt(w.b)) out.wires.push({ a: w.a.map(Math.round), b: w.b.map(Math.round) }); });
  (Array.isArray(d.probes) ? d.probes : []).forEach((q) => {
    if (!q || out.probes.length >= PROBE_COLORS.length) return;
    if (q.kind === "v" && pt(q.at) || q.kind === "i" && seen.has(q.part)) {
      const k = out.probes.length;
      out.probes.push({ ...q, color: PROBE_COLORS[k], letter: "ABCDEF"[k] });
    }
  });
  return { circuit: out, dropped };
}

$("#loadBtn").onclick = () => $("#loadFile").click();
$("#loadFile").onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    const c = cleanCircuit(d.circuit || d);
    snapshot();
    S = c.circuit;
    result = null; sel = null;
    fitView(); changed(false);
    if (c.dropped.length) flash(`I left out ${c.dropped.length} part(s) I don't know (${[...new Set(c.dropped)].join(", ")}). Maybe the file is from a newer version?`);
  } catch (err) { flash("That file doesn't look like a Spicey Electrons circuit."); }
  e.target.value = "";
};

(async function init() {
  buildPalette();
  setTool("select");
  try { const s = localStorage.getItem("se_circuit"); if (s) S = cleanCircuit(JSON.parse(s)).circuit; } catch (_) { S = { parts: [], wires: [], probes: [] }; }
  try {
    const info = await (await fetch("/api/info")).json();
    $("#ver").textContent = `v${info.version}`;
    $("#footer").textContent = `${info.app} v${info.version} · Built ${info.build} · Made by Matthew Armstrong (The-Dorkknight)`;
    document.title = `${info.app} ${info.version} (Built ${info.build})`;
    if (!info.ngspice) showMessages([{ level: "error", text: "The simulation engine (ngspice) isn't installed yet, so ▶ Run won't work. Close this and run the launcher again - it offers to install it. (See README: 'Installing ngspice'.)" }]);
  } catch (_) {}
  if (S.parts.length) fitView(); else render();
  if (!S.parts.length) showMessages([{ level: "note", text: "👋 Welcome! Drag parts from the left onto the board, drag from a leg dot to another to wire them up, double-click any part to change its value, then press ▶ Run. Or pick 📚 Examples to see one working." }]);
})();
$("#flowDots").onchange = () => render();
