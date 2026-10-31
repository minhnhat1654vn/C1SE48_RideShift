#!/usr/bin/env python3
"""Build RideShift docs for in-app viewing (Deliverable #12 surface).

Converts docs/*.md → public/docs/{name}.html (standalone, styled) + fragments in
public/docs/index.json consumed by src/components/rideshift/docs-viewer.tsx.
Also copies the ERD image, markdown sources and the proposal docx into public/.

Run:  python3 scripts/build_docs.py   (re-run after editing any docs/*.md)
"""
import json
import shutil
from pathlib import Path

import markdown

ROOT = Path(__file__).resolve().parent.parent.parent  # frontend/scripts → repo root
DOCS_DIR = ROOT / "docs"
OUT_DIR = ROOT / "frontend" / "public" / "docs"
DOCS = ["db", "tech-stack", "topsis", "aqi-color"]

STANDALONE_CSS = """
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #FAFBFC; color: #243447;
         font: 15px/1.7 'Segoe UI', system-ui, -apple-system, sans-serif; }
  article { max-width: 960px; margin: 0 auto; padding: 40px 24px 80px; }
  h1 { font-size: 26px; border-bottom: 2px solid #2D5F8B; padding-bottom: 10px; }
  h2 { font-size: 20px; margin-top: 36px; border-bottom: 1px solid #d8dee5; padding-bottom: 6px; }
  h3 { font-size: 16px; margin-top: 24px; }
  table { border-collapse: collapse; width: 100%; margin: 14px 0; font-size: 13.5px; }
  th, td { border: 1px solid #d8dee5; padding: 7px 10px; text-align: left; vertical-align: top; }
  th { background: #eef2f6; }
  code { background: #eef1f4; border-radius: 4px; padding: 1px 5px; font-size: 13px; }
  pre { background: #f0f3f6; border: 1px solid #dfe5ea; border-radius: 8px;
        padding: 12px 14px; overflow-x: auto; font-size: 12.5px; line-height: 1.5; }
  pre code { background: none; padding: 0; }
  blockquote { margin: 14px 0; padding: 6px 16px; border-left: 4px solid #2D5F8B;
               background: #eef2f6; border-radius: 0 8px 8px 0; }
  hr { border: none; border-top: 1px solid #d8dee5; margin: 24px 0; }
  a { color: #2D5F8B; }
  @media (prefers-color-scheme: dark) {
    body { background: #10151b; color: #dbe2ea; }
    h2, hr { border-color: #2a3542; }
    th { background: #1a222c; }
    th, td { border-color: #2a3542; }
    code, pre, blockquote { background: #1a222c; border-color: #2a3542; }
  }
"""

def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    md = markdown.Markdown(
        extensions=["tables", "fenced_code", "toc"], output_format="html5"
    )
    fragments: dict[str, str] = {}
    for name in DOCS:
        src = DOCS_DIR / f"{name}.md"
        md.reset()
        html = md.convert(src.read_text(encoding="utf-8"))
        fragments[name] = html
        page = (
            '<!doctype html><html lang="vi"><head><meta charset="utf-8">'
            f"<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">"
            f"<title>RideShift — {name}</title>"
            f"<style>{STANDALONE_CSS}</style></head>"
            f"<body><article>{html}</article></body></html>"
        )
        (OUT_DIR / f"{name}.html").write_text(page, encoding="utf-8")
        shutil.copyfile(src, OUT_DIR / f"{name}.md")
        print(f"built {name}: {len(html)} chars html")

    (OUT_DIR / "index.json").write_text(
        json.dumps(fragments, ensure_ascii=False), encoding="utf-8"
    )

    # assets — ERD SVG sinh tự động từ schema.sql (scripts/gen_erd_svg.py)
    # + DDL export cho ai cần xem nhanh
    import subprocess
    gen = ROOT / "scripts" / "gen_erd_svg.py"
    if gen.exists():
        subprocess.run(["python3", str(gen)], check=True)
    else:
        shutil.copyfile(DOCS_DIR / "db-erd.svg", OUT_DIR / "db-erd.svg")
    shutil.copyfile(DOCS_DIR / "db-schema.sql", OUT_DIR / "db-schema.sql")
    print("assets: db-erd.svg (auto-gen), db-schema.sql")

if __name__ == "__main__":
    main()
