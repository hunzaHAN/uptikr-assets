# -*- coding: utf-8 -*-
"""UPTIKR 카로셀 렌더러 — content JSON을 1080x1350 PNG 세트로 굽는다."""
import json, sys, os, pathlib
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib"))
from theme import frame
from slides import build
from playwright.sync_api import sync_playwright
from PIL import Image

ROOT = pathlib.Path(os.path.dirname(os.path.abspath(__file__)))
SCALE = 2  # 2x로 굽고 1080x1350으로 다운샘플 → 텍스트 엣지가 깨끗해진다

def render(content_path):
    doc = json.loads(pathlib.Path(content_path).read_text(encoding="utf-8"))
    slug = doc["slug"]
    outdir = ROOT / "out" / slug
    outdir.mkdir(parents=True, exist_ok=True)
    for old in outdir.glob("*.png"):
        old.unlink()

    slides, total = doc["slides"], len(doc["slides"])
    tmp = outdir / "_html"
    tmp.mkdir(exist_ok=True)
    paths = []

    with sync_playwright() as p:
        br = p.chromium.launch(args=["--font-render-hinting=none", "--disable-lcd-text"])
        pg = br.new_page(viewport={"width": 1080, "height": 1350}, device_scale_factor=SCALE)
        for i, s in enumerate(slides, 1):
            html = frame(build(s), doc["slot"], i, total)
            f = tmp / ("%02d.html" % i)
            f.write_text(html, encoding="utf-8")
            pg.goto(f.as_uri())
            pg.wait_for_timeout(220)
            raw = outdir / ("_raw_%02d.png" % i)
            pg.screenshot(path=str(raw))
            out = outdir / ("%s_%02d.png" % (slug, i))
            Image.open(raw).convert("RGB").resize((1080, 1350), Image.LANCZOS).save(
                out, "JPEG" if out.suffix == ".jpg" else "PNG", optimize=True)
            raw.unlink()
            paths.append(str(out))
            print("  slide %02d/%02d  %s" % (i, total, out.name))
        br.close()

    (outdir / "caption.txt").write_text(doc.get("caption", ""), encoding="utf-8")
    print("\n%d장 완료 → %s" % (total, outdir))
    return paths

if __name__ == "__main__":
    render(sys.argv[1])
