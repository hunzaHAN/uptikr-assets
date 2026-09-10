# -*- coding: utf-8 -*-
"""UPTIKR 카로셀 디자인 시스템"""

W, H = 1080, 1350
PAD = 76

CSS = """
@page { margin: 0; }
* { margin:0; padding:0; box-sizing:border-box; -webkit-font-smoothing:antialiased; }
html, body { width:1080px; height:1350px; }
body {
  font-family:'Pretendard','Noto Sans CJK KR',sans-serif;
  background:#070B14; color:#fff; overflow:hidden;
  word-break:keep-all; word-wrap:break-word;
  font-feature-settings:'tnum' 1;
}
.stage { position:relative; width:1080px; height:1350px; overflow:hidden; }

/* ── 배경 레이어 ── */
.bg { position:absolute; inset:0; background:
   radial-gradient(120% 80% at 82% -8%, rgba(200,250,60,.16) 0%, rgba(200,250,60,0) 52%),
   radial-gradient(105% 75% at 8% 6%, rgba(52,96,210,.30) 0%, rgba(52,96,210,0) 58%),
   linear-gradient(168deg, #0D1425 0%, #080D19 46%, #05080F 100%); }
.grid { position:absolute; inset:0; opacity:.5;
   background-image:linear-gradient(rgba(255,255,255,.028) 1px, transparent 1px),
                    linear-gradient(90deg, rgba(255,255,255,.028) 1px, transparent 1px);
   background-size:90px 90px;
   -webkit-mask-image:radial-gradient(88% 68% at 50% 34%, #000 12%, transparent 78%); }
.vig { position:absolute; inset:0;
   background:radial-gradient(115% 88% at 50% 42%, transparent 40%, rgba(0,0,0,.62) 100%); }

/* ── 회차별 배경 (피드에 리듬을 만든다) ── */
/* 점심: 밝은 배경 + 어두운 텍스트 */
.v-noon .bg { background:
   radial-gradient(120% 74% at 86% -8%, rgba(200,250,60,.42) 0%, rgba(200,250,60,0) 46%),
   radial-gradient(108% 70% at 4% 4%, rgba(255,214,150,.34) 0%, rgba(255,214,150,0) 52%),
   linear-gradient(166deg, #FBF9F4 0%, #F4F1E9 52%, #EBE7DC 100%); }
.v-noon .grid { background-size:74px 74px; opacity:.85;
   background-image:linear-gradient(rgba(20,26,38,.045) 1px, transparent 1px),
                    linear-gradient(90deg, rgba(20,26,38,.045) 1px, transparent 1px); }
.v-noon .vig { background:radial-gradient(118% 86% at 50% 40%, transparent 52%, rgba(120,110,88,.14) 100%); }
.v-noon .wm-tx { color:#141A26; }
.v-noon .wm-dot { background:#8BB800; box-shadow:0 0 14px rgba(139,184,0,.5); }
.v-noon .slot { color:#7A8090; }
.v-noon .slot b { color:#4F7A00; }
.v-noon .pg { color:#9AA0AC; }
.v-noon .dot { background:rgba(20,26,38,.14); }
.v-noon .dot.on { background:#8BB800; }
.v-noon h1, .v-noon h2 { color:#101724; }
.v-noon h1 em, .v-noon h2 em { color:#4F7A00; }
.v-noon .lead { color:#5B6376; }
.v-noon .lead b { color:#1B2230; }
.v-noon .eyebrow { background:#C8FA3C; border-color:#A9DC1E; color:#1A2410; }
.v-noon .eyebrow.plain { background:rgba(20,26,38,.06); border-color:rgba(20,26,38,.12); color:#5B6376; }
.v-noon .eyebrow.amber { background:#FFD79A; border-color:#F0B95E; color:#4A2F00; }
.v-noon .row, .v-noon .li, .v-noon .st, .v-noon .sc, .v-noon .note, .v-noon .src, .v-noon .warn {
   background:#FFFFFF; border-color:rgba(20,26,38,.09);
   box-shadow:0 2px 10px rgba(90,80,60,.05); }
.v-noon .row.hero { background:linear-gradient(104deg, rgba(200,250,60,.30), rgba(200,250,60,.10));
   border-color:#BCE95C; }
.v-noon .sc.up { background:linear-gradient(150deg, rgba(217,45,32,.10), rgba(217,45,32,.02));
   border-color:rgba(217,45,32,.28); }
.v-noon .sc.dn { background:linear-gradient(150deg, rgba(29,100,216,.10), rgba(29,100,216,.02));
   border-color:rgba(29,100,216,.28); }
.v-noon .r-nm, .v-noon .r-vl, .v-noon .li-t, .v-noon .sc-v, .v-noon .big-n { color:#101724; }
.v-noon .r-sub, .v-noon .li-s, .v-noon .sc-l, .v-noon .st-l, .v-noon .big-u { color:#78808F; }
.v-noon .sc-s { color:#8A919E; }
.v-noon .up { color:#C92A1D; } .v-noon .dn { color:#1A5FD0; } .v-noon .fl { color:#7A818E; }
.v-noon .note { border-right-color:#8BB800; }
.v-noon .note-t { color:#4F7A00; }
.v-noon .note-b { color:#39424F; }
.v-noon .note-b b { color:#101724; }
.v-noon .st-v { color:#4F7A00; }
.v-noon .li-d { background:rgba(139,184,0,.16); border-color:rgba(139,184,0,.4); color:#4F7A00; }
.v-noon .cta { background:linear-gradient(126deg, rgba(200,250,60,.34), rgba(200,250,60,.12));
   border-color:#BCE95C; }
.v-noon .cta-t { color:#101724; }
.v-noon .cta-s { color:#5B6376; }
.v-noon .src-t { color:#78808F; }
.v-noon .src-i { color:#8A919E; }
.v-noon .disc { color:#9AA0AC; }
.v-noon .talk { background:linear-gradient(126deg, rgba(255,184,77,.20), rgba(255,184,77,.06));
   border-color:rgba(214,150,40,.38); border-left:none; border-right:3px solid #E09B25; }
.v-noon .talk-t { color:#101724; }
.v-noon .talk-s { color:#78808F; }
.v-noon .warn-i { background:rgba(224,155,37,.16); border-color:rgba(224,155,37,.5); color:#B5760E; }
.v-noon .warn-t { color:#78808F; }
.v-evening .bg { background:
   radial-gradient(120% 80% at 18% -4%, rgba(200,250,60,.13) 0%, rgba(200,250,60,0) 48%),
   radial-gradient(115% 80% at 88% 8%, rgba(104,58,190,.36) 0%, rgba(104,58,190,0) 62%),
   linear-gradient(174deg, #150F2B 0%, #0C0819 50%, #05030C 100%); }

/* ── 막대 그래프 ── */
.chart { flex:1; min-height:0; display:flex; flex-direction:column;
   justify-content:center; gap:16px; }
.chart.roomy { gap:26px; }
.chart.roomy .cb-track { height:62px; }
.chart.roomy .cb-n { font-size:31px; }
.chart.roomy .cb-n span { font-size:20px; }
.chart.roomy .cb-v { font-size:35px; }
.cbar { display:grid; grid-template-columns:236px 1fr 148px; align-items:center; gap:20px; }
.cb-n { font-size:27px; font-weight:700; color:#DDE4EE; letter-spacing:-.015em;
   overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.cb-n span { display:block; font-size:19px; font-weight:500; color:#79839A; margin-top:3px; }
.cb-track { position:relative; height:46px; border-radius:13px;
   background:rgba(255,255,255,.05); border:1px solid rgba(255,255,255,.075); }
.cb-zero { position:absolute; top:-4px; bottom:-4px; width:2px; border-radius:2px;
   background:rgba(255,255,255,.18); }
.cb-fill { position:absolute; top:7px; bottom:7px; border-radius:9px; min-width:5px; }
.cb-fill.up { background:linear-gradient(90deg, rgba(217,45,32,.45), #E4463A); }
.cb-fill.dn { background:linear-gradient(270deg, rgba(29,100,216,.45), #4187F0); }
.cb-fill.fl { background:rgba(255,255,255,.22); }
.cb-v { text-align:right; font-size:30px; font-weight:800; letter-spacing:-.02em;
   font-variant-numeric:tabular-nums; }
.cb-axis { display:flex; justify-content:space-between; font-size:18px; font-weight:600;
   color:#5C6579; letter-spacing:.03em; padding:0 168px 0 256px; margin-top:6px; }
.v-noon .cb-n { color:#101724; }
.v-noon .cb-n span { color:#78808F; }
.v-noon .cb-track { background:rgba(20,26,38,.05); border-color:rgba(20,26,38,.10); }
.v-noon .cb-zero { background:rgba(20,26,38,.18); }
.v-noon .cb-fill.up { background:linear-gradient(90deg, rgba(201,42,29,.42), #C92A1D); }
.v-noon .cb-fill.dn { background:linear-gradient(270deg, rgba(26,95,208,.42), #1A5FD0); }
.v-noon .cb-fill.fl { background:rgba(20,26,38,.2); }
.v-noon .cb-axis { color:#9AA0AC; }

/* ── 프레임 ── */
.frame { position:absolute; inset:0; padding:76px; display:flex; flex-direction:column; }
.top { display:flex; align-items:center; justify-content:space-between; height:40px; flex:none; }
.wm { display:flex; align-items:center; gap:11px; }
.wm-dot { width:11px; height:11px; border-radius:50%; background:#C8FA3C;
   box-shadow:0 0 16px rgba(200,250,60,.85); }
.wm-tx { font-size:23px; font-weight:800; letter-spacing:.13em; color:#EDF2F7; }
.slot { font-size:19px; font-weight:600; letter-spacing:.045em; color:#79839A; }
.slot b { color:#C8FA3C; font-weight:700; }

.body { flex:1; display:flex; flex-direction:column; min-height:0; padding-top:50px; padding-bottom:30px; }

.bot { display:flex; align-items:center; justify-content:space-between; height:34px; flex:none; }
.dots { display:flex; gap:7px; }
.dot { width:22px; height:4px; border-radius:2px; background:rgba(255,255,255,.15); }
.dot.on { background:#C8FA3C; width:34px; }
.pg { font-size:18px; font-weight:600; color:#5C6579; letter-spacing:.05em; }

/* ── 타이포 ── */
.eyebrow { display:inline-flex; align-items:center; gap:9px; align-self:flex-start;
   padding:9px 17px; border-radius:100px; background:rgba(200,250,60,.13);
   border:1px solid rgba(200,250,60,.34); font-size:19px; font-weight:700;
   letter-spacing:.04em; color:#C8FA3C; margin-bottom:30px; }
.eyebrow.plain { background:rgba(255,255,255,.06); border-color:rgba(255,255,255,.14); color:#AEB7C6; }

h1 { font-size:80px; font-weight:800; line-height:1.19; letter-spacing:-.032em; }
h2 { font-size:56px; font-weight:800; line-height:1.28; letter-spacing:-.028em; }
h1 em, h2 em { font-style:normal; color:#C8FA3C; }
.lead { font-size:29px; font-weight:500; line-height:1.62; color:#98A2B4; letter-spacing:-.012em; }
.lead b { color:#DDE4EE; font-weight:700; }

/* ── 지수 카드 ── */
.rows { display:flex; flex-direction:column; gap:15px; }
.row { display:flex; align-items:center; justify-content:space-between;
   padding:29px 32px; border-radius:20px; background:rgba(255,255,255,.045);
   border:1px solid rgba(255,255,255,.085); }
.row.hero { background:linear-gradient(104deg, rgba(200,250,60,.15), rgba(200,250,60,.035));
   border-color:rgba(200,250,60,.38); }
.r-l { display:flex; flex-direction:column; gap:7px; }
.r-nm { font-size:29px; font-weight:700; color:#F0F4F9; letter-spacing:-.015em; }
.r-sub { font-size:18px; font-weight:500; color:#6E7889; letter-spacing:.01em; }
.r-r { display:flex; flex-direction:column; align-items:flex-end; gap:6px; }
.r-vl { font-size:40px; font-weight:800; letter-spacing:-.028em; color:#fff; }
.r-ch { font-size:22px; font-weight:700; letter-spacing:-.006em; }
.up { color:#FF5F5F; } .dn { color:#4D9DFF; } .fl { color:#8C95A6; }

/* ── 지표 3분할 ── */
.stat { display:flex; gap:14px; }
.st { flex:1; padding:28px 24px; border-radius:20px; background:rgba(255,255,255,.045);
   border:1px solid rgba(255,255,255,.085); }
.st-v { font-size:50px; font-weight:800; letter-spacing:-.035em; line-height:1; color:#C8FA3C; }
.st-l { font-size:19px; font-weight:500; color:#79839A; margin-top:13px; line-height:1.42; }

/* ── 카드 확대 변형 ── */
.rows.wide .row { padding:44px 34px; }
.rows.wide .r-vl { font-size:50px; }
.rows.wide .r-nm { font-size:32px; }
.rows.wide .r-ch { font-size:24px; }

/* ── 숫자 강조 ── */
.big { display:flex; align-items:baseline; gap:16px; }
.big-n { font-size:136px; font-weight:800; line-height:.95; letter-spacing:-.045em; }
.big-u { font-size:34px; font-weight:700; color:#8A94A6; }

/* ── 표지 대비 카드 ── */
.split { display:flex; gap:15px; width:100%; }
.sc { flex:1; padding:26px 28px; border-radius:20px;
   background:rgba(255,255,255,.045); border:1px solid rgba(255,255,255,.085); }
.sc.up { background:linear-gradient(150deg, rgba(255,95,95,.13), rgba(255,95,95,.03));
   border-color:rgba(255,95,95,.3); }
.sc.dn { background:linear-gradient(150deg, rgba(77,157,255,.13), rgba(77,157,255,.03));
   border-color:rgba(77,157,255,.3); }
.sc-l { font-size:20px; font-weight:600; color:#8A94A6; margin-bottom:11px; letter-spacing:-.01em; }
.sc-v { font-size:48px; font-weight:800; letter-spacing:-.035em; line-height:1; }
.sc-s { font-size:17px; font-weight:500; color:#6B7587; margin-top:10px; }

/* ── 노트 박스 ── */
.note { padding:30px 32px; border-radius:20px; background:rgba(255,255,255,.045);
   border:1px solid rgba(255,255,255,.085); border-left:3px solid #C8FA3C; }
.note-t { font-size:19px; font-weight:700; color:#C8FA3C; letter-spacing:.05em; margin-bottom:13px; }
.note-b { font-size:26px; font-weight:500; line-height:1.62; color:#C2CAD8; letter-spacing:-.012em; }
.note-b b { color:#fff; font-weight:700; }

/* ── 리스트 ── */
.list { display:flex; flex-direction:column; gap:16px; }
.li { display:flex; gap:19px; align-items:flex-start;
   padding:36px 30px; border-radius:18px; background:rgba(255,255,255,.04);
   border:1px solid rgba(255,255,255,.075); }
.li-d { flex:none; min-width:82px; height:44px; padding:0 13px; border-radius:9px;
   background:rgba(200,250,60,.14); border:1px solid rgba(200,250,60,.3);
   display:flex; align-items:center; justify-content:center;
   font-size:18px; font-weight:800; color:#C8FA3C; letter-spacing:.01em; }
.li-x { display:flex; flex-direction:column; gap:6px; }
.li-t { font-size:28px; font-weight:700; color:#EEF2F8; letter-spacing:-.015em; line-height:1.34; }
.li-s { font-size:21px; font-weight:500; color:#79839A; line-height:1.5; }

/* ── CTA ── */
.cta { padding:34px 34px; border-radius:20px;
   background:linear-gradient(126deg, rgba(200,250,60,.16), rgba(200,250,60,.035));
   border:1px solid rgba(200,250,60,.36); }
.cta-t { font-size:31px; font-weight:800; color:#fff; letter-spacing:-.022em; line-height:1.4; }
.cta-s { font-size:22px; font-weight:500; color:#A6B0C0; margin-top:14px; line-height:1.56; }

/* ── 시장의 말 (미확인 전망) ── */
.eyebrow.amber { background:rgba(255,184,77,.13); border-color:rgba(255,184,77,.38); color:#FFB84D; }
.talk { padding:32px 34px; border-radius:20px;
   background:linear-gradient(126deg, rgba(255,184,77,.11), rgba(255,184,77,.025));
   border:1px solid rgba(255,184,77,.30); border-left:3px solid #FFB84D; }
.talk-t { font-size:30px; font-weight:700; color:#fff; line-height:1.5; letter-spacing:-.02em; }
.talk-s { font-size:20px; font-weight:500; color:#95A0B0; margin-top:15px; line-height:1.5; }
.warn { display:flex; align-items:flex-start; gap:14px;
   padding:22px 26px; border-radius:16px; background:rgba(255,255,255,.04);
   border:1px solid rgba(255,255,255,.09); }
.warn-i { flex:none; width:28px; height:28px; border-radius:50%; margin-top:2px;
   background:rgba(255,184,77,.18); border:1px solid rgba(255,184,77,.48);
   display:flex; align-items:center; justify-content:center;
   font-size:17px; font-weight:800; color:#FFB84D; }
.warn-t { font-size:21px; font-weight:500; color:#8E98AA; line-height:1.55; letter-spacing:-.008em; }

/* ── 출처 ── */
.src { display:flex; flex-direction:column; gap:9px; padding:26px 28px; border-radius:18px;
   background:rgba(255,255,255,.032); border:1px solid rgba(255,255,255,.07); }
.src-t { font-size:17px; font-weight:700; color:#8B95A7; letter-spacing:.08em; }
.src-i { font-size:19px; font-weight:500; color:#69738A; line-height:1.62; }
.disc { font-size:18px; font-weight:500; color:#5A6377; line-height:1.6; letter-spacing:-.005em; }

.v-noon .top { flex-direction:row-reverse; }
.v-noon .bot { flex-direction:row-reverse; }
.v-noon .eyebrow { align-self:flex-end; }
.v-noon h1, .v-noon h2, .v-noon .lead { text-align:right; }
.v-noon .big { justify-content:flex-end; }
.v-noon .note { border-left:none; border-right:3px solid #C8FA3C; text-align:right; }
.v-noon .row { flex-direction:row-reverse; }
.v-noon .r-l { align-items:flex-end; }
.v-noon .r-r { align-items:flex-start; }
.v-noon .sc-l, .v-noon .sc-v, .v-noon .sc-s { text-align:right; }
.v-noon .st { text-align:right; }
.v-noon .li { flex-direction:row-reverse; text-align:right; }
.v-noon .li-x { align-items:flex-end; }
.v-noon .src, .v-noon .disc, .v-noon .cta { text-align:right; }

.sp { flex:1; }
.gap-s { height:22px; } .gap-m { height:34px; } .gap-l { height:48px; }
"""

def frame(inner, slot_label, page, total, cover=False, variant=""):
    dots = "".join(
        '<div class="dot%s"></div>' % (" on" if i == page - 1 else "")
        for i in range(total)
    )
    top = (
        '<div class="top">'
        '<div class="wm"><div class="wm-dot"></div><div class="wm-tx">UPTIKR</div></div>'
        '<div class="slot">' + slot_label + '</div>'
        '</div>'
    )
    bot = (
        '<div class="bot"><div class="dots">' + dots + '</div>'
        '<div class="pg">' + ("%02d / %02d" % (page, total)) + '</div></div>'
    )
    return (
        '<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8">'
        '<style>' + CSS + '</style></head><body>'
        '<div class="stage' + ((' v-' + variant) if variant else '') + '">'
        '<div class="bg"></div><div class="grid"></div><div class="vig"></div>'
        '<div class="frame">' + top + '<div class="body">' + inner + '</div>' + bot +
        '</div></div></body></html>'
    )
