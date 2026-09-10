#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""그려낸 카드를 깃허브에 올리고 발행 지시서를 inbox에 넣는다.

맥미니는 5분마다 inbox를 확인해 지시서를 가져가고, 그 주소로 인스타그램에 발행한다.
맥미니는 렌더링을 하지 않으므로 부하가 없다.

사용법:  UPTIKR_GH_TOKEN='...' python3 pushmedia.py <slug>
         (out/<slug>/ 안의 PNG와 caption.txt 를 읽는다)
"""
import sys, os, json, time, base64, pathlib, urllib.request, urllib.error

REPO = "hunzaHAN/uptikr-assets"
ROOT = pathlib.Path(__file__).resolve().parent
if not (ROOT / "out").exists() and (ROOT.parent / "out").exists():
    ROOT = ROOT.parent

def api(url, tok, payload=None, method=None, retries=3):
    hdr = {"Authorization": "Bearer " + tok,
           "Accept": "application/vnd.github+json",
           "User-Agent": "uptikr-push"}
    body = None
    if payload is not None:
        body = json.dumps(payload).encode()
        hdr["Content-Type"] = "application/json"
    last = ""
    for i in range(retries):
        try:
            req = urllib.request.Request(url, data=body, headers=hdr, method=method)
            with urllib.request.urlopen(req, timeout=90) as r:
                raw = r.read().decode()
                return json.loads(raw) if raw.strip() else {}
        except urllib.error.HTTPError as ex:
            detail = ex.read().decode()[:300]
            if ex.code == 404 and method in (None, "GET"):
                return None
            last = "HTTP %s %s" % (ex.code, detail)
            if ex.code == 422:
                return {"_conflict": True}
        except Exception as ex:
            last = type(ex).__name__
        time.sleep(3 * (i + 1))
    raise RuntimeError(last)

def put_file(tok, remote, data: bytes, msg):
    url = "https://api.github.com/repos/%s/contents/%s" % (REPO, remote)
    cur = api(url, tok)
    payload = {"message": msg, "content": base64.b64encode(data).decode()}
    if isinstance(cur, dict) and cur.get("sha"):
        payload["sha"] = cur["sha"]
    api(url, tok, payload, "PUT")
    return "https://raw.githubusercontent.com/%s/main/%s" % (REPO, remote)

def main():
    tok = os.environ.get("UPTIKR_GH_TOKEN", "").strip()
    if not tok:
        sys.exit("UPTIKR_GH_TOKEN 환경변수가 없습니다.")
    if len(sys.argv) < 2:
        sys.exit("사용법: python3 pushmedia.py <slug>")

    slug = sys.argv[1].strip().rstrip("/")
    made = ROOT / "out" / slug
    pngs = sorted(made.glob("%s_*.png" % slug))
    if not pngs:
        sys.exit("out/%s 안에 PNG가 없습니다. render.py 를 먼저 실행하세요." % slug)
    if len(pngs) > 10:
        pngs = pngs[:10]

    cap_path = made / "caption.txt"
    caption = cap_path.read_text(encoding="utf-8").strip() if cap_path.exists() else ""
    if not caption:
        sys.exit("caption.txt 가 비어 있습니다.")

    urls = []
    for p in pngs:
        u = put_file(tok, "carousel/%s/%s" % (slug, p.name), p.read_bytes(), "card %s" % p.name)
        urls.append(u)
        print("  올림 %s" % p.name, flush=True)

    time.sleep(3)  # raw 반영 대기
    manifest = {"slug": slug, "images": urls, "caption": caption,
                "created": time.strftime("%Y-%m-%d %H:%M:%S")}
    put_file(tok, "inbox/%s.json" % slug,
             json.dumps(manifest, ensure_ascii=False, indent=1).encode(),
             "inbox %s" % slug)
    print("발행 지시서 전달 완료: inbox/%s.json (%d장)" % (slug, len(urls)))

if __name__ == "__main__":
    main()
