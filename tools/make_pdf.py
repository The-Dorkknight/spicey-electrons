#!/usr/bin/env python3
# Required Notice: Copyright Matthew Armstrong (https://github.com/The-Dorkknight)
# Licensed under the PolyForm Noncommercial License 1.0.0. No warranty.
"""Build the illustrated PDF manual from the repo's own documents.

    pip install markdown pillow playwright && python -m playwright install chromium
    python3 tools/make_pdf.py [--out docs/SpiceyElectrons-manual.pdf]

Set SE_CHROME=/path/to/chrome to use an installed Chrome instead of Playwright's Chromium.
"""
import argparse
import asyncio
import datetime
import html
import os
import re
import shutil
import subprocess
import sys
import tempfile

import markdown
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(ROOT, "src"))
from spiceyelectrons import __version__, __app_name__  # noqa: E402

REPO = "https://github.com/The-Dorkknight/spicey-electrons/blob/main/"
DOCS = [("README.md", "Guide"), ("HOW_IT_WORKS.md", "How it works"), ("DESIGN_NOTES.md", "Design notes and research"),
        ("CHANGELOG.md", "Changelog"), ("THIRD_PARTY.md", "Third-party software"), ("LICENSE.md", "Licence")]
ACCENT = "#2f6bff"

CSS = f"""
@page {{ size: A4; margin: 16mm 15mm 18mm 15mm; }}
body {{ font-family: 'DejaVu Sans', 'Segoe UI', Arial, sans-serif; font-size: 10pt; color: #1d2433; line-height: 1.45; }}
h1, h2, h3 {{ color: {ACCENT}; line-height: 1.2; }}
h2 {{ border-bottom: 2px solid #e2e8f5; padding-bottom: 3px; margin-top: 18px; }}
.chapter {{ page-break-before: always; }}
.chead {{ background: linear-gradient(90deg, #2f6bff, #a347ff); color: #fff; padding: 14px 18px; border-radius: 10px; margin-bottom: 10px; }}
.chead h1 {{ color: #fff; margin: 0; font-size: 22pt; }}
code {{ background: #eef3ff; padding: 1px 4px; border-radius: 4px; font-size: 9pt; }}
pre {{ background: #f2f6ff; border-left: 4px solid {ACCENT}; padding: 8px; border-radius: 6px; font-size: 7.4pt; white-space: pre-wrap; }}
pre code {{ background: none; padding: 0; }}
table {{ border-collapse: collapse; width: 100%; margin: 8px 0; font-size: 8.6pt; }}
th {{ background: {ACCENT}; color: #fff; text-align: left; padding: 4px 6px; }}
td {{ padding: 4px 6px; border-bottom: 1px solid #e2e8f5; vertical-align: top; }}
tr:nth-child(even) td {{ background: #f6f8fd; }}
blockquote {{ background: #fff7e0; border-left: 4px solid #ffb000; margin: 8px 0; padding: 6px 12px; border-radius: 6px; }}
img {{ max-width: 100%; height: auto; border-radius: 6px; box-shadow: 0 1px 6px rgba(0,0,0,.18); }}
td img {{ max-height: 65mm; }}
a {{ color: {ACCENT}; text-decoration: none; }}
.cover {{ text-align: center; padding-top: 18mm; }}
.cover h1 {{ font-size: 40pt; margin: 6mm 0 2mm; }}
.cover .pitch {{ font-size: 14pt; color: #445; }}
.pill {{ display: inline-block; background: #ff5c8a; color: #fff; border-radius: 20px; padding: 3px 12px; font-weight: bold; margin: 4mm 0; }}
.cover img.shot {{ width: 92%; margin-top: 6mm; }}
.notice {{ font-size: 8.5pt; color: #556; margin-top: 8mm; }}
.toc li {{ font-size: 12pt; margin: 4px 0; }}
"""


def small_image(src, tmp):
    """Downscaled JPEG copy so the PDF stays small."""
    name = os.path.splitext(os.path.basename(src))[0] + ".jpg"
    out = os.path.join(tmp, name)
    if not os.path.exists(out):
        im = Image.open(src)
        if im.mode in ("RGBA", "LA", "P"):
            im = im.convert("RGBA")
            bg = Image.new("RGB", im.size, "white")
            bg.paste(im, mask=im.split()[-1])
            im = bg
        else:
            im = im.convert("RGB")
        if im.width > 1000:
            im = im.resize((1000, round(im.height * 1000 / im.width)), Image.LANCZOS)
        im.save(out, "JPEG", quality=72, progressive=True, optimize=True)
    return "file://" + out


