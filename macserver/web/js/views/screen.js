// 화면 뷰 — 접속 시 몰입(전체화면) 기본, 끌어내는 툴바, 모바일 키보드/확대, 창모드 전환
import { h, svg, clear, toast, modal, fmtBitrate, fmtDuration, copyText, contextMenu } from '../ui.js';
import { icon } from '../icons.js';
import { state, set, on, emit } from '../state.js';
import { ScreenSession, QUALITY } from '../viewer/session.js';
import { attachInput } from '../viewer/input.js';

const appRoot = () => document.getElementById('app');
let layout = localStorage.getItem('ms.layout') || 'immersive'; // 'immersive' | 'windowed'
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

export function render({ container, topbarSlot, navigate, setFullscreenLayout }) {
  container.classList.add('flush');
  const unsubs = [];
  let session = state.viewer; let input = null; let toolbarTimer = 0;

  const video = h('video', { autoplay: true, playsinline: true, muted: true });
  const surface = h('div.surface', video);
  const overlay = h('div.overlay');
  const handle = h('button.tb-handle', { title: '툴바', onclick: () => toggleToolbar() }, h('span'), h('span'), h('span'));
  const toolbar = h('div.vtoolbar');
  const zoomhud = h('div.zoomhud.hidden');
  const hint = h('div.hint');
  const banner = h('div.banner.hidden');
  const stage = h('div.stage', { tabindex: 0 }, surface, overlay, handle, toolbar, zoomhud, hint, banner);
  const side = h('aside.side.scroll');
  const viewer = h('div.viewer', stage, side);
  container.appendChild(viewer);
  topbarSlot.appendChild(h('div', { style: { fontWeight: 700, fontSize: '1.1rem' } }, `${state.hostName} 화면`));

  function setLayout(next) {
    layout = next; localStorage.setItem('ms.layout', next);
    const connected = session && (session.state === 'connected' || session.state === 'connecting');
    const immersive = next === 'immersive' && connected;
    appRoot().classList.toggle('immersive-screen', immersive);
    viewer.classList.toggle('windowed', next === 'windowed');
    viewer.classList.toggle('immersive', immersive);
    drawToolbar(); drawSide();
    if (input) setTimeout(() => input.resetView(), 0);
  }
  function enterConnectedLayout() { setLayout(layout); }
  function exitLayout() { appRoot().classList.remove('immersive-screen'); viewer.classList.remove('immersive'); }

  function toggleToolbar(force) {
    const open = force !== undefined ? force : !stage.classList.contains('tb-open');
    stage.classList.toggle('tb-open', open);
    clearTimeout(toolbarTimer);
    if (open) toolbarTimer = setTimeout(() => stage.classList.remove('tb-open'), 4500);
  }

  // ---------- 세션 ----------
  function bind(s) {
    if (input) { input.destroy(); input = null; }
    session = s;
    if (s) {
      unsubs.push(s.on('state', onState), s.on('control', () => { drawAll(); }), s.on('stream', attachStream), s.on('stats', drawStats), s.on('quality', drawSide), s.on('remote', drawSide), s.on('keyboard', drawToolbar), s.on('clipboard', onClipboard), s.on('remoteError', (e) => toast('호스트 오류: ' + e, 'error', 5000)));
      if (s.stream) attachStream(s.stream);
      input = attachInput(stage, video, s, {
        surface,
        onZoom: (z) => { zoomhud.textContent = Math.round(z * 100) + '%'; zoomhud.classList.toggle('hidden', z <= 1.001); drawToolbar(); },
        onKeyboard: (on) => { drawToolbar(); if (on) toggleToolbar(false); },
      });
      s.openSendText = openSendText; s.requestFullscreen = requestFullscreen; s.toggleKeyboard = () => input && input.toggleKeyboard();
      if (s.state === 'connected' || s.state === 'connecting') enterConnectedLayout(); else exitLayout();
    } else exitLayout();
    drawAll();
  }
  function attachStream(stream) { if (video.srcObject !== stream) { video.srcObject = stream; video.play().catch(() => {}); } drawAll(); }
  function onState(st) { if (st.state === 'connected' || st.state === 'connecting') enterConnectedLayout(); else exitLayout(); drawAll(); }
  function start(wantControl) { if (session && session.state !== 'ended' && session.state !== 'idle') return; const s = new ScreenSession({ wantControl }); bind(s); s.start(); }
  function drawAll() { drawOverlay(); drawToolbar(); drawSide(); stage.classList.toggle('control', !!(session && session.control && session.state === 'connected')); }

  // ---------- 오버레이 ----------
  function drawOverlay() {
    clear(overlay);
    const st = session ? session.state : 'idle';
    if (st === 'connected' && !session.paused) { overlay.classList.add('hidden'); banner.classList.toggle('hidden', session.control || !session.canControl); if (!session.control && session.canControl) banner.textContent = '보기 전용 — 툴바의 마우스 아이콘으로 제어를 켜세요'; return; }
    overlay.classList.remove('hidden'); banner.classList.add('hidden');
    if (st === 'idle' || st === 'ended') {
      const online = state.agentOnline; const canCtl = state.user.permissions.screenControl || state.user.isAdmin; const canView = state.user.permissions.screenView || state.user.isAdmin;
      overlay.append(h('div', h('button.play-btn.big-play', { disabled: !online || !canView, onclick: () => start(canCtl) }, svg('play')),
        h('h2', `${state.hostName} 화면`),
        h('p', st === 'ended' && session.reason ? session.reason : !canView ? '화면 보기 권한이 없어요.' : online ? (canCtl ? '재생하면 전체화면으로 보이고 마우스·키보드로 제어할 수 있어요.' : '재생하면 전체화면으로 화면이 표시돼요 (보기 전용).') : '호스트 앱이 꺼져 있어요. Mac mini에서 macserver가 켜져 있는지 확인하세요.'),
        h('div', { style: { display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' } },
          h('button.btn.primary', { disabled: !online || !canView, onclick: () => start(canCtl) }, svg('play'), canCtl ? '보기 + 제어' : '보기'),
          canCtl ? h('button.btn.secondary', { disabled: !online, onclick: () => start(false) }, svg('eye'), '보기만') : null)));
    } else if (st === 'pending') {
      overlay.append(h('div', h('div.spin'), h('h2', '승인 대기 중'), h('p', session.reason || '호스트가 확인하고 있어요…'), h('button.btn.secondary', { onclick: () => session.stop('user') }, '취소')));
    } else if (st === 'connected' && session.paused) {
      overlay.append(h('div', h('button.play-btn.big-play', { onclick: () => session.togglePause() }, svg('play')), h('h2', '일시정지됨'), h('p', '재생을 누르면 이어서 볼 수 있어요.')));
    } else {
      overlay.append(h('div', h('div.spin'), h('h2', '연결 중'), h('p', session.reason || '호스트와 연결하고 있어요…'), h('button.btn.secondary', { onclick: () => session.stop('user') }, '취소')));
    }
  }

  // ---------- 끌어내는 툴바 ----------
  function drawToolbar() {
    clear(toolbar);
    const connected = session && session.state === 'connected';
    handle.classList.toggle('hidden', !connected);
    if (!connected) { stage.classList.remove('tb-open'); return; }
    const kbOpen = input && input.keyboardOpen();
    const zoomed = input && input.isZoomed();
    const btn = (name, label, onclick, cls = '') => h('button.tb-btn', { class: cls, title: label, onclick: (e) => { onclick(e); clearTimeout(toolbarTimer); toolbarTimer = setTimeout(() => stage.classList.remove('tb-open'), 4500); } }, svg(name), h('span', label));
    toolbar.append(
      btn('mouse', session.control ? '제어 켜짐' : '보기 전용', () => session.toggleControl(), session.control ? 'active' : ''),
      btn('keyboard', kbOpen ? '키보드 닫기' : '키보드', () => input && input.toggleKeyboard(), kbOpen ? 'active' : ''),
      btn('command', '단축키', (e) => shortcutMenu(e.currentTarget)),
      btn('text', '텍스트', () => openSendText()),
      btn('plus', '확대', () => input && input.zoomIn(), zoomed ? 'active' : ''),
      btn('minimize', '원래대로', () => input && input.resetView()),
      btn('sliders', '화질', (e) => qualityMenu(e.currentTarget)),
      btn('clipboard', '클립보드', (e) => clipboardMenu(e.currentTarget)),
      btn(layout === 'immersive' ? 'sidebar' : 'fullscreen', layout === 'immersive' ? '창 모드(작게)' : '전체화면 모드', () => setLayout(layout === 'immersive' ? 'windowed' : 'immersive')),
      btn('fullscreen', '브라우저 전체화면', () => requestFullscreen()),
      btn(session.paused ? 'play' : 'pause', session.paused ? '재개' : '일시정지', () => session.togglePause()),
      btn('stop', '연결 끊기', () => session.stop('user'), 'danger'),
    );
    hint.textContent = isTouch ? '한 손가락 탭=클릭 · 끌기=이동 · 길게눌러 끌기=드래그 · 두 손가락 스크롤 · 핀치 확대' : (session.control ? '화면 클릭 후 키보드 입력 · ⌘조합은 "단축키"' : '보기 전용');
  }
  function requestFullscreen() { const el = stage; if (document.fullscreenElement) document.exitFullscreen(); else (el.requestFullscreen ? el.requestFullscreen() : el.webkitRequestFullscreen && el.webkitRequestFullscreen()).catch?.(() => toast('이 브라우저는 전체화면을 지원하지 않아요. 몰입 모드로 보세요.', 'warn')); }
  const onFs = () => { setFullscreenLayout(!!document.fullscreenElement); };
  document.addEventListener('fullscreenchange', onFs); unsubs.push(() => { document.removeEventListener('fullscreenchange', onFs); setFullscreenLayout(false); });

  function shortcutMenu(anchor) { contextMenu([{ head: '단축키 보내기' }, ...(state.shortcuts || []).map((s) => ({ label: s.desc, kbd: s.label, onClick: () => { if (!session.control) return toast('제어 모드에서만', 'warn'); session.sendShortcut(s.keys); } })), '-', { label: '모든 키 떼기', icon: 'refresh', onClick: () => session.sendControl({ t: 'release' }) }], { anchor }); }
  function qualityMenu(anchor) { contextMenu([{ head: '화질' }, ...Object.entries(QUALITY).map(([k, q]) => ({ label: `${q.label} — ${q.desc}`, icon: session.quality === k ? 'check' : undefined, onClick: () => session.setQuality(k) }))], { anchor }); }
  function clipboardMenu(anchor) {
    contextMenu([{ head: '클립보드' },
      { label: '내 클립보드 → 호스트', icon: 'send', onClick: async () => { try { const t = await navigator.clipboard.readText(); if (!t) return toast('클립보드가 비어 있어요'); session.setClipboard(t); toast('보냈어요', 'success'); } catch (_) { openSendClipboard(); } } },
      { label: '호스트 클립보드 가져오기', icon: 'download', onClick: () => session.requestClipboard() },
      { label: '텍스트를 호스트로…', icon: 'clipboard', onClick: () => openSendClipboard() },
    ], { anchor }); }
  function onClipboard(text) { if (text == null) return toast('호스트 클립보드가 비어 있어요'); copyText(text).then((ok) => ok ? toast('가져왔어요', 'success') : showText('호스트 클립보드', text)); }
  function showText(title, text) { const ta = h('textarea.input', { value: text, readonly: true, style: { minHeight: '160px' } }); modal({ title, body: ta, footer: [h('button.btn.primary', { onclick: () => copyText(text).then(() => toast('복사했어요')) }, '복사')] }); setTimeout(() => ta.select(), 50); }
  function openSendText() {
    const ta = h('textarea.input', { placeholder: '여기 입력한 텍스트가 호스트에 그대로 입력돼요. 한글·이모지 OK.', style: { minHeight: '140px' } });
    const enter = h('label.check', h('input', { type: 'checkbox' }), '끝에 Enter 보내기');
    const dlg = modal({ title: '텍스트 보내기', body: [ta, enter], footer: [h('button.btn.ghost', { onclick: () => dlg.close() }, '취소'), h('button.btn.primary', { onclick: () => { const t = ta.value; if (!t) return; if (!session.control) return toast('제어 모드에서만', 'warn'); session.sendText(t); if (enter.querySelector('input').checked) session.sendShortcut([{ code: 'Enter', mods: [] }]); dlg.close(); toast('보냈어요', 'success'); } }, '보내기')] });
  }
  function openSendClipboard() { const ta = h('textarea.input', { placeholder: '호스트 클립보드에 넣을 텍스트' }); const dlg = modal({ title: '호스트 클립보드로', body: ta, footer: [h('button.btn.primary', { onclick: () => { session.setClipboard(ta.value); dlg.close(); toast('보냈어요', 'success'); } }, '보내기')] }); }

  // ---------- 사이드(창모드) ----------
  function drawSide() {
    clear(side);
    const connected = session && session.state === 'connected';
    side.appendChild(h('div.host-card', h('span.art', svg('monitorFill')), h('div', h('div.t', state.hostName), h('div.s', h('span.dot', { class: state.agentOnline ? 'on' : 'off' }), state.agentOnline ? '온라인' : '오프라인', connected && session.remote && session.remote.display ? ` · ${session.remote.display.width}×${session.remote.display.height}` : ''))));
    if (connected) {
      side.appendChild(h('div.block', h('h3', '연결 상태'), h('div.kv', { id: 'stats-kv' }))); drawStats(session.stats);
      side.appendChild(h('div.block', h('h3', '화질'), h('div.quality-list', ...Object.entries(QUALITY).map(([k, q]) => h('button', { class: session.quality === k ? 'active' : '', onclick: () => session.setQuality(k) }, h('span', q.label, h('small', q.desc)), session.quality === k ? svg('check') : null)))));
      side.appendChild(h('div.block', h('h3', '단축키'), h('div.keys', ...(state.shortcuts || []).map((s) => h('button', { disabled: !session.control, onclick: () => session.sendShortcut(s.keys) }, h('b', s.label), h('small', s.desc))))));
      side.appendChild(h('div.block', h('h3', '입력'),
        h('button.btn.tinted.sm.block', { onclick: () => input && input.toggleKeyboard() }, svg('keyboard'), '키보드 띄우기'),
        h('button.btn.tinted.sm.block', { onclick: () => openSendText() }, svg('text'), '텍스트 보내기'),
        h('button.btn.tinted.sm.block', { onclick: (e) => clipboardMenu(e.currentTarget) }, svg('clipboard'), '클립보드')));
      side.appendChild(h('button.btn.primary.block', { onclick: () => setLayout('immersive') }, svg('fullscreen'), '전체화면 모드'));
    } else {
      side.appendChild(h('div.block', h('h3', '사용 방법'), h('div.callout', h('ul', { style: { margin: 0, paddingLeft: '18px' } },
        h('li', '▶ 를 누르면 전체화면으로 시작돼요.'),
        h('li', '위쪽 손잡이를 당기면 툴바가 나와요.'),
        isTouch ? h('li', '탭=클릭 · 끌기=이동 · 길게눌러끌기=드래그 · 두 손가락 스크롤 · 핀치 확대') : h('li', '클릭 후 키보드 입력 · ⌘조합은 "단축키"'),
        h('li', '툴바의 "키보드"로 입력창을 띄워 타이핑해요.')))));
    }
  }
  function drawStats(stv) { const kv = side.querySelector('#stats-kv'); if (!kv || !session) return; clear(kv); const st = stv || {}; const rows = [['해상도', st.width ? `${st.width}×${st.height}` : '—'], ['프레임', st.fps != null ? `${st.fps} fps` : '—'], ['비트레이트', fmtBitrate(st.bitrate)], ['지연', st.rtt != null ? `${Math.round(st.rtt * 1000)} ms` : '—'], ['세션', session.connectedAt ? fmtDuration((Date.now() - session.connectedAt) / 1000) : '—'], ['모드', session.control ? '제어' : '보기']]; for (const [k, v] of rows) kv.append(h('span', k), h('b', v)); }

  unsubs.push(on('viewer', (s) => { if (s !== session) bind(s); }));
  unsubs.push(on('change', (p) => { if ('agentOnline' in p) drawAll(); }));
  bind(session);
  return { cleanup: () => { unsubs.forEach((u) => u()); if (input) input.destroy(); exitLayout(); container.classList.remove('flush'); } };
}
