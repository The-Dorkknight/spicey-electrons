#!/usr/bin/env python3
# Required Notice: Copyright Matthew Armstrong (https://github.com/The-Dorkknight)
# Licensed under the PolyForm Noncommercial License 1.0.0. No warranty.
"""Take one small screenshot of every built-in example (used by the workbook PDF).

    python3 tools/shoot_examples.py          (needs the app running on 127.0.0.1:8765, playwright, pillow)
Set SE_CHROME=/path/to/chrome to use an installed Chrome.
"""
import asyncio, os, re, sys
from playwright.async_api import async_playwright
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT = os.path.join(ROOT, "docs", "images", "ex")


def slug(name):
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:40]


async def main():
    os.makedirs(OUT, exist_ok=True)
    async with async_playwright() as p:
        kw = {"args": ["--no-sandbox"]}
        if os.environ.get("SE_CHROME"):
            kw["executable_path"] = os.environ["SE_CHROME"]
        b = await p.chromium.launch(**kw)
        pg = await b.new_page(viewport={"width": 1360, "height": 820})
        await pg.goto("http://127.0.0.1:8765/")
        await pg.evaluate("localStorage.clear()")
        await pg.reload()
        await pg.wait_for_timeout(900)
        names = await pg.eval_on_selector_all("#examples option", "o=>o.map(x=>x.value).filter(x=>x)")
        for n in names:
            await pg.select_option("#examples", n)
            await pg.wait_for_timeout(700)
            await pg.wait_for_function("document.querySelector('#busy').classList.contains('hidden')", timeout=120000)
            await pg.wait_for_timeout(500)
            if n.startswith("Heat alarm"):
                await pg.click('#tempSeg button[data-t="40"]')
                await pg.wait_for_timeout(2500)
            await pg.evaluate("(()=>{setPlaying(false); cursor=result.time.length-1; cursorF=cursor; render();})()")
            await pg.wait_for_timeout(200)
            path = os.path.join(OUT, slug(n) + ".png")
            await pg.screenshot(path=path, clip={"x": 250, "y": 90, "width": 1110, "height": 730})
            im = Image.open(path).convert("RGB")
            im = im.resize((900, round(im.height * 900 / im.width)), Image.LANCZOS)
            im.save(path[:-4] + ".jpg", "JPEG", quality=55, optimize=True, progressive=True)
            os.remove(path)
            if n.startswith("Heat alarm"):
                await pg.click('#tempSeg button[data-t="20"]')
        await b.close()
    print("shot", len(names), "examples into", OUT)

asyncio.run(main())