def chapter(md_file, title, idx, tmp):
    path = os.path.join(ROOT, md_file)
    text = open(path, encoding="utf-8").read()
    text = re.sub(r"(?m)\A(>.*\n)*\s*# .*\n", "", text, count=1) if md_file == "README.md" else re.sub(r"(?m)^# .*\n", "", text, count=1)
    body = markdown.markdown(text, extensions=["tables", "fenced_code", "sane_lists", "toc", "attr_list"])
    body = re.sub(r'id="([^"]+)"', lambda m: f'id="c{idx}-{m.group(1)}"', body)
    base = os.path.dirname(path)

    def img(m):
        src = m.group(1)
        if src.startswith("http"):
            return ""
        full = os.path.normpath(os.path.join(base, src))
        return m.group(0).replace(src, small_image(full, tmp)) if os.path.isfile(full) else ""
    body = re.sub(r'<img[^>]*src="([^"]+)"[^>]*>', img, body)
    names = {d[0]: i for i, d in enumerate(DOCS)}

    def link(m):
        href = m.group(1)
        if href.startswith(("http", "#", "mailto:")):
            return m.group(0)
        file = href.split("#")[0]
        if file in names:
            return f'href="#chap{names[file]}"'
        return f'href="{REPO}{file}"'
    body = re.sub(r'href="([^"]+)"', link, body)
    return f'<section class="chapter" id="chap{idx}"><div class="chead"><h1>{html.escape(title)}</h1></div>{body}</section>'


async def render(html_path, out):
    from playwright.async_api import async_playwright
    async with async_playwright() as p:
        kw = {"args": ["--no-proxy-server", "--allow-file-access-from-files", "--no-sandbox"]}
        if os.environ.get("SE_CHROME"):
            kw["executable_path"] = os.environ["SE_CHROME"]
        b = await p.chromium.launch(**kw)
        pg = await b.new_page()
        await pg.goto("file://" + html_path)
        await pg.wait_for_timeout(500)
        foot = (f'<div style="font-size:7pt;width:100%;text-align:center;color:#778">{__app_name__} {__version__} · '
                'work in progress · PolyForm Noncommercial 1.0.0 · page <span class="pageNumber"></span> / '
                '<span class="totalPages"></span></div>')
        await pg.pdf(path=out, format="A4", print_background=True, display_header_footer=True,
                     header_template="<div></div>", footer_template=foot,
                     margin={"top": "16mm", "bottom": "18mm", "left": "15mm", "right": "15mm"})
        await b.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(ROOT, "docs", "SpiceyElectrons-manual.pdf"))
    a = ap.parse_args()
    tmp = tempfile.mkdtemp(prefix="ssbpdf_")
    icon = small_image(os.path.join(ROOT, "docs", "images", "icon-512.png"), tmp)
    shot = small_image(os.path.join(ROOT, "docs", "images", "transistor-switch.webp"), tmp)
    today = datetime.date.today().isoformat()
    cover = (f'<div class="cover"><img src="{icon}" style="width:34mm;box-shadow:none"><h1>{__app_name__}</h1>'
             '<div class="pitch">A circuit simulator a 14-year-old can figure out,<br>with a real SPICE engine underneath.</div>'
             f'<div class="pill">WORK IN PROGRESS · v{__version__}</div><div>{today}</div><img class="shot" src="{shot}">'
             '<div class="notice">Copyright Matthew Armstrong (https://github.com/The-Dorkknight). Source-available under the '
             'PolyForm Noncommercial License 1.0.0. Provided as is, with no warranty and no liability. A learning tool, '
             'not a design sign-off.</div></div>')
    toc = '<section class="chapter"><div class="chead"><h1>Contents</h1></div><ol class="toc">' + \
        "".join(f'<li><a href="#chap{i}">{t}</a></li>' for i, (_, t) in enumerate(DOCS)) + "</ol></section>"
    body = cover + toc + "".join(chapter(f, t, i, tmp) for i, (f, t) in enumerate(DOCS))
    page = f'<!DOCTYPE html><html><head><meta charset="utf-8"><style>{CSS}</style></head><body>{body}</body></html>'
    hp = os.path.join(tmp, "manual.html")
    open(hp, "w", encoding="utf-8").write(page)
    raw = a.out + ".raw.pdf"
    asyncio.run(render(hp, raw))
    if shutil.which("qpdf"):
        subprocess.run(["qpdf", "--object-streams=generate", "--compress-streams=y", "--recompress-flate", raw, a.out], check=False)
        if os.path.isfile(a.out):
            os.remove(raw)
        else:
            os.replace(raw, a.out)
    else:
        os.replace(raw, a.out)
    shutil.rmtree(tmp, ignore_errors=True)
    print(f"wrote {a.out} ({os.path.getsize(a.out) / 1e6:.2f} MB)")


if __name__ == "__main__":
    main()
