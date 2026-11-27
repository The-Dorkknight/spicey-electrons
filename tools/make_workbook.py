#!/usr/bin/env python3
# Required Notice: Copyright Matthew Armstrong (https://github.com/The-Dorkknight)
# Licensed under the PolyForm Noncommercial License 1.0.0. No warranty.
"""Build the Experimenters' Workbook PDF (a fun, low-jargon guide + exercise book).

    pip install reportlab pillow
    python3 tools/make_workbook.py [--out docs/SpiceyElectrons-workbook.pdf]

Needs docs/images/ex/*.jpg (made by tools/shoot_examples.py) and tools/workbook_content.py.
"""
import argparse
import datetime
import os
import re
import sys

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.graphics.shapes import Drawing, Line, Polygon, Rect, String
from reportlab.platypus import (BaseDocTemplate, Frame, Image, KeepTogether, PageBreak, PageTemplate,
                                Paragraph, Spacer, Table, TableStyle)

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(ROOT, "src"))
sys.path.insert(0, os.path.dirname(__file__))
from spiceyelectrons import __version__  # noqa: E402
import workbook_content as W  # noqa: E402

FD = "/usr/share/fonts/truetype/dejavu/"
pdfmetrics.registerFont(TTFont("B", FD + "DejaVuSans.ttf"))
pdfmetrics.registerFont(TTFont("BB", FD + "DejaVuSans-Bold.ttf"))
pdfmetrics.registerFont(TTFont("BI", FD + "DejaVuSans-Oblique.ttf"))
pdfmetrics.registerFontFamily("B", normal="B", bold="BB", italic="BI", boldItalic="BB")

ORANGE, YELLOW, BLUE, GREEN, PINK, INK = (colors.HexColor(c) for c in
    ("#ff7a1a", "#ffd23f", "#2f80ed", "#27ae60", "#e84a8a", "#222639"))
LEVELS = {1: ("Easy", GREEN), 2: ("Thinking cap", BLUE), 3: ("Brain-bender", PINK)}
EMOJI = re.compile("[\U0001F300-\U0001FAFF☀-➿️]")


def esc(t):
    t = EMOJI.sub("", t)
    return t.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def st(name, **kw):
    base = dict(fontName="B", fontSize=10.5, leading=15, textColor=INK)
    base.update(kw)
    return ParagraphStyle(name, **base)


S = dict(
    body=st("body"), small=st("small", fontSize=8.5, leading=11.5, textColor=colors.HexColor("#555a70")),
    h1=st("h1", fontName="BB", fontSize=24, leading=28, textColor=ORANGE, spaceAfter=6),
    h2=st("h2", fontName="BB", fontSize=15, leading=19, textColor=INK, spaceBefore=4, spaceAfter=3),
    lab=st("lab", fontName="BB", fontSize=9, leading=12, textColor=BLUE, spaceBefore=6),
    q=st("q", leftIndent=14, bulletIndent=0, spaceAfter=3),
    ans=st("ans", fontSize=9.5, leading=13, leftIndent=14, bulletIndent=0, spaceAfter=2),
    cover=st("cover", fontName="BB", fontSize=40, leading=44, textColor=colors.white, alignment=TA_CENTER),
    coversub=st("coversub", fontSize=15, leading=21, textColor=colors.white, alignment=TA_CENTER),
)

