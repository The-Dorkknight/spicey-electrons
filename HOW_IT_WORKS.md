# How Spicey Electrons works

In plain English: **the browser draws, Python translates, ngspice does the maths.**

```
  Your web browser  (editor: app.js)
    parts, wires, probes, scope
    works out which legs touch which wires
        │  JSON: parts + nets + temperature
        ▼
  Python  (src/main.py, standard library only)
    server.py   tiny local web server on 127.0.0.1
    netlist.py  beginner checks, builds the SPICE netlist
    runner.py   runs ngspice, heartbeat, friendly warnings
        │  circuit.cir            ▲  results (numbers)
        ▼                         │
  ngspice  (the SPICE engine, in its own process)
```

## What happens when you press ▶ Run

1. **The editor works out the "nets".** Every leg and wire end sits on a grid point. Things on the
   same point are joined, and so is a wire end or leg landing on the middle of a wire (a T-joint).
   Wires that only cross are not joined. Each group of joined things becomes one net (`n1`, `n2`, …);
   the net touching a ground symbol is `0`.
2. **It sends the parts and their nets to Python**, with the temperature and how long to show.
3. **`netlist.py` checks for beginner problems first**: no parts, nothing powering it, a battery
   shorted by a wire, a value it can't read ("banana Ω"), legs not connected to anything. If there's
   no ground, it uses the minus side of the first battery and says so.
4. **It writes a SPICE netlist.** Every friendly value ("4.7k", "100n", "1M") becomes a plain number,
   so SPICE's trap where `1M` means *milli* can't bite. Extras added behind the scenes:
    - a hidden 0 V "ammeter" in one leg of every part, so **every current** comes back from one run;
    - batteries ramp up over 1 µs, as if you'd just connected them (capacitors start empty);
    - 0.1 Ω inside every battery and signal source, and 0.01 Ω in every coil, so an ideal source can't
      fight an ideal wire;
    - `rshunt=1e12` (a huge resistor from every node to ground), so a part dangling in mid-air
      doesn't stop the maths;
    - `.temp 0`, `20` or `40`.
5. **`runner.py` starts ngspice as a separate program** (`ngspice -b circuit.cir`). While it runs, the
   browser asks every 0.12 s how it's doing and shows a heartbeat (seconds so far, and on Linux the
   engine's CPU time and memory). After 2 minutes it's stopped. If ngspice crashes, only that run is
   lost.
6. **The answers come back** as 1,000 evenly spaced points per voltage and current. Python checks
   them against real-part limits (LED about 30 mA, resistor 0.25 W, …) and adds 🔥 warnings.
7. **The browser colours the wires** (green +, grey 0 V, red −) and lights the LEDs at the cursor
   time, and draws whichever probes you've clipped on.

Because every node voltage and every part current is already in the result, adding or moving a
probe afterwards is instant.

## Transformers and fast circuits
A transformer becomes two inductors, a small resistance in each winding and one SPICE `K` line that
couples them (secondary inductance = primary × ratio², so voltage scales with the ratio). Before the
run, the engine finds the fastest thing in the circuit (the quickest source, or 1/(2π√LC) for every coil
and capacitor) and asks ngspice for 40 steps per cycle of that. ngspice writes a compact binary file;
Spicey Electrons keeps the min and max in each pixel column (the scope band) and counts rising crossings
to get the frequency.

A 555 and the logic gates are built from SPICE "behavioural" sources: formulas, not real transistors.
A MOSFET also gets its real pin capacitances as little capacitors (that is where the Miller effect comes from).

## What it reads, changes and never does

- It reads only what you build in the editor (and files you open with 📂).
- It writes a temporary `.cir` netlist and results file in your system's temp folder and deletes them
  after each run. Your circuit is kept in the browser's local storage, and in files only when you
  click 💾.
- It never connects to the internet. The server listens on `127.0.0.1` only, so other computers on
  your network can't reach it.
- It does not install anything by itself: the launchers ask before installing ngspice.

## Files

| File | What it is |
|---|---|
| `src/main.py` | Starts everything (`--version`, `--no-browser`, `--port`) |
| `src/spiceyelectrons/server.py` | Local web server and job queue |
| `src/spiceyelectrons/netlist.py` | Beginner checks and netlist builder |
| `src/spiceyelectrons/runner.py` | Runs ngspice, heartbeat, time limit, friendly errors and warnings |
| `src/spiceyelectrons/parts.py` | Parts catalogue, SPICE models, safety limits |
| `src/spiceyelectrons/units.py` | "4k7" → 4700 and back |
| `src/spiceyelectrons/web/` | The editor: `index.html`, `app.js`, `style.css` (no libraries) |
| `tests/test_engine.py` | Unit tests, plus simulations checked against hand calculations |
| `tools/make_pdf.py` | Builds the PDF manual |

## Current dots, pin ammeters and the new parts (0.4.0)

- **Pin ammeters.** Besides one hidden 0 V ammeter per part, every pin of a multi-pin part (NPN, PNP, MOSFET, 555, volume knob, transformer, relay) gets its own (`vam_<id>_p<k>`). The current into each pin comes back as `result.pins`.
- **Wire currents.** Wires are axis-aligned. Each net is cut at every pin and wire end into a graph; if it is a tree (edges = nodes − 1) the current in each wire follows from the pin currents by Kirchhoff's current law, with the ground pin absorbing the remainder. Nets with loops, or more than one ground, get no dots (better none than wrong).
- **Dots.** SVG dashes (`stroke-dasharray`) animated with a CSS keyframe. Speed and size scale with log10(I / 1 µA), so microamps and amps both read.
- **Lamp:** resistance follows a thermal state node (4th-power law, 0.15 s time constant), cold ≈ one tenth of hot.
- **Motor:** R + L plus a back-EMF source driven by a speed node; ke = V/300.
- **Relay:** coil is R + L; the contact is a switch model with hysteresis (on at about 52 % of the coil voltage, off at about 22 %).
- **LDR:** R = 100 k · 0.5^(light/12.5). **Thermistor:** NTC, B = 3950, at the simulation temperature plus a warm-up.
- **Scope bands:** when the raw points are at least 1.5 × the display points, min/max envelopes are drawn so spikes are not lost.

## Playback, dots and wave zoom (0.4.0)

- One `requestAnimationFrame` loop moves a playhead (`cursorF`) through the result. About 25 times a second it re-draws the board and scope at that time sample; the dots are nudged every frame.
- Dots: each wire piece keeps a phase (px travelled). Every frame `phase += signedSpeed x dt`, so a current that changes sign makes the dots turn round. The speed comes from log10(I / 1 uA).
- Wave zoom: the period comes from the engine's frequency count when there is one, otherwise from rising crossings of the first trace (middle level, 10% hysteresis, median gap). The run is then repeated with Show = N periods and From = end - N periods. The period is remembered so 2 -> 10 -> 50 works after zooming in.
