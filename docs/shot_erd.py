import sys
from playwright.sync_api import sync_playwright

HTML = "file:///home/z/my-project/docs/db-erd.html"
OUT = sys.argv[1] if len(sys.argv) > 1 else "/home/z/my-project/docs/db-erd.png"

with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={"width": 2200, "height": 1880}, device_scale_factor=2)
    page.goto(HTML)
    page.wait_for_timeout(400)
    page.screenshot(path=OUT, clip={"x": 0, "y": 0, "width": 2200, "height": 1880})
    b.close()
print("saved", OUT)
