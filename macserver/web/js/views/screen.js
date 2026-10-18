// 화면 뷰 — 플레이어(스테이지) + 사이드 패널
import { h, svg, clear, toast, modal, fmtBitrate, fmtDuration, copyText, contextMenu } from '../ui.js';
import { icon } from '../icons.js';
import { state, set, on, emit } from '../state.js';
import { ScreenSession, QUALITY } from '../viewer/session.js';
import { attachInput } from '../viewer/input.js';

let scaleMode = localStorage.getItem('ms.scale') || 'fit';
let panelHidden = localStorage.getItem('ms.panel') === 'hidden';

export function render({ container, topbarSlot, navigate, setFullscreenLayout }) {
  container.classList.add('flush'); container.style.padding = '0 8px 8px';
  const unsubs = [];
  let session = state.viewer; let detachInput = null;

  const video = h('video', { autoplay: true, playsinline: true, muted: true });
  const overlay = h('div.overlay');
  const toolbar = h('div.toolbar');
  const hint = h('div.hint');
  const banner = h('div.banner.hidden');
  const stage = h('div.stage', { tabindex: 0 }, video, overlay, toolbar, hint, banner);
  const side = h('aside.side.scroll');
  const viewer = h('div.viewer', { class: panelHidden ? 'panel-hidden' : '' }, stage, side);
  container.appendChild(viewer);
  topbarSlot.appendChild(h('div', { style: { fontWeight: 700, fontSize: '1.1rem' } }, `${state.hostName} 화면`));

  // ---------- 세션 바인딩 ----------
  function bind(s) {
    if (detachInput) { detachInput(); detachInput = null; }
    session = s;
    if (s) {
      unsubs.push(s.on('state', drawAll), s.on('control', drawAll), s.on('stream', attachStream), s.on('stats', drawStats), s.on('quality', drawSide), s.on('remote', drawSide), s.on('keyboard', drawToolbar), s.on('clipboard', onClipboard), s.on('remoteError', (e) => toast('호스트 오류: ' + e, 'error', 5000)));
      if (s.stream) attachStream(s.stream);
      detachInput = attachInput(stage, video, s);
    }
    drawAll();
  }
  function attachStream(stream) { if (video.srcObject !== stream) { video.srcObject = stream; video.play().catch(() => {}); } drawAll(); }
  function start(wantControl) {
    if (session && session.state !== 'ended' && session.state !== 'idle') return;
    const s = new ScreenSession({ wantControl });
    bind(s); s.start();
  }
  function drawAll() { drawOverlay(); drawToolbar(); drawSide(); stage.classList.toggle('control', !!(session && session.control && session.state === 'connected')); stage.classList.toggle('show-cursor', localStorage.getItem('ms.cursor') !== 'hide'); stage.classList.toggle('scale-100', scaleMode === '100'); }

  // ---------- 오버레이 ----------
  function drawOverlay() {
    clear(overlay);
    const st = session ? session.state : 'idle';
    if (st === 'connected' && !session.paused) { overlay.classList.add('hidden'); banner.classList.toggle('hidden', session.control || !session.canControl); banner.textContent = '보기 전용 — 제어를 켜려면 툴바의 마우스 아이콘을 누르세요'; return; }
    overlay.classList.remove('hidden'); banner.classList.add('hidden');
    if (st === 'idle' || st === 'ended') {
      const online = state.agentOnline;
      const canCtl = state.user.permissions.screenControl || state.user.isAdmin;
      const canView = state.user.permissions.screenView || state.user.isAdmin;
      overlay.append(
        h('div', h('button.play-btn.big-play', { disabled: !online || !canView, onclick: () => start(canCtl) }, svg('play')),
          h('h2', `${state.hostName} 화면`),
          h('p', st === 'ended' && session.reason ? session.reason : !canView ? '화면 보기 권한이 없어요. 관리자에게 요청하세요.' : online ? (canCtl ? '재생을 누르면 실시간 화면이 표시되고 마우스·키보드로 제어할 수 있어요.' : '재생을 누르면 실시간 화면이 표시돼요 (보기 전용).') : '호스트 앱이 꺼져 있어요. Mac mini에서 macserver가 실행 중인지 확인하세요.'),
          h('div', { style: { display: 'flex', gap: '12px', justifyContent: 'center' } },
            h('button.btn.primary', { disabled: !online || !canView, onclick: () => start(canCtl) }, svg('play'), canCtl ? '보기 + 제어' : '보기'),
            canCtl ? h('button.btn.secondary', { disabled: !online, onclick: () => start(false) }, svg('eye'), '보기만') : null)));
    } else if (st === 'pending') {
      overlay.append(h('div', h('div.spin'), h('h2', '승인 대기 중'), h('p', session.reason || '호스트가 요청을 확인하고 있어요…'), h('button.btn.secondary', { onclick: () => session.stop('user') }, '취소')));
    } else if (st === 'connected' && session.paused) {
      overlay.append(h('div', h('button.play-btn.big-play', { onclick: () => session.togglePause() }, svg('play')), h('h2', '일시정지됨'), h('p', '화면 수신을 멈췄어요. 재생을 누르면 이어서 볼 수 있어요.')));
    } else {
      overlay.append(h('div', h('div.spin'), h('h2', '연결 중'), h('p', session.reason || '호스트와 WebRTC 연결을 협상하고 있어요…'), h('button.btn.secondary', { onclick: () => session.stop('user') }, '취소')));
    }
  }

  // ---------- 툴바 ----------
  function drawToolbar() {
    clear(toolbar);
    const connected = session && session.state === 'connected';
    if (!connected) { toolbar.classList.remove('pinned'); return; }
    const btn = (name, title, onclick, extra = {}) => h('button.icon-btn', { title, onclick, ...extra }, svg(name));
    toolbar.append(
      btn('mouse', session.control ? '제어 끄기 (보기 전용)' : '제어 켜기', () => session.toggleControl(), { class: session.control ? 'active' : '', disabled: !session.canControl }),
      h('span.lbl', session.control ? (session.capturingKeys ? '키보드 캡처 중' : '클릭하면 키보드 입력') : '보기 전용'),
      h('span.sep'),
      btn('command', '단축키 보내기', (e) => shortcutMenu(e.currentTarget)),
      btn('text', '텍스트 입력 보내기 (한글 등)', () => openSendText()),
      btn('clipboard', '클립보드', (e) => clipboardMenu(e.currentTarget)),
      h('span.sep'),
      btn(scaleMode === 'fit' ? 'minimize' : 'fullscreen', scaleMode === 'fit' ? '실제 크기(100%)' : '창에 맞춤', () => { scaleMode = scaleMode === 'fit' ? '100' : 'fit'; localStorage.setItem('ms.scale', scaleMode); drawAll(); }),
      btn('sliders', '화질', (e) => qualityMenu(e.currentTarget)),
      btn('sidebar', panelHidden ? '패널 보기' : '패널 숨기기', () => { panelHidden = !panelHidden; localStorage.setItem('ms.panel', panelHidden ? 'hidden' : 'shown'); viewer.classList.toggle('panel-hidden', panelHidden); drawToolbar(); }, { class: panelHidden ? '' : 'active' }),
      btn('fullscreen', '전체 화면', () => requestFullscreen()),
      h('span.sep'),
      btn(session.paused ? 'play' : 'pause', session.paused ? '재개' : '일시정지', () => session.togglePause()),
      btn('stop', '연결 끊기', () => session.stop('user')),
    );
    hint.textContent = session.control ? (session.capturingKeys ? '키보드가 원격으로 전달돼요 · 해제: 다른 곳 클릭 또는 ⇧⌘Esc' : '화면을 클릭하면 키보드 입력이 원격으로 전달돼요') : '보기 전용 모드';
  }
  function requestFullscreen() { if (document.fullscreenElement) document.exitFullscreen(); else (stage.requestFullscreen ? stage.requestFullscreen() : stage.webkitRequestFullscreen && stage.webkitRequestFullscreen()); }
  const onFs = () => { setFullscreenLayout(!!document.fullscreenElement); };
  document.addEventListener('fullscreenchange', onFs); unsubs.push(() => { document.removeEventListener('fullscreenchange', onFs); setFullscreenLayout(false); });

  function shortcutMenu(anchor) {
    const items = (state.shortcuts || []).map((s) => ({ label: `${s.desc}`, kbd: s.label, onClick: () => { if (!session.control) return toast('제어 모드에서만 보낼 수 있어요', 'warn'); session.sendShortcut(s.keys); } }));
    contextMenu([{ head: '단축키 보내기' }, ...items, '-', { label: '모든 키 떼기', icon: 'refresh', onClick: () => session.sendControl({ t: 'release' }) }], { anchor });
  }
  function qualityMenu(anchor) { contextMenu([{ head: '화질' }, ...Object.entries(QUALITY).map(([k, q]) => ({ label: `${q.label} — ${q.desc}`, icon: session.quality === k ? 'check' : undefined, onClick: () => session.setQuality(k) }))], { anchor }); }
  function clipboardMenu(anchor) {
    contextMenu([{ head: '클립보드' },
      { label: '내 클립보드 → 호스트로 보내기', icon: 'send', onClick: async () => { try { const t = await navigator.clipboard.readText(); if (!t) return toast('클립보드가 비어 있어요'); session.setClipboard(t); toast('호스트 클립보드에 넣었어요', 'success'); } catch (_) { openSendClipboard(); } } },
      { label: '호스트 클립보드 가져오기', icon: 'download', onClick: () => { session.requestClipboard(); } },
      { label: '텍스트를 호스트 클립보드로…', icon: 'clipboard', onClick: () => openSendClipboard() },
    ], { anchor });
  }
  function onClipboard(text) {
    if (text == null) return toast('호스트 클립보드가 비어 있어요');
    copyText(text).then((ok) => { if (ok) toast('호스트 클립보드를 가져왔어요', 'success'); else showText('호스트 클립보드', text); });
  }
  function showText(title, text) { const ta = h('textarea.input', { value: text, readonly: true, style: { minHeight: '160px' } }); modal({ title, body: ta, footer: [h('button.btn.primary', { onclick: () => copyText(text).then(() => toast('복사했어요')) }, '복사')] }); setTimeout(() => ta.select(), 50); }
  function openSendText() {
    const ta = h('textarea.input', { placeholder: '여기에 입력한 텍스트가 호스트에 그대로 타이핑돼요. 한글, 이모지도 가능해요.', style: { minHeight: '140px' } });
    const enter = h('label.check', h('input', { type: 'checkbox' }), '끝에 Enter 보내기');
    const dlg = modal({ title: '텍스트 입력 보내기', body: [ta, enter], footer: [h('button.btn.ghost', { onclick: () => dlg.close() }, '취소'), h('button.btn.primary', { onclick: () => { const t = ta.value; if (!t) return; if (!session.control) return toast('제어 모드에서만 보낼 수 있어요', 'warn'); session.sendText(t); if (enter.querySelector('input').checked) session.sendShortcut([{ code: 'Enter', mods: [] }]); dlg.close(); toast('보냈어요', 'success'); } }, '보내기')] });
    ta.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') dlg.el.querySelector('.btn.primary').click(); });
  }
  function openSendClipboard() { const ta = h('textarea.input', { placeholder: '호스트 클립보드에 넣을 텍스트' }); const dlg = modal({ title: '호스트 클립보드로 보내기', body: ta, footer: [h('button.btn.primary', { onclick: () => { session.setClipboard(ta.value); dlg.close(); toast('보냈어요', 'success'); } }, '보내기')] }); }
  if (session) { session.openSendText = openSendText; session.requestFullscreen = requestFullscreen; }

  // ---------- 사이드 패널 ----------
  function drawSide() {
    clear(side);
    const connected = session && session.state === 'connected';
    side.appendChild(h('div.host-card', h('span.art', svg('monitorFill')), h('div', h('div.t', state.hostName), h('div.s', h('span.dot', { class: state.agentOnline ? 'on' : 'off' }), state.agentOnline ? '에이전트 온라인' : '오프라인', connected && session.remote && session.remote.display ? ` · ${session.remote.display.width}×${session.remote.display.height}` : ''))));
    if (connected) {
      side.appendChild(h('div.block', h('h3', '연결 상태'), h('div.kv', { id: 'stats-kv' })));
      drawStats(session.stats);
      side.appendChild(h('div.block', h('h3', '화질'), h('div.quality-list', ...Object.entries(QUALITY).map(([k, q]) => h('button', { class: session.quality === k ? 'active' : '', onclick: () => session.setQuality(k) }, h('span', q.label, h('small', q.desc)), session.quality === k ? svg('check') : null)))));
      side.appendChild(h('div.block', h('h3', '단축키', h('span', { style: { fontSize: '11px', color: 'var(--text-subdued)', fontWeight: 400 } }, session.control ? '' : '제어 모드 필요')), h('div.keys', ...(state.shortcuts || []).map((s) => h('button', { disabled: !session.control, onclick: () => session.sendShortcut(s.keys) }, h('b', s.label), h('small', s.desc))))));
      side.appendChild(h('div.block', h('h3', '입력'),
        h('button.btn.tinted.sm.block', { onclick: () => openSendText() }, svg('text'), '텍스트 보내기 (한글)'),
        h('button.btn.tinted.sm.block', { onclick: (e) => clipboardMenu(e.currentTarget) }, svg('clipboard'), '클립보드 동기화'),
        h('label.check', { style: { marginTop: '4px' } }, h('input', { type: 'checkbox', checked: localStorage.getItem('ms.cursor') !== 'hide', onchange: (e) => { localStorage.setItem('ms.cursor', e.target.checked ? 'show' : 'hide'); drawAll(); } }), '내 커서 표시 (십자)')));
    } else {
      side.appendChild(h('div.block', h('h3', '사용 방법'), h('div.callout',
        h('ol', { style: { margin: 0, paddingLeft: '18px' } },
          h('li', '▶ 를 눌러 세션을 시작해요. 호스트 설정이 "매번 묻기"면 승인을 기다려요.'),
          h('li', '화면을 클릭하면 키보드가 원격으로 전달돼요. 다른 곳을 클릭하면 해제돼요.'),
          h('li', '⌘Tab·⌘Space 같은 조합은 브라우저가 가로채므로 "단축키" 메뉴로 보내세요.'),
          h('li', '한글 입력은 "텍스트 보내기"가 가장 정확해요.')))));
      side.appendChild(h('div.block', h('h3', '내 권한'), h('div.kv', h('span', '화면 보기'), h('b', state.user.permissions.screenView || state.user.isAdmin ? '허용' : '차단'), h('span', '화면 제어'), h('b', state.user.permissions.screenControl || state.user.isAdmin ? '허용' : '차단'))));
    }
  }
  function drawStats(st) {
    const kv = side.querySelector('#stats-kv'); if (!kv || !session) return; clear(kv); st = st || {};
    const rows = [['해상도', st.width ? `${st.width}×${st.height}` : '—'], ['프레임', st.fps != null ? `${st.fps} fps` : '—'], ['비트레이트', fmtBitrate(st.bitrate)], ['지연 (RTT)', st.rtt != null ? `${Math.round(st.rtt * 1000)} ms` : st.appRtt != null ? `${st.appRtt} ms` : '—'], ['손실 패킷', st.packetsLost != null ? String(st.packetsLost) : '—'], ['경로', st.path || '—'], ['디코더', st.decoder || '—'], ['세션 시간', session.connectedAt ? fmtDuration((Date.now() - session.connectedAt) / 1000) : '—'], ['모드', session.control ? '제어' : '보기 전용']];
    for (const [k, v] of rows) kv.append(h('span', k), h('b', v));
  }

  unsubs.push(on('viewer', (s) => { if (s !== session) bind(s); }));
  unsubs.push(on('change', (p) => { if ('agentOnline' in p) drawAll(); }));
  bind(session);
  return { cleanup: () => { unsubs.forEach((u) => u()); if (detachInput) detachInput(); container.classList.remove('flush'); container.style.padding = ''; } };
}
