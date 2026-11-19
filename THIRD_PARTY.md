# Third-party software and credits

Spicey Electrons's licence (PolyForm Noncommercial 1.0.0) covers **only Matthew Armstrong's own code**
in this repository. Everything listed here keeps its own licence. Spicey Electrons is not affiliated
with, or endorsed by, any of these projects or companies.

| What | Used for | Licence | Bundled? |
|---|---|---|---|
| [ngspice](https://ngspice.sourceforge.io/) | The simulation engine | Mostly modified BSD; see ngspice's own `COPYING` file | **No**: installed separately (the launchers help) and run as a separate program |
| Python standard library | Server and netlist builder | PSF licence | No (your Python install) |
| SPICE models for 1N4148, 1N4007, 2N3904, 2N2222, 2N3906 | Part behaviour | Published by the part manufacturers for use in simulators | Model parameter lines in `src/spiceyelectrons/parts.py` |

The 2N7000, LED and op-amp models were written for this project (simple fits, see DESIGN_NOTES.md).

## Ideas credited
- **Falstad CircuitJS** (Paul Falstad and contributors, GPL-2.0) inspired the green/red wire
  colouring and the click-to-scope idea. **No code was copied** from it.
- **SoloTrace** (Matthew's own PCB designer) inspired the grouped parts panel with a sidebar preview.

Build-time only (not shipped in the app): Python-Markdown, Pillow and Playwright/Chromium make the
PDF manual (`tools/make_pdf.py`).
