# Browser regression check: playback, speed slider, scope resize, wave zoom, AC dot reversal. Needs the server on :8765 and playwright.
import asyncio
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path="/usr/bin/google-chrome",args=["--no-sandbox"])
        pg=await b.new_page(viewport={"width":1360,"height":820}); errs=[]
        pg.on("pageerror",lambda e:errs.append(str(e))); pg.on("console",lambda m: errs.append("C:"+m.text) if m.type=="error" else None)
        await pg.goto("http://127.0.0.1:8765/"); await pg.evaluate("localStorage.clear()"); await pg.reload(); await pg.wait_for_timeout(800)
        async def load(n):
            await pg.select_option("#examples",n); await pg.wait_for_timeout(600)
            await pg.wait_for_function("document.querySelector('#busy').classList.contains('hidden')",timeout=90000); await pg.wait_for_timeout(300)
        await load("Capacitor charging (watch the voltage curve)" if False else [x for x in await pg.eval_on_selector_all("#examples option","o=>o.map(x=>x.value)") if x.startswith("Capacitor")][0])
        c1=await pg.evaluate("cursor"); await pg.wait_for_timeout(1200); c2=await pg.evaluate("cursor")
        print("playing advances:",c1,"->",c2,"len",await pg.evaluate("result.time.length"))
        bar1=await pg.evaluate("document.querySelector('#layerParts, #parts') ? 0:0")
        await pg.fill("#speed","6") if False else await pg.evaluate("(()=>{const s=document.querySelector('#speed');s.value=6;s.dispatchEvent(new Event('input'))})()")
        print("speed label",await pg.inner_text("#speedLbl"))
        # resize
        g=await pg.query_selector("#scopeGrip"); bb=await g.bounding_box(); h0=(await (await pg.query_selector("#scopeWrap")).bounding_box())["height"]
        await pg.mouse.move(bb["x"]+bb["width"]/2,bb["y"]+4); await pg.mouse.down(); await pg.mouse.move(bb["x"]+bb["width"]/2,bb["y"]-150,steps=5); await pg.mouse.up()
        h1=(await (await pg.query_selector("#scopeWrap")).bounding_box())["height"]; print("scope height",h0,"->",h1)
        # AC dots reverse: FM bug / transformer
        names=await pg.eval_on_selector_all("#examples option","o=>o.map(x=>x.value)")
        for key in ("Transformer","FM bug","Rectifier"):
            n=[x for x in names if x.startswith(key)][0]; await load(n)
            await pg.evaluate("(()=>{const s=document.querySelector('#speed');s.value=0;s.dispatchEvent(new Event('input'))})()")
            signs=set()
            for i in range(14):
                await pg.wait_for_timeout(180)
                signs.add(await pg.evaluate("flowItems.length? Math.sign(flowItems[0].speed):0"))
            print(key,"dot directions seen:",sorted(signs),"flow items",await pg.evaluate("flowItems.length"))
            # waves
            for w in ("2","10","0"):
                await pg.click(f'#waveSeg button[data-w="{w}"]'); await pg.wait_for_timeout(500)
                try: await pg.wait_for_function("document.querySelector('#busy').classList.contains('hidden')",timeout=90000)
                except: print("timeout")
                print("  waves",w,"show",await pg.evaluate("$('#duration').value"),"from",await pg.evaluate("$('#from').value"),"on:",await pg.evaluate("[...document.querySelectorAll('#waveSeg .on')].map(x=>x.textContent)"),"msg:",(await pg.inner_text("#messages"))[:90].replace("\n"," "))
        await pg.screenshot(path="/tmp/ui.png"); print("errors:",errs[:5]); await b.close()
asyncio.run(main())
