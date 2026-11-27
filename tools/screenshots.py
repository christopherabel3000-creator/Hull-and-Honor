# Takes the App Store screenshots: iPhone 6.3" (1206 x 2622) and iPad 13" (2064 x 2752).
# Serve the repo first: python3 -m http.server 8772, then: python3 tools/screenshots.py appstore/screenshots
import sys, json
from playwright.sync_api import sync_playwright
OUT = sys.argv[1]
URL = "http://localhost:8772/index.html"
KEY = "hullandhonor.save.v1"

def edit(pg, js):
    pg.evaluate("(code) => { const s = JSON.parse(localStorage.getItem('%s')); (new Function('s', code))(s); localStorage.setItem('%s', JSON.stringify(s)); }" % (KEY, KEY), js)
    pg.reload(); pg.click("[data-key=continue]"); pg.wait_for_timeout(200)

with sync_playwright() as p:
    b = p.chromium.launch()
    for dev, w, h, scale in (("iphone", 402, 874, 3), ("ipad", 1032, 1376, 2)):
        ctx = b.new_context(viewport={"width": w, "height": h}, device_scale_factor=scale, color_scheme="dark", has_touch=True, is_mobile=True)
        pg = ctx.new_page(); errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.add_init_script("Math.random = (() => { let x = 12345; return () => (x = (x * 16807) % 2147483647) / 2147483647; })();")
        def shot(name, sel=None):
            if sel: pg.evaluate("(s) => { const e = document.querySelector(s); window.scrollTo(0, e.getBoundingClientRect().top + window.scrollY - 8); }", sel)
            else: pg.evaluate("window.scrollTo(0,0)")
            pg.evaluate("document.activeElement && document.activeElement.blur()"); pg.mouse.move(1, 1)
            pg.wait_for_timeout(250); pg.screenshot(path=f"{OUT}/{dev}-{name}.png")
        pg.goto(URL); pg.evaluate("localStorage.clear()"); pg.reload(); pg.wait_for_timeout(300)
        pg.fill("#f-captain", "Mara Quell"); pg.fill("#f-ship", "Second Wind"); pg.fill("#f-seed", "storefront")
        pg.click("[data-key=start]"); pg.wait_for_timeout(300)
        # A captain some way into a career
        edit(pg, """s.credits = 18450; s.day = 64; s.rep.guild = 22; s.rep.concord = 35; const c = Object.keys(s.rep.clans); s.rep.clans[c[0]] = -18; s.rep.clans[c[1]] = 12;
          s.skills.piloting.level = 4; s.skills.gunnery.level = 5; s.skills.trading.level = 3; s.skills.negotiation.level = 3; s.skills.navigation.level = 4; s.skillPoints = 1;
          s.crew.loyalty = 72; s.crew.skill = 1.18; s.notoriety = 14;""")
        # 1. Bridge with a course plotted
        opts = pg.eval_on_selector_all("#plot-select option", "o => o.map(x => x.value)")
        pg.select_option("#plot-select", opts[5]); pg.click("[data-key=plot]"); pg.wait_for_timeout(200)
        shot("01-bridge")
        # 3. Market
        pg.click("[data-key=view-market]"); pg.wait_for_timeout(150)
        pg.click("[data-key=buymax-food]"); pg.wait_for_timeout(150)
        shot("03-market", "#sec-market")
        # 4. Contracts with the Navy hero story on offer
        edit(pg, "s.arcs.navy = { status: 'offered', step: -1, data: {}, offerText: 'Admiral Rhee of the Concord Navy offers you a reserve commission, and a chance to take down a pirate lord. Commissioned captains earn 25% more from pirate bounties.' };")
        pg.click("[data-key=view-contracts]"); pg.wait_for_timeout(150)
        shot("04-contracts", "#sec-contracts")
        # 5. Captain
        pg.click("[data-key=view-captain]"); pg.wait_for_timeout(150)
        shot("05-captain", "#sec-captain")
        # 2. Combat: a pirate raider, a few turns in
        adj = pg.evaluate("(() => { const s = JSON.parse(localStorage.getItem('%s')); return s.location; })()" % KEY)
        pg.click("[data-key=view-bridge]"); pg.wait_for_timeout(100)
        dest = pg.get_attribute("#sec-travel li button", "data-arg")
        edit(pg, "s.missions.push({ id: 9001, type: 'bounty', target: 'Vex Morrow', faction: 'concord', tier: 1, origin: s.location, dest: %s, units: 0, pay: 980, deadline: s.day + 30, office: 'concord' }); s.ship.weapons = ['llaser', 'lcannon']; s.fuel = 12;" % dest)
        pg.click(f"[data-key=jump-{dest}]"); pg.wait_for_timeout(300)
        for i in range(2):
            if pg.locator("[data-key=c-turn]").count(): pg.click("[data-key=c-turn]"); pg.wait_for_timeout(150)
        pg.click("[data-key=c-target-engines]"); pg.wait_for_timeout(100)
        assert pg.locator("[data-key=c-turn]").count(), "the fight ended before the picture"
        shot("02-combat")
        print(dev, "errors:", errs)
        ctx.close()
    b.close()
