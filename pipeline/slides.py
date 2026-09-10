# -*- coding: utf-8 -*-
"""슬라이드 타입별 HTML 빌더"""
from html import escape as _e

def _rich(s):
    """<b>, <em> 만 허용하는 간이 마크업"""
    return (_e(s or "").replace("&lt;b&gt;", "<b>").replace("&lt;/b&gt;", "</b>")
            .replace("&lt;em&gt;", "<em>").replace("&lt;/em&gt;", "</em>")
            .replace("&lt;br&gt;", "<br>")
            .replace("&#x27;", "'"))

def _eyebrow(t, plain=False, amber=False):
    if not t:
        return ""
    cls = "eyebrow amber" if amber else ("eyebrow plain" if plain else "eyebrow")
    return '<div class="%s">%s</div>' % (cls, _rich(t))

def _note(n):
    if not n:
        return ""
    return ('<div class="note"><div class="note-t">%s</div>'
            '<div class="note-b">%s</div></div>') % (_rich(n.get("label", "짚고 갈 것")), _rich(n["body"]))

def _split(items):
    if not items:
        return ""
    cards = "".join(
        '<div class="sc %s"><div class="sc-l">%s</div>'
        '<div class="sc-v %s">%s</div><div class="sc-s">%s</div></div>'
        % (i.get("dir", ""), _rich(i["label"]), i.get("dir", ""),
           _rich(i["value"]), _rich(i.get("sub", "")))
        for i in items)
    return '<div class="split">%s</div>' % cards

def cover(s):
    return (_eyebrow(s.get("eyebrow")) +
            _split(s.get("split")) +
            '<div class="sp"></div>' +
            '<h1>%s</h1>' % _rich(s["title"]) +
            '<div class="gap-m"></div>' +
            '<div class="lead">%s</div>' % _rich(s.get("lead", "")) +
            '<div class="gap-l"></div>')

def indices(s):
    rows = ""
    for r in s["rows"]:
        rows += (
            '<div class="row%s"><div class="r-l">'
            '<div class="r-nm">%s</div><div class="r-sub">%s</div></div>'
            '<div class="r-r"><div class="r-vl">%s</div>'
            '<div class="r-ch %s">%s</div></div></div>'
        ) % (" hero" if r.get("hero") else "", _rich(r["name"]), _rich(r.get("sub", "")),
             _rich(r["value"]), r.get("dir", "fl"), _rich(r.get("change", "")))
    return (_eyebrow(s.get("eyebrow"), plain=True) +
            '<h2>%s</h2>' % _rich(s["title"]) +
            '<div class="gap-m"></div>' +
            '<div class="rows%s">%s</div>' % (" big" if s.get("big") else "", rows) +
            '<div class="sp"></div>' + _note(s.get("note")))

def _stat(items):
    if not items:
        return ""
    cards = "".join('<div class="st"><div class="st-v">%s</div>'
                    '<div class="st-l">%s</div></div>'
                    % (_rich(i["value"]), _rich(i["label"])) for i in items)
    return '<div class="gap-l"></div><div class="stat">%s</div>' % cards

def point(s):
    return (_eyebrow(s.get("eyebrow")) +
            '<h2>%s</h2>' % _rich(s["title"]) +
            '<div class="gap-m"></div>' +
            '<div class="lead">%s</div>' % _rich(s.get("lead", "")) +
            _stat(s.get("stat")) +
            '<div class="sp"></div>' + _note(s.get("note")))

def bignum(s):
    return (_eyebrow(s.get("eyebrow")) +
            '<h2>%s</h2>' % _rich(s["title"]) +
            '<div class="gap-l"></div>' +
            '<div class="big"><div class="big-n %s">%s</div>'
            '<div class="big-u">%s</div></div>' % (s.get("dir", ""), _rich(s["num"]), _rich(s.get("unit", ""))) +
            '<div class="gap-m"></div>' +
            '<div class="lead">%s</div>' % _rich(s.get("lead", "")) +
            _stat(s.get("stat")) +
            '<div class="sp"></div>' + _note(s.get("note")))

def checklist(s):
    items = ""
    for it in s["items"]:
        items += ('<div class="li"><div class="li-d">%s</div><div class="li-x">'
                  '<div class="li-t">%s</div><div class="li-s">%s</div></div></div>'
                  ) % (_rich(it["tag"]), _rich(it["title"]), _rich(it.get("sub", "")))
    return (_eyebrow(s.get("eyebrow"), plain=True) +
            '<h2>%s</h2>' % _rich(s["title"]) +
            '<div class="gap-m"></div>' +
            '<div class="list">%s</div>' % items +
            '<div class="sp"></div>' + _note(s.get("note")))

