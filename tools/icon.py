# Saves the app icon (1024 x 1024), the website icons and the launch image (2732 x 2732) from tools/icon.html.
# Serve the repo first: python3 -m http.server 8771, then: python3 tools/icon.py
import asyncio
from playwright.async_api import async_playwright
from PIL import Image
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        for name, q, n in (("ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png", "", 1024), ("/tmp/splash.png", "?splash", 2732)):
            pg = await b.new_page(viewport={"width": n, "height": n})
            await pg.goto("http://localhost:8771/tools/icon.html" + q); await pg.wait_for_timeout(300)
            await pg.screenshot(path=name, clip={"x": 0, "y": 0, "width": n, "height": n})
            await pg.close()
        await b.close()
    icon = Image.open("ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png").convert("RGB")
    icon.save("ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png")
    for size, out in ((512, "icons/icon-512.png"), (180, "icons/apple-touch-icon.png"), (32, "icons/favicon-32.png")):
        icon.resize((size, size), Image.LANCZOS).save(out)
    splash = Image.open("/tmp/splash.png").convert("RGB")
    for f in ("splash-2732x2732.png", "splash-2732x2732-1.png", "splash-2732x2732-2.png"):
        splash.save("ios/App/App/Assets.xcassets/Splash.imageset/" + f)
asyncio.run(main())