GOLDEN = [
    ("Start small.", "Change ONE thing, run it, look. If you change five things you won't know which one did it."),
    ("Guess first.", "Before you press Run, say out loud what you expect. Being wrong is the fun part: that's where the learning is."),
    ("Probes are your eyes.", "Clip a probe on a wire and the scope shows its voltage. Press Probe, then click a part to see its current."),
    ("Warnings are friends.", "If the app shows a flame or a warning, something would have got hot, bang or burn in real life. Find out why."),
    ("Break things (here).", "Nothing in here can hurt you or your wallet. Delete a part, make a resistor tiny, wire it backwards. Then try to explain what happened."),
    ("Real life is stricter.", "A simulator is a very good guess, not the truth. Before building one for real, use real parts rated for the job and ask a grown-up about mains power. Never experiment with wall sockets."),
]
GLOSSARY = [
    ("Voltage (V)", "How hard the battery pushes. Like water pressure."),
    ("Current (A)", "How much charge flows each second. Like how much water comes out of the pipe."),
    ("Resistance (Ω)", "How much something holds the flow back. A narrow pipe."),
    ("Ground", "The 0 V reference everything is measured from. Like sea level."),
    ("Capacitor", "A tiny rechargeable battery that charges and discharges very quickly."),
    ("Coil (inductor)", "Wire wound up so it stores energy as magnetism and hates sudden changes in current."),
    ("Diode / LED", "A one-way gate for current. An LED is a diode that glows."),
    ("Transistor", "A tap with an electric handle: a tiny current controls a big one."),
    ("Op-amp", "A very sensitive comparer-and-amplifier chip with two inputs and one output."),
    ("Oscillator", "A circuit that keeps going up and down by itself: a heartbeat."),
    ("Hysteresis", "Having two switching points, so it doesn't flicker. A thermostat that switches on at 20 °C and off at 22 °C."),
    ("PWM", "Pulse-width modulation: switching on and off very fast and varying how long it stays on."),
]
UNITS = "k = ×1000 (1 kΩ = 1000 Ω)   ·   M = ×1,000,000   ·   m = ÷1000   ·   µ = ÷1,000,000   ·   n = ÷1,000,000,000   ·   p = a millionth of a millionth"


def slug(name):
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:40]


def band(canvas, doc):
    canvas.saveState()
    w, h = A4
    if doc.page > 1:
        canvas.setFillColor(ORANGE)
        canvas.rect(0, h - 9 * mm, w, 9 * mm, stroke=0, fill=1)
        canvas.setFillColor(YELLOW)
        canvas.rect(0, h - 9 * mm, 40 * mm, 9 * mm, stroke=0, fill=1)
        canvas.setFillColor(INK)
        canvas.setFont("BB", 8)
        canvas.drawString(8 * mm, h - 6.2 * mm, "SPICEY ELECTRONS")
        canvas.setFillColor(colors.white)
        canvas.drawRightString(w - 8 * mm, h - 6.2 * mm, "The Experimenters' Workbook")
        canvas.setFillColor(colors.HexColor("#555a70"))
        canvas.setFont("B", 8)
        canvas.drawCentredString(w / 2, 8 * mm, str(doc.page))
    canvas.restoreState()


def cover_page(c, doc):
    w, h = A4
    c.saveState()
    c.setFillColor(colors.HexColor("#1d2033"))
    c.rect(0, 0, w, h, stroke=0, fill=1)
    for i, col in enumerate((ORANGE, YELLOW, BLUE, GREEN, PINK)):
        c.setFillColor(col)
        c.rect(0, h - (14 + 5 * i) * mm, w, 5 * mm, stroke=0, fill=1)
    art = os.path.join(ROOT, "docs", "images", "artwork.webp")
    if os.path.exists(art):
        from PIL import Image as PI
        tmp = "/tmp/_art.jpg"
        PI.open(art).convert("RGB").save(tmp, quality=80)
        iw, ih = PI.open(tmp).size
        tw = w - 70 * mm
        c.drawImage(tmp, 35 * mm, 82 * mm, tw, tw * ih / iw, preserveAspectRatio=True, anchor="s")
    c.restoreState()


def _lbl(d, x, y, t, size=10, col=INK, bold=True, anchor="middle"):
    d.add(String(x, y, t, fontName="BB" if bold else "B", fontSize=size, fillColor=col, textAnchor=anchor))


def _res(d, x, y, w=34, h=12, col=ORANGE, name=""):
    d.add(Rect(x, y - h / 2, w, h, fillColor=col, strokeColor=INK, strokeWidth=1))
    _lbl(d, x + w / 2, y - 3.5, name, 8, colors.white)


