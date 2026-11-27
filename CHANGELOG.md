# Changelog

All notable changes are listed here. Versions follow [semantic versioning](https://semver.org/);
`-wip` means work in progress. The build log per version is in [docs/HISTORY.md](docs/HISTORY.md).

## 0.4.0-wip

- **Credit:** the app footer, the workbook cover and last page, and the README now say it is made by Matthew Armstrong (The-Dorkknight).
- **Faster re-runs:** the last 6 finished runs are kept, so running the same circuit again (Run pressed twice, or changing a value and changing it back) answers instantly (0.01 s instead of 9 s for the FM bug). The web version does the same.
- **No more waiting for dead runs:** when ngspice says it has given up (for example "timestep too small") but keeps sitting there, the run now stops after about a second with the plain-English message instead of waiting for the 120 s limit.
- Measured, not changed: all 41 examples take 0.25 s or less natively except the FM bug (9 s, about 85 % of it inside ngspice, so the Python side is not the bottleneck). Not yet done: resume-from-state zooms, quick preview, parallel workers.
- **Web version (new, optional):** `site/` builds a copy of the app that runs in a web browser with nothing to install (ngspice as WebAssembly, computed on the visitor's own computer, nothing sent anywhere). It is published by a GitHub Pages workflow. A yellow bar says that very fast radio-frequency circuits (like the FM bug) are probably very slow there and links to the full download; circuits over about 60,000 steps are refused with that advice unless "let me try slow ones anyway" is ticked. Bad circuits (two batteries across each other) are stopped early with a plain message, Stop works, and a 120 s limit applies.
- **The downloaded app is unchanged and stays the safe fallback:** the web version copies `src/spiceyelectrons/web/` when it is built and never writes to it; the original never refers to `site/`. Tests check both, and that the JavaScript copy of the netlist builder gives byte-identical netlists to the Python one for all 41 examples and 25 edge cases.
- Fixed (very fast circuits such as the FM bug): the orange "random lines" were the raw samples of a carrier too fast to draw; it is now shown as a clean min/max band. When you enlarge one trace, the others fade instead of streaking across it. The frequency line is smoothed so it swings like a sine instead of stepping. Tiny time windows far from zero (e.g. 23 ns at 110 µs) label their ticks as offsets instead of repeating the same time.
- Fixed: scope controls no longer move around. Probe chips are on one fixed row (scrolls sideways if there are many), the controls are on their own row, numbers use fixed-width digits, and the Enlarge button keeps its place when hidden.
- **Value editor has a size dropdown:** numbers with units (volts, ohms, farads, henries, hertz, amps) now have a list to pick G giga, M mega, k kilo, m milli, µ micro, n nano or p pico, so nobody has to find a µ key. Typing 10u, 4k7 or 100n still works. A value that can't be read is flagged in red under the box and is never saved, so the circuit can no longer get stuck on a bad value.
- Fixed: the scope could jump between a zoomed-in and zoomed-out view when a small and a large trace were shown together, because dragging the time cursor near the small dashed line counted as a tap on it. A tap enlarges; any drag now just moves the cursor.
- **Changing a component's value is now obvious:** double-click any part (or click its blue, dotted-underlined value) and a floating editor opens on the board with the value box ready to type in. It has a close button, and the board hint says how. (The sidebar card was easy to miss.)
- **Frequency shown** on every probe chip (e.g. "peak 5 mV · 1 kHz") and on the small-signal label; it now works for signals down to microvolts.
- **Enlarging a tiny signal is easy to find:** click the dashed line or its label on the scope, or press the new "🔍 Enlarge small signal" button. Zoomed in, the scale drops to the signal's own size (it used to keep a 50 mV minimum). The wave buttons also work on tiny signals now.
- High-frequency circuits (faster than 1 MHz): the wave zoom shows at most 30 waves ('max' and 50 both mean 30), to keep old PCs light.
- Smaller package: git history trimmed to the last 3 builds (older ones stay listed in docs/HISTORY.md), packed with gc, example pictures re-compressed.
- **Playback:** after a run the whole board plays in step with the scope. Charge bars, LED glow and current dots all follow the playhead. Speed slider with detents (0.1×, 0.25×, 0.5×, 1×, 2×, 4×, 10×; 1× = the window in 6 s), loop tick, play/pause. Dragging the scope pauses it.
- **Current dots now reverse with AC** (they used one fixed direction): the dots are moved by the program using the signed current, not by a fixed CSS animation.
- **Tiny signals** that would look like a flat 0 V line next to a big one are drawn as a thick dashed line in their own colour, labelled with their size (e.g. "A: 50 mV"). A 🔍 button on the probe chip scales the graph to fit that trace (↩ undoes it), and then it is drawn as a normal line.
- Fixed: the playback speed started at 0.1× on a fresh install.
- **Resizable scope:** drag the grip above it (double-click resets); the height is remembered.
- **2 / 10 / 50 / max waves:** finds the wave's period and re-runs over exactly that many cycles ("max" goes back to the slice you started from).

- **Animated current dots** along wires (Kirchhoff's current law on loop-free wire networks; every pin of multi-pin parts is now measured).
- **New parts:** Zener diode, lamp (thermal model, switch-on surge), speaker, relay (hysteresis, click), motor (back-EMF, speed), light sensor (LDR), thermistor (NTC).
- **41 examples** (was 19), including Ohm's law, Kirchhoff's loop, current divider, Class A/B/AB/D amplifiers, Schmitt trigger (hysteresis), emitter follower, transistor inverter, astable and monostable multivibrators, 555 tone maker, night light, heat alarm, Zener regulator, bulb surge, motor spin-up, relay with flyback diode, diode clipper, RC high-pass, coil current.
- **Experimenters' Workbook** PDF: 41 experiments with screenshots, difficulty badges, answers and 6 challenges, plus a "three rules" page (Ohm, Kirchhoff, series and parallel dividing) (`tools/make_workbook.py`).
- Workbook "Part 1: The fundamentals": 10 sections (what electricity is, the water picture, waterjet vs waterfall, why sparks jump, power and heat, AC/DC, capacitors and coils, diodes/transistors/op-amps, reading diagrams, limits of the analogy).
- Renamed "Knob" to "Volume knob" and its middle leg to "middle contact".
- Fixed workbook pictures that went missing (file-name mismatch).
- New safety warnings: Zener power, lamp over-current, motor stall, transistor over-voltage.
- Scope draws min/max bands when a very fast signal has many more raw points than pixels, so spikes show.
- Not built yet (asked for, deferred): live mode, Bode sweep, SoloTrace export, in-browser WebAssembly engine.

## 0.3.3-wip

- Charge bars: a 5-segment battery-style bar hangs under every capacitor (charge) and N-MOSFET (gate voltage) while a result is shown. It is joined to its part by a dotted tether, carries the part's name ("C1 charge", "M1 gate") and takes its colour; it moves out of the way of wires and other parts, and animates with Play and the scope scrub. The MOSFET bar has a tick at the 2.1 V threshold and turns green with "ON" once the gate passes it.

## 0.3.2-wip

- Renamed from "Sim Sala Bim" to **Spicey Electrons** (folder, package, launchers, docs).
- Added the chilli-in-orbits artwork: README banner, app logo, favicon, PDF cover.
- Screenshots retaken with the new name.

## [0.3.1-wip] - 2026-11-18

Bug sweep.

### Fixed
- Gates had no real delay: their output capacitor sat across an ideal source. Now about 10 ns, like 74HC.
- A circuit made only of gates was refused ("nothing is powering the circuit") and then crashed
  looking for a ground; gates now count as powered.
- A ring of NOT gates never started (it balanced at half the supply). Gates now power up in
  alternate states with slightly different delays, so odd rings oscillate and even rings lock, as in real life.
- No burn-out warning for a shorted 555 output, a 555 above 16 V or wired backwards, or a gate
  driving an LED with no resistor. All four now warn.
- Loading a damaged or hand-edited file, or a damaged remembered circuit, could break the drawing
  (and the app on every start). Loads are now cleaned: unknown parts dropped with a message, missing
  settings filled in (older files had "undefined" in the new MOSFET fields), bad wires and probes removed.
- Turned transistors and 555s: names sat on top of the symbol and the 555's writing went sideways.

### Added
- Example: Ring oscillator (3 NOT gates).
- 3 regression tests (42 in all).

## [0.3.0-wip] - 2026-11-18

### Added
- **555 timer** (behavioural model: comparators at 1/3 and 2/3 of the supply, latch, 20 Ω discharge switch).
- **Logic gates**: NOT, AND, NAND, OR, NOR, XOR with a chosen high level (3.3, 5, 9, 12 V).
- MOSFET pin capacitances (gate-source, gate-drain "Miller", drain-source) as editable fields.
- More **Show** choices (2 µs, 5 µs, 20 µs, 5 ms).
- Examples: 555 LED flasher, 555 one-shot timer, Two-transistor LED flasher, Common-emitter amplifier,
  MOSFET Miller plateau, MOSFET false turn-on (Miller kick), Logic gates: half adder.
- Tests: 555 rate and pulse width, gate truth tables, Miller kick (39 tests in all).

### Changed
- The 2N7000 model no longer uses SPICE's per-width capacitance guesses (they came to a few femtofarads);
  real Ciss/Crss-like capacitors are added instead.

## [0.2.0-wip] - 2026-11-18

### Added
- **Transformer** part (SPICE coupled inductors): turns ratio, primary coil, coupling, winding
  resistance, dots. Ratio limited to 0.001 to 1000, coupling clamped to 0.01 to 0.9999.
- **From** (scope delay) and more **Show** choices down to 0.1 µs.
- Fast circuits: time step chosen from the fastest source or coil-capacitor resonance
  (40 steps per cycle); capped at 800,000 steps with a plain-English note.
- Binary raw output from ngspice (about 70x less data than text), min/max **envelope bands** on the
  scope, **frequency probe** (Hz button) with average in the legend.
- Examples: Ringing coil + capacitor (RLC), Transformer power supply, Joule thief, FM bug.
- `tests/test_reactive.py`: transformer ratio, dots and DC blocking, RLC ring frequency, Joule thief,
  FM bug carrier and deviation, and robustness tests (15 new tests; 35 in all).

### Fixed
- A 1e30 Ω resistor reported "81 MW, would smoke" from numerical noise; currents below 1 nA are ignored.
- Two parts with the same name produced a raw SPICE error; now a plain message.
- Malformed requests (wrong types, text where numbers belong, absurd temperature or time) gave
  "Internal error"; each now gets a friendly message.
- Source warnings said "battery" for signal generators.
- The "very fast parts" note was shown when the real cause was a long delay with a deep zoom.

## [0.1.0-wip] - 2026-11-18

First build. Project started 2026-11-18 14:12.

### Added
- Browser editor (`src/spiceyelectrons/web/`): grouped parts panel with preview, click or drag to place,
  R to turn, drag from a leg to draw L-shaped wires, click-click wire tool, T-joints with dots,
  move parts with attached wires, erase tool, right-click menus, undo, zoom and pan, touch-friendly
  pointer handling, autosave in the browser, save/open files.
- 15 part types: battery, sine wave maker, square clock, ground, resistor, capacitor, coil, pot,
  switch, diode (1N4148/1N4007), LED (5 colours), NPN (2N3904/2N2222), PNP (2N3906),
  N-MOSFET (2N7000), op-amp.
- ngspice engine (`netlist.py`, `runner.py`): beginner checks with plain-English errors that name the
  part and leg, automatic ground, hidden ammeters so every current comes back from one run, battery
  switch-on ramp, source and coil resistances, `rshunt`, automatic run length, temperature
  0 / 20 / 40 °C.
- Scope: up to 6 voltage and current probes, separate V and A axes with tidy ticks, draggable time
  cursor, slow-motion play, values at the cursor and peak values in the legend.
- Live board: wires coloured by voltage, LEDs glow with their current, hover tooltips, unconnected
  legs shown in red.
- Safety warnings: LED over-current, resistor heat (0.25 W) and smoke (1 W), short-circuited
  sources, transistor and diode ratings. Steady-state based, so normal switch-on surges aren't
  flagged.
- Runs ngspice as a separate process with a heartbeat (time, CPU, memory), a Stop button and a
  2-minute limit; crashes and hangs are reported, not fatal.
- 7 examples, double-click launchers for Linux, Mac and Windows (they offer to install ngspice),
  20 tests, PDF manual, research notes.

### Fixed during development
- LED forward voltage rose with temperature (silicon band gap); now falls about 2 mV/°C like a real
  LED.
- Scope canvas grew on every redraw; scope axis showed odd ticks like "-50 µV".

### Tested
- For real: Linux (Ubuntu 24.04), ngspice 42, Google Chrome via Playwright: all examples, building
  an LED circuit with the mouse, probes, temperature switch, value edits with auto re-run, dangling
  legs, the Linux launcher (`--version`), all 20 tests.
- **Not run:** Windows and Mac launchers, a real 7th-gen Core i3, Firefox/Safari, touchscreen use.
