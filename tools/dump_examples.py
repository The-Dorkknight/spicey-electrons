"""Dump every built-in example as a circuit JSON plus the netlist the Python reference builds for it.
These fixtures are the 'golden' answers the browser (JavaScript) port must match exactly."""
import asyncio, json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
from playwright.async_api import async_playwright
from spiceyelectrons.netlist import build, CircuitError
OUT = os.path.join(os.path.dirname(__file__), "..", "tests", "golden")
async def main():
    os.makedirs(OUT, exist_ok=True)
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
        pg = await b.new_page()
        await pg.route("**/api/simulate", lambda r: r.abort())
        await pg.goto("http://127.0.0.1:8765/"); await pg.evaluate("localStorage.clear()"); await pg.reload(); await pg.wait_for_timeout(800)
        names = await pg.eval_on_selector_all("#examples option", "o=>o.map(x=>x.value).filter(x=>x)")
        idx = {}
        for i, n in enumerate(names):
            await pg.select_option("#examples", n); await pg.wait_for_timeout(150)
            circ = await pg.evaluate("""(()=>{nets=computeNets();return {parts:S.parts.map(p=>({id:p.id,type:p.type,nodes:nets.partNodes[p.id],props:p.props})),temp,duration:$("#duration").value?+$("#duration").value:null,start:+$("#from").value||0}})()""")
            slug = "%02d" % i
            try:
                text, meta = build(dict(circ))
                err = None
            except CircuitError as e:
                text, meta, err = "", {}, str(e)
            json.dump({"name": n, "circuit": circ}, open(f"{OUT}/{slug}.circuit.json", "w"), indent=1)
            json.dump({"netlist": text, "meta": meta, "error": err}, open(f"{OUT}/{slug}.golden.json", "w"), indent=1, default=str)
            idx[slug] = n
        json.dump(idx, open(f"{OUT}/index.json", "w"), indent=1)
        print(len(names), "examples dumped")
        await b.close()
asyncio.run(main())