def ohm_triangle(width):
    d = Drawing(width, 150)
    cx = 80
    d.add(Polygon([cx - 60, 15, cx + 60, 15, cx, 125], fillColor=colors.HexColor("#fff6dd"), strokeColor=INK, strokeWidth=1.5))
    d.add(Line(cx - 38, 62, cx + 38, 62, strokeColor=INK, strokeWidth=1.5))
    d.add(Line(cx, 62, cx, 15, strokeColor=INK, strokeWidth=1.5))
    _lbl(d, cx, 78, "V", 22, ORANGE)
    _lbl(d, cx - 28, 30, "I", 22, BLUE)
    _lbl(d, cx + 28, 30, "R", 22, GREEN)
    x0 = 170
    for i, (a, b) in enumerate((("V = I × R", "volts = amps × ohms"), ("I = V ÷ R", "amps = volts ÷ ohms"), ("R = V ÷ I", "ohms = volts ÷ amps"))):
        _lbl(d, x0, 105 - i * 38, a, 15, INK, True, "start")
        _lbl(d, x0, 91 - i * 38, b, 8.5, colors.HexColor("#555a70"), False, "start")
    return d


def series_diagram(width):
    d = Drawing(width, 95)
    d.add(Line(10, 50, 30, 50, strokeColor=INK))
    _res(d, 30, 50, name="R1"); d.add(Line(64, 50, 84, 50, strokeColor=INK))
    _res(d, 84, 50, col=BLUE, name="R2"); d.add(Line(118, 50, 138, 50, strokeColor=INK))
    _lbl(d, 74, 75, "SERIES: one road, same current everywhere", 8.5, INK, True)
    _lbl(d, 74, 25, "Voltage splits:  V1 = V × R1 ÷ (R1 + R2)", 8.5, ORANGE, True)
    _lbl(d, 74, 10, "Resistances add:  R = R1 + R2", 8.5, GREEN, True)
    return d


def parallel_diagram(width):
    d = Drawing(width, 95)
    d.add(Line(10, 50, 40, 50, strokeColor=INK)); d.add(Line(40, 70, 40, 30, strokeColor=INK))
    for y, c, n in ((70, ORANGE, "R1"), (30, BLUE, "R2")):
        d.add(Line(40, y, 55, y, strokeColor=INK)); _res(d, 55, y, col=c, name=n); d.add(Line(89, y, 104, y, strokeColor=INK))
    d.add(Line(104, 70, 104, 30, strokeColor=INK)); d.add(Line(104, 50, 130, 50, strokeColor=INK))
    _lbl(d, 190, 70, "PARALLEL: two roads, same voltage", 8.5, INK, True, "start")
    _lbl(d, 190, 48, "Current splits:  I1 = V ÷ R1,  I2 = V ÷ R2", 8.5, ORANGE, True, "start")
    _lbl(d, 190, 26, "Currents add:  I = I1 + I2", 8.5, GREEN, True, "start")
    _lbl(d, 190, 4, "1/R = 1/R1 + 1/R2", 8.5, GREEN, True, "start")
    return d


def loop_diagram(width):
    d = Drawing(width, 130)
    # water loop: pump (battery) | tap (switch) | narrow pipe (resistor)
    d.add(Rect(30, 25, 220, 80, fillColor=None, strokeColor=BLUE, strokeWidth=7))
    d.add(Rect(30, 25, 220, 80, fillColor=None, strokeColor=colors.white, strokeWidth=2))
    d.add(Rect(18, 52, 24, 26, fillColor=ORANGE, strokeColor=INK)); _lbl(d, 30, 61, "PUMP", 6.5, colors.white)
    d.add(Rect(130, 98, 24, 14, fillColor=YELLOW, strokeColor=INK)); _lbl(d, 142, 102, "TAP", 6.5, INK)
    d.add(Rect(238, 52, 24, 26, fillColor=PINK, strokeColor=INK)); _lbl(d, 250, 61, "NARROW", 5.5, colors.white)
    _lbl(d, 30, 8, "pump = battery (voltage = pressure)", 8, ORANGE, True, "start")
    _lbl(d, 360, 100, "A loop of water pipe", 10, INK, True, "start")
    _lbl(d, 360, 84, "= a circuit of wires.", 10, INK, True, "start")
    _lbl(d, 360, 62, "Open the tap: flow stops everywhere.", 8.5, INK, False, "start")
    _lbl(d, 360, 48, "Narrower pipe: less flow for the same push.", 8.5, INK, False, "start")
    _lbl(d, 360, 34, "Stronger pump: more flow.", 8.5, INK, False, "start")
    return d