def outro(s):
    srcs = "".join('<div class="src-i">· %s</div>' % _rich(x) for x in s.get("sources", []))
    return (_eyebrow(s.get("eyebrow")) +
            '<h2>%s</h2>' % _rich(s["title"]) +
            '<div class="gap-m"></div>' +
            '<div class="lead">%s</div>' % _rich(s.get("lead", "")) +
            (('<div class="gap-l"></div><div class="cta">'
              '<div class="cta-t">%s</div><div class="cta-s">%s</div></div>')
             % (_rich(s["cta"]["title"]), _rich(s["cta"].get("sub", "")))
             if s.get("cta") else "") +
            '<div class="sp"></div>' +
            '<div class="src"><div class="src-t">출처 · 1차 자료</div>%s</div>' % srcs +
            '<div class="gap-s"></div>' +
            '<div class="disc">%s</div>' % _rich(s.get("disclaimer", "")))

def talk(s):
    boxes = ""
    for i, qt in enumerate(s.get("quotes", [])):
        if i:
            boxes += '<div class="gap-s"></div>'
        boxes += ('<div class="talk"><div class="talk-t">%s</div>'
                  '<div class="talk-s">%s</div></div>'
                  ) % (_rich(qt["text"]), _rich(qt.get("source", "")))
    warn = s.get("warning", "확인된 사실이 아니라 조건이 붙은 전망입니다.")
    return (_eyebrow(s.get("eyebrow", "시장의 말"), amber=True) +
            '<h2>%s</h2>' % _rich(s["title"]) +
            '<div class="gap-m"></div>' +
            '<div class="lead">%s</div>' % _rich(s.get("lead", "")) +
            '<div class="gap-l"></div>' + boxes +
            '<div class="sp"></div>' +
            '<div class="warn"><div class="warn-i">!</div>'
            '<div class="warn-t">%s</div></div>' % _rich(warn))

def chart(s):
    """가로 막대 그래프. bars=[{name, sub, value(숫자), label}] 값은 %가 기본."""
    bars = s.get("bars") or []
    vals = []
    for b in bars:
        try:
            vals.append(float(b["value"]))
        except (KeyError, TypeError, ValueError):
            vals.append(0.0)
    span = max([abs(v) for v in vals] + [0.0001])
    diverging = min(vals) < 0 < max(vals)
    unit = s.get("unit", "%")

    rows = ""
    for b, v in zip(bars, vals):
        d = "up" if v > 0 else ("dn" if v < 0 else "fl")
        pct = abs(v) / span * (48.0 if diverging else 96.0)
        if diverging:
            side = "left:50%%; width:%.2f%%;" % pct if v >= 0 else "right:50%%; width:%.2f%%;" % pct
        else:
            side = ("right:2%%; width:%.2f%%;" % pct) if max(vals) <= 0 else ("left:2%%; width:%.2f%%;" % pct)
        zero = '<div class="cb-zero" style="left:50%;"></div>' if diverging else ""
        label = b.get("label")
        if label is None:
            label = ("%+.2f" % v).rstrip("0").rstrip(".") + unit
        sub = ('<span>%s</span>' % _rich(b["sub"])) if b.get("sub") else ""
        rows += ('<div class="cbar"><div class="cb-n">%s%s</div>'
                 '<div class="cb-track">%s<div class="cb-fill %s" style="%s"></div></div>'
                 '<div class="cb-v %s">%s</div></div>'
                 ) % (_rich(b.get("name", "")), sub, zero, d, side, d, _rich(label))

    axis = ""
    if s.get("axis"):
        a = s["axis"]
        axis = ('<div class="cb-axis"><span>%s</span><span>%s</span></div>'
                % (_rich(a.get("left", "")), _rich(a.get("right", ""))))

    lead = ('<div class="lead">%s</div><div class="gap-m"></div>' % _rich(s["lead"])) if s.get("lead") else ""
    roomy = " roomy" if len(bars) <= 4 else ""
    return (_eyebrow(s.get("eyebrow"), plain=True) +
            '<h2>%s</h2>' % _rich(s["title"]) +
            '<div class="gap-m"></div>' + lead +
            '<div class="chart%s">%s%s</div>' % (roomy, rows, axis) +
            '<div class="gap-l"></div>' + _note(s.get("note")))

BUILDERS = {"cover": cover, "talk": talk, "indices": indices,
    "chart": chart, "point": point,
            "bignum": bignum, "checklist": checklist, "outro": outro}

def build(s):
    return BUILDERS[s["type"]](s)
