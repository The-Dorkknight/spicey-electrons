# Design notes and research

These are the research notes and decisions behind Spicey Electrons 0.4.0-wip (November 2026).

## 1. The goal

> "SPICE is powerful but painful to use. Build a UI that lets you intuitively join components
> together, then intuitively scope/measure components and paths for waveforms and currents, so
> intuitively a 14-year-old could figure it out."

Requirements that came out of that:
- real SPICE accuracy (real device models, real maths), not a toy engine;
- no netlists, analysis cards or SPICE jargon unless you go looking for them;
- probes you clip on, like a real scope;
- temperature with three simple choices: 20 °C (default), 0 °C and 40 °C;
- free and offline (Tinkercad Circuits was ruled out because it's an online black box);
- runs on a 7th-gen Core i3, on Linux Mint, Bazzite, Mac and Windows.

## 2. What already exists, and how accurate it is

**Falstad CircuitJS** is the friendliest existing simulator (moving current dots, click-to-scope).
It solves circuits by modified nodal analysis, the same basic method SPICE uses, so resistors,
capacitors, inductors, switches and sources come out essentially exact. Where it differs from SPICE
is the device models:

| Area | Falstad | SPICE |
|---|---|---|
| R, L, C, sources | Effectively exact | Exact |
| Diodes / LEDs | Simple exponential diode | Full model incl. series resistance, capacitance, temperature |
| BJTs | Simple Ebers-Moll-style model, no capacitances | Gummel-Poon models from manufacturers (2N3904 etc.) |
| MOSFETs | Square-law, no capacitances | Many levels, up to BSIM |
| Op-amps | Near-ideal | Ideal, behavioural, or full vendor macro-models |
| Time step | Fixed (user-set) | Adaptive, error-controlled |
| Temperature | Not modelled | Built in (`.temp`) |
| Bad circuits | Almost always gives *an* answer | Can refuse (singular matrix), which is annoying but honest |

Short version: Falstad tells you **how a circuit behaves**; SPICE tells you **how that exact part
behaves**. For switching edges, ringing, high frequencies, temperature and real part numbers, SPICE
wins.

## 3. Licence decision: fork Falstad, or build fresh?

- CircuitJS is **GPL-2.0**. A fork would have to stay GPL. It could stay free and credited, but
  anyone could sell it, and Matthew's usual PolyForm Noncommercial licence couldn't be used.
- CircuitJS is Java compiled to JavaScript with GWT (dated, awkward toolchain), and its animation
  reads straight from its own solver, so swapping in ngspice would mean rewiring most of it anyway.
- **ngspice** is under a BSD-style licence. Running it as a separate program (not linking it) keeps
  the licences fully separate.

**Decision:** build a fresh editor (own code, PolyForm Noncommercial) and borrow *ideas* from
Falstad and SoloTrace, not code. ngspice is a separately installed engine, not bundled.

## 4. Architecture decisions

| Decision | Chosen | Rejected, and why |
|---|---|---|
| GUI | Web page served by a tiny Python server | tkinter: a pain on Bazzite (immutable); Qt: heavy |
| Engine link | Run the `ngspice` program per simulation | Shared library (`libngspice`): faster and allows live runs, but a crash takes the app down and Windows/Mac library paths differ. Kept as a later option. |
| Engine in the browser | Not now | ngspice compiled to WebAssembly exists in the wild, but adds a big download and build step; later option for a no-install web version |
| Python packages | None (standard library only) | PySpice, numpy: extra installs for little gain at this size |
| Analysis | Transient only, auto length | AC/DC sweeps confuse beginners; planned as an "advanced" tab |
| Results | Every node voltage + every part current, 1,000 points each | Saving only probed signals would make each new probe need a re-run |
| Values | Our own parser: `M` = mega, `m` = milli | SPICE: both mean milli, a classic beginner trap |

### Hidden helpers in the netlist (and why)
- **0 V ammeter in every part:** the universal way to measure current in SPICE, and it works for
  every part type.
- **Battery ramp (0 → V in 1 µs):** without it, SPICE first solves the DC operating point, so a
  capacitor would already be charged at t = 0. Kids expect "connect the battery, then watch it fill".
  (`uic` would also do it, but it makes transistor circuits fail to converge more often.)
- **0.1 Ω inside sources, 0.01 Ω in coils:** avoids "voltage source loop" errors when two ideal
  sources or a source and a coil are joined. It also makes a short circuit show a huge but finite
  current, which triggers the short-circuit warning instead of a cryptic error.
- **`rshunt=1e12`:** a teraohm from every node to ground, so a floating node doesn't cause a
  singular matrix. Effect on results: negligible (picoamps).
- **`method=gear`:** steadier than the default trapezoidal method on switching edges (less false
  ringing).

## 5. Models and temperature

- 1N4148, 1N4007, 2N3904, 2N2222, 2N3906: the widely published manufacturer SPICE models,
  characterised at 27 °C (TNOM). ngspice shifts them to 0, 20 or 40 °C.
- **LEDs** are fitted per colour to a typical forward voltage at 20 mA (red 1.8 V, yellow 2.0,
  green 2.1, blue/white 3.0), with N = 2 and 2 Ω series resistance.
    - *Bug found while testing:* with silicon's band gap (EG = 1.11 eV) the LED voltage went **up** as
    it warmed. Real LEDs go **down** by roughly 2 mV/°C. Setting EG to about Vf + 0.5 V gives
    −2 mV/°C. Measured after the fix: red 1.863 V at 0 °C, 1.823 V at 20 °C, 1.783 V at 40 °C.
    - 1N4148 check: 0.653 V at 0 °C, 0.614 V at 20 °C, 0.575 V at 40 °C (−1.9 mV/°C, textbook value).
- **2N7000**: a simple level-1 MOSFET (VTO 2.1 V, KP 0.1) for behaviour, not datasheet accuracy.
- **Op-amp**: `V = rail · tanh(1e5 · (V+ − V−) / rail)` behind 50 Ω, with 10 MΩ between the inputs.
  The tanh gives smooth clipping at the rails, which SPICE handles better than a hard limit.

## 6. Measurements (sandbox, Ubuntu 24.04, ngspice 42, 2 vCPU)

| Check | Expected (hand maths) | Simulated |
|---|---|---|
| RC charge, 9 V, 1 kΩ, 100 µF, at t = τ (0.1 s) | 5.689 V | 5.692 V |
| LED + 470 Ω on 9 V | (9 − 1.8) / 470 = 15.3 mA | 15.4 mA |
| Transistor switch base current (10 kΩ, 9 V) | (9 − 0.7) / 10k = 0.83 mA | 0.824 mA |
| Inverting op-amp, 1 k / 10 k, 0.5 V in | 5 V out, inverted | ±5.00 V, inverted |
| Pot 10 kΩ at 25 % on 10 V | 7.5 V | 7.50 V |
| Every example | | about 0.11 s each, including start-up |
| Heavy run: 2,000 square-wave cycles, one CPU core | | 0.27 s |

**Not yet measured on a real 7th-gen Core i3.** Each run is one short ngspice process; on an older
CPU, expect a few times slower, which is still under a second for these circuits. The heartbeat and
the 2-minute limit cover the unusual cases.

## 7. Kid-friendliness decisions

- Words over symbols: "Wave maker", "Volume knob (pot)", "Coil (inductor)", "How fast (Hz)".
- **Drag from a leg to draw a wire**: no wire tool needed for the common case.
- Errors name the part and the leg ("LED1's cathode (−, flat side) isn't connected to anything") and
  select it.
- No ground? Pick one and say so, rather than refusing.
- Burn-out warnings use real limits, ignore normal switch-on surges, and say how to fix the problem.
- The netlist is always one click away ("For the curious"), so it can also teach real SPICE.
- UK-friendly: Ω-box resistor symbol (IEC style), en-GB spelling.

## 8. Links with Matthew's other projects

- **SoloTrace** (single-sided PCB designer) has a schematic/sketch tab planned. Spicey Electrons's editor
  is a natural candidate for it: same grid, same "parts grouped by kind, preview in the sidebar, no
  pop-ups" style. A later step: **"Send to SoloTrace"** to export the netlist and parts so a
  simulated circuit becomes a board. Kept separate for now so neither project blocks the other.
- **Drop-in plug-ins**: new part types could become drop-ins later (a part = drawing + pins +
  netlist snippet + limits).

## 9. Ideas and next steps

1. Animated current dots along wires (wire currents can be worked out from the part currents with
   Kirchhoff's current law when each net is a tree).
2. More parts: 555 timer (behavioural), logic gates, lamp, buzzer/speaker, relay, motor, Zener,
   photoresistor, thermistor (that would make the temperature switch even more fun).
3. "Live" mode: keep ngspice running in shared-library mode so volume knobs and switches change *during*
   the run.
4. Frequency sweep (Bode plot) as an advanced tab.
5. Send to SoloTrace.
6. Optional in-browser engine (ngspice WebAssembly) for a no-install version.

## 10. Transformers, ringing and the FM bug (0.2.0)
- **Transformer difficulty: easy.** SPICE already has coupled inductors (`K`); the part, drawing and
  checks took a fraction of the 0.1.0 work. The hard part was fast circuits, not the transformer.
- Dot convention verified by test: current into a dot makes the other dot positive. Coupling is
  clamped below 1 because k = 1 makes the inductance matrix singular.
- **Time steps:** 40 steps per cycle costs about -0.2 % in a measured resonance (checked on the RLC
  ring, 15.9 kHz). ASCII `wrdata` was 190 MB and 2.7 s to parse for the FM bug; binary raw is about 70x smaller.
  ngspice itself needs about 5.5 s for 636k steps on 2 vCPUs. Not yet timed on a 7th-gen i3; a
  5x slower machine should take roughly 30 s (an estimate, not measured), with the heartbeat showing it is alive.
- **FM bug found by experiment:** the first design gave "dead windows" because the audio coupling cap
  acted as a base bypass; adding 4.7 kΩ + 100 nF in series and a 100 pF base bypass fixed it. Audio
  above about 0.3 V chokes the oscillator, so the example uses 0.2 V. Measured: 20 kHz audio swings
  the carrier by about ±0.4 MHz around 86 MHz.
- **Joule thief polarity matters:** primary dot to the + rail, secondary dot to the base; the other
  way round it never starts.
- Frequency detection uses the mean level with hysteresis; a rejection window of 0.7x to 1.4x the
  median period stops a missed crossing from showing half the frequency.

## 11. The 555, logic gates and Miller capacitance (0.3.0)
- The 555 is a SPICE behavioural model: a latch voltage `q` (0 to 1) on a 100 pF node is pushed up when
  the trigger is under 1/3 supply and down when the threshold is over 2/3 (reset wins). A cubic term
  makes 0 and 1 stable so it remembers. Outputs are driven from `q` through 15 Ω; a switch discharges
  the timing capacitor while `q` is low. Rate in the astable example: 1.513 Hz measured, 1.516 Hz by formula.
- Gate inputs are tanh comparators at half the high level; output 50 Ω with 10 pF.
- Miller: the Cgd default of 4 pF with 16 pF Cgs gives a capacitive divider of 20 %: a 12 V edge lifts
  the gate about 2.4 V, past the 2.1 V threshold. The plateau example uses 30 pF / 60 pF so the plateau is
  easy to see; with real 2N7000 values it lasts under 0.1 µs.
- Asked for but not built: a "floating base capacitance / avalanche" LED flasher. A plain SPICE
  BJT has no emitter-base breakdown or snap-back, so a faithful version needs a custom model (a
  behavioural avalanche device) and would be an approximation. Its natural speed (pF with megohms) is
  hundreds of kHz, too fast to see as a blink. Needs a clearer description of the intended circuit.

## 12. How to test a change

1. `python3 -m unittest discover -s tests -v`: the simulation tests compare against hand maths.
2. Start it (`python3 src/main.py`), load every example from 📚 Examples, press ▶ Run, and check the
   scope values against the 💡 hint.
3. Build the LED circuit by hand with the mouse (drag from leg to leg), probe it, change the
   resistor to 10 Ω and check for the 🔥 warnings.

## 13. Dots, more parts and the workbook (0.4.0)

- **Why KCL and not a second simulation:** the part currents are already measured, so wire currents are free arithmetic. The price is that looped wire nets show no dots. Honest gaps beat wrong arrows.
- **Checks made against hand calculation:** astable base dips to about −6.5 V; Joule thief collector about 3.7 V; relay spike about 4.9 kV without its diode (the app warns); Zener with a 10 kΩ feed collapses to about 1 V; monostable pulse ≈ 0.69 R C.
- **Class D** is a PWM comparator plus a low-pass filter; it is a teaching model, not an audio-grade design.
- **Workbook:** built from `tools/workbook_content.py` plus screenshots from `tools/shoot_examples.py`, so the pictures always match the app. No jargon without a glossary entry.
- **Deferred, with reasons:** *live mode* needs ngspice as a shared library running a step at a time (a real piece of work, and untestable here on a slow machine); *Bode sweep* needs an AC-analysis path through the netlist, results format and a new plot; *SoloTrace export* needs the SoloTrace file format agreed; *WebAssembly engine* means building ngspice for the browser, which conflicts with the "tiny download, runs on a 7th-gen i3" goal until measured.