def jetfall_diagram(width):
    d = Drawing(width, 130)
    h = width / 2
    for x0, col, ttl, a, b, c in ((0, BLUE, "WATERJET", "high pressure (volts)", "tiny flow (amps)", "static spark, ignition coil, mains' sting"),
                                  (h, GREEN, "WATERFALL", "low pressure (volts)", "huge flow (amps)", "car battery, a short-circuit, welder")):
        d.add(Rect(x0 + 6, 4, h - 12, 122, fillColor=colors.HexColor("#f4f7ff"), strokeColor=col, strokeWidth=1.5))
        _lbl(d, x0 + h / 2, 108, ttl, 13, col)
        if col == BLUE:
            d.add(Line(x0 + 40, 70, x0 + h - 40, 70, strokeColor=col, strokeWidth=1.2))
            d.add(Polygon([x0 + 28, 66, x0 + 40, 70, x0 + 28, 74], fillColor=col, strokeColor=col))
        else:
            d.add(Rect(x0 + 40, 55, h - 90, 30, fillColor=col, strokeColor=col))
            d.add(Polygon([x0 + h - 50, 50, x0 + h - 30, 70, x0 + h - 50, 90], fillColor=col, strokeColor=col))
        _lbl(d, x0 + h / 2, 40, a, 8.5, INK, True)
        _lbl(d, x0 + h / 2, 28, b, 8.5, INK, True)
        _lbl(d, x0 + h / 2, 13, c, 7, colors.HexColor("#555a70"), False)
    return d


def fundamentals(doc):
    out = [Paragraph("Part 1: The fundamentals", S["h1"]),
           Paragraph("Before the experiments, here is the big picture in plain words. Read it through once, then come back whenever something puzzles you. "
                     "Experiments later in the book point back to these pages.", S["body"]), Spacer(1, 6)]
    for n, sec in enumerate(W.FUNDAMENTALS, 1):
        blk = [Paragraph("%d. %s" % (n, esc(sec["title"])), S["h2"])]
        for para in sec["paras"]:
            blk.append(Paragraph(EMOJI.sub("", para), S["body"]))
            blk.append(Spacer(1, 4))
        if sec.get("table"):
            rows = [[Paragraph("<b>%s</b>" % esc(c), st("th", fontSize=9, textColor=colors.white)) if i == 0 else Paragraph(esc(c), st("td", fontSize=9, leading=12)) for c in r]
                    for i, r in enumerate(sec["table"])]
            t = Table(rows, colWidths=[doc.width * 0.46, doc.width * 0.32, doc.width * 0.22], repeatRows=1)
            t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), BLUE),
                                   ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.HexColor("#eef4ff"), colors.white]),
                                   ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("TOPPADDING", (0, 0), (-1, -1), 3),
                                   ("BOTTOMPADDING", (0, 0), (-1, -1), 3)]))
            blk += [t, Spacer(1, 6)]
        if sec.get("diagram") == "loop":
            blk += [loop_diagram(doc.width), Spacer(1, 4)]
        if sec.get("diagram") == "jetfall":
            blk += [jetfall_diagram(doc.width), Spacer(1, 4)]
        if sec.get("see"):
            blk.append(Paragraph("<b>Try it in the app (Examples menu):</b> " + "; ".join(esc(x) for x in sec["see"]), S["small"]))
        out += [blk[0], *blk[1:]]
        out.append(Spacer(1, 8))
    out.append(PageBreak())
    return out


def cheat_sheet(doc):
    out = [Paragraph("The three rules (read me first!)", S["h1"]),
           Paragraph("Almost everything in electronics comes from three simple ideas. Think of <b>voltage as height</b> (how far downhill), "
                     "<b>current as flow</b> (how much water per second) and <b>resistance as a narrow, rocky stream</b> that slows it.", S["body"]),
           Spacer(1, 6), Paragraph("1. Ohm's law: how push, flow and resistance relate", S["h2"]), ohm_triangle(doc.width),
           Paragraph("2. Kirchhoff's voltage law (KVL): voltages round a loop add up to zero", S["h2"]),
           Paragraph("Walk round any loop and end up where you started: the height you climbed (battery) equals the height you came down "
                     "(resistors, LEDs). So the battery voltage is <i>shared out</i> between the parts in a row: "
                     "a 12 V battery with 1 kΩ, 2 kΩ and 3 kΩ in a row gives 2 V + 4 V + 6 V = 12 V.", S["body"]), series_diagram(doc.width),
           Paragraph("3. Kirchhoff's current law (KCL): current into a junction equals current out", S["h2"]),
           Paragraph("Charge can't pile up or vanish at a fork in the wire. If 13.5 mA arrives, 9 mA might go one way and 4.5 mA the other. "
                     "The easier road (smaller resistance) gets more. Turn on <b>Current dots</b> in the app and watch the dots split and rejoin.",
                     S["body"]), parallel_diagram(doc.width),
           Spacer(1, 4),
           Paragraph("<b>Quick check:</b> 9 V across 1 kΩ and 2 kΩ in a row. Current = 9 ÷ 3000 = 3 mA. Drops: 3 V and 6 V. "
                     "The same two resistors side by side: 9 mA and 4.5 mA, so 13.5 mA from the battery. Try both in the app!", S["body"]),
           PageBreak()]
    return out


def build(out):
    W.CHAPTERS[:] = [(str(i), t, b, it) for i, (_c, t, b, it) in enumerate(W.CHAPTERS, 1)]
    doc = BaseDocTemplate(out, pagesize=A4, title="Spicey Electrons - The Experimenters' Workbook",
                          author="Matthew Armstrong", leftMargin=16 * mm, rightMargin=16 * mm,
                          topMargin=18 * mm, bottomMargin=16 * mm)
    fr = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="f")
    doc.addPageTemplates([PageTemplate(id="cover", frames=[Frame(20 * mm, 10 * mm, doc.width - 8 * mm, 68 * mm)],
                                       onPage=cover_page, autoNextPageTemplate="main"),
                          PageTemplate(id="main", frames=[fr], onPage=band)])
    f = []
    f += [Paragraph("The Experimenters' Workbook", S["cover"]), Spacer(1, 4),
          Paragraph("%d experiments you can do on a screen. No soldering. No smoke. Well, a little pretend smoke." % sum(len(c[3]) for c in W.CHAPTERS),
                    S["coversub"]),
          Paragraph("Spicey Electrons and this workbook are by <b>Matthew Armstrong</b> (GitHub: The-Dorkknight)",
                    st("cvby", fontSize=11, textColor=colors.white, alignment=TA_CENTER, spaceBefore=10)),
          Paragraph("Made for Spicey Electrons v%s · free to use · for all ages" % __version__,
                    st("cv", fontSize=9, textColor=YELLOW, alignment=TA_CENTER, spaceBefore=8)),
          PageBreak()]

    f += [Paragraph("Welcome, experimenter!", S["h1"]),
          Paragraph("Electricity is invisible, which makes it hard to understand. Spicey Electrons makes it visible: "
                    "you build a circuit, press <b>Run</b>, and watch the voltages wiggle on a screen, with glowing dots showing "
                    "which way the current flows and little battery bars filling up inside capacitors. After you press Run the whole board <b>plays back in step with the scope</b>: "
                    "slide the speed control (0.1× to 10×) to slow a fast circuit right down, tick <b>loop</b> to repeat it, and use the <b>2 waves / 10 / 50 / max</b> buttons to zoom in on a few cycles. "
                    "Drag the little grip above the scope to make it taller.", S["body"]),
          Spacer(1, 6),
          Paragraph("How this book works", S["h2"]),
          Paragraph("Each experiment is one of the examples built into the app (open the <b>Examples</b> list and pick its name). "
                    "Every page has the same four parts:", S["body"]), Spacer(1, 4)]
    parts = [("THE IDEA", "What's going on, in plain words."), ("TRY THIS", "Three little jobs, from easy to cheeky."),
             ("WHY IT WORKS", "The reason, so you can use it in your own circuits."),
             ("ANSWERS", "At the back of the book. Guess first, then peek!")]
    t = Table([[Paragraph("<b>%s</b>" % a, st("x", fontSize=9, textColor=colors.white)), Paragraph(b, S["body"])]
               for a, b in parts], colWidths=[34 * mm, doc.width - 34 * mm])
    t.setStyle(TableStyle([("BACKGROUND", (0, i), (0, i), c) for i, c in enumerate((ORANGE, BLUE, GREEN, PINK))] +
                          [("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("TOPPADDING", (0, 0), (-1, -1), 5),
                           ("BOTTOMPADDING", (0, 0), (-1, -1), 5), ("LINEBELOW", (0, 0), (-1, -1), 2, colors.white)]))
    f += [t, Spacer(1, 8), Paragraph("Difficulty badges", S["h2"])]
    badges = [Paragraph('<font color="%s"><b>%s</b></font> - %s' % (c.hexval().replace("0x", "#"), n, d), S["body"])
              for (n, c), d in zip(LEVELS.values(), ("anyone can do it", "a little head-scratching", "for when you want a challenge"))]
    f += badges
    f += [Spacer(1, 8), Paragraph("The six golden rules", S["h2"])]
    for i, (a, b) in enumerate(GOLDEN, 1):
        f.append(Paragraph("<b>%d. %s</b> %s" % (i, esc(a), esc(b)), S["q"]))
    f += [Spacer(1, 8), Paragraph("Those funny little letters", S["h2"]), Paragraph(esc(UNITS), S["body"]), PageBreak()]

    f += [Paragraph("Words you'll meet", S["h1"])]
    gt = Table([[Paragraph("<b>%s</b>" % esc(a), S["body"]), Paragraph(esc(b), S["body"])] for a, b in GLOSSARY],
               colWidths=[38 * mm, doc.width - 38 * mm])
    gt.setStyle(TableStyle([("ROWBACKGROUNDS", (0, 0), (-1, -1), [colors.HexColor("#fff6dd"), colors.white]),
                            ("VALIGN", (0, 0), (-1, -1), "TOP"), ("TOPPADDING", (0, 0), (-1, -1), 5),
                            ("BOTTOMPADDING", (0, 0), (-1, -1), 5)]))
    f += [gt, Spacer(1, 10), Paragraph("Contents", S["h2"])]
    f.append(Paragraph("<b>Part 1 - The fundamentals</b> (water picture, jet vs waterfall, sparks, power, AC/DC, parts) and <b>the three rules</b>", S["body"]))
    n = 0
    for cid, ctitle, _blurb, items in W.CHAPTERS:
        f.append(Paragraph("<b>Chapter %s - %s</b> (%d experiments)" % (cid, esc(ctitle), len(items)), S["body"]))
        n += len(items)
    f += [Paragraph("<b>Challenges</b> - six open-ended jobs, no answers given", S["body"]),
          Paragraph("<b>Answer key</b> - peek only after you've had a go", S["body"]), PageBreak()]

    f += fundamentals(doc)
    f += cheat_sheet(doc)
    answers = []
    num = 0
    for cid, ctitle, blurb, items in W.CHAPTERS:
        f += [Paragraph("Chapter %s: %s" % (cid, esc(ctitle)), S["h1"]), Paragraph(esc(blurb), S["body"]), Spacer(1, 6)]
        for it in items:
            num += 1
            lname, lcol = LEVELS[it["level"]]
            head = Table([[Paragraph("<b>#%d  %s</b>" % (num, esc(it["title"])), st("hh", fontName="BB", fontSize=13, textColor=colors.white, leading=16)),
                           Paragraph("<b>%s</b>" % lname, st("lv", fontName="BB", fontSize=9, textColor=colors.white, alignment=TA_CENTER))]],
                         colWidths=[doc.width - 32 * mm, 32 * mm])
            head.setStyle(TableStyle([("BACKGROUND", (0, 0), (0, 0), INK), ("BACKGROUND", (1, 0), (1, 0), lcol),
                                      ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("TOPPADDING", (0, 0), (-1, -1), 6),
                                      ("BOTTOMPADDING", (0, 0), (-1, -1), 6)]))
            blk = [head, Paragraph("OPEN IN THE APP:  Examples → %s" % esc(it["ex"]), S["small"])]
            img = os.path.join(ROOT, "docs", "images", "ex", slug(it["ex"]) + ".jpg")
            if os.path.exists(img):
                from PIL import Image as PI
                iw, ih = PI.open(img).size
                w = doc.width * 0.95
                blk += [Spacer(1, 3), Image(img, width=w, height=w * ih / iw, hAlign="CENTER")]
            blk += [Paragraph("THE IDEA", S["lab"]), Paragraph(esc(it["idea"]), S["body"]),
                    Paragraph("TRY THIS", S["lab"])]
            for i, q in enumerate(it["tries"], 1):
                blk.append(Paragraph(esc(q), S["q"], bulletText="%d." % i))
            blk += [Paragraph("WHY IT WORKS", S["lab"]), Paragraph(esc(it["why"]), S["body"]),
                    Paragraph("My notes: ______________________________________________________________", S["small"]),
                    Spacer(1, 4)]
            f += [KeepTogether(blk[:5]), *blk[5:], PageBreak()]
            answers.append((num, it))

    f += [Paragraph("Challenges", S["h1"]),
          Paragraph("No answers for these. Build, break, fix, then show a friend. Save your circuit with the app's Save button.", S["body"]),
          Spacer(1, 8)]
    for i, (a, b) in enumerate(W.CHALLENGES, 1):
        t = Table([[Paragraph("<b>%d</b>" % i, st("cn", fontName="BB", fontSize=18, textColor=colors.white, alignment=TA_CENTER)),
                    [Paragraph("<b>%s</b>" % esc(a), S["h2"]), Paragraph(esc(b), S["body"])]]],
                  colWidths=[14 * mm, doc.width - 14 * mm])
        t.setStyle(TableStyle([("BACKGROUND", (0, 0), (0, 0), (ORANGE, BLUE, GREEN, PINK, YELLOW, INK)[i - 1]),
                               ("BOX", (0, 0), (-1, -1), 1, colors.HexColor("#cccccc")), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                               ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6)]))
        f += [t, Spacer(1, 6)]
    f.append(PageBreak())

    f += [Paragraph("Answer key", S["h1"]),
          Paragraph("Numbers may differ slightly in your copy (the app rounds, and you may have changed something). "
                    "If you are close, you've got it.", S["small"]), Spacer(1, 6)]
    for num, it in answers:
        blk = [Paragraph("<b>#%d  %s</b>" % (num, esc(it["title"])), S["h2"])]
        for i, a in enumerate(it["answers"], 1):
            blk.append(Paragraph(esc(a), S["ans"], bulletText="%d." % i))
        f += [KeepTogether(blk), Spacer(1, 3)]
    f += [PageBreak(), Paragraph("Where next?", S["h1"]),
          Paragraph("You now know more about electronics than most people ever bother to learn. To go further, build your own circuits "
                    "from the parts bin, save them, and share them. Spicey Electrons is free, works offline, and lives at "
                    "github.com/The-Dorkknight/spicey-electrons, made by Matthew Armstrong. This workbook was made %s." % datetime.date.today().isoformat(), S["body"]),
          Spacer(1, 8),
          Paragraph("Honest note: the simulator is an excellent guide, but its models are simplified. Real parts vary, real wires get hot, "
                    "and mains electricity can kill. Keep to batteries and low voltages for real-life tinkering, and ask an adult who knows.",
                    S["small"])]
    doc.build(f)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(ROOT, "docs", "SpiceyElectrons-workbook.pdf"))
    a = ap.parse_args()
    build(a.out)
    print("wrote", a.out, os.path.getsize(a.out) // 1024, "KB")
