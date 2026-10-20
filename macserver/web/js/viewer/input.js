// 뷰어 입력 — 데스크톱(마우스/휠/물리키) + 모바일(터치 제스처/핀치 확대/화면 키보드)
// 좌표는 비디오의 현재 렌더 영역(확대/이동 변환 반영) 기준 0~1 정규화로 전송.
export function attachInput(stage, video, session, opts = {}) {
  const getMode = opts.getMode || (() => 'touch'); // 'touch' | 'trackpad'
  const surface = video; // 변환(확대/이동)을 적용할 요소
  const evEl = opts.surface || video.parentElement || stage; // 포인터 이벤트 대상 (툴바/오버레이와 분리)
  let scale = 1, tx = 0, ty = 0;
  const MINZ = 1, MAXZ = 4.5;

  // ---- 좌표 매핑 (현재 변환 반영) ----
  function norm(cx, cy) {
    const r = video.getBoundingClientRect();
    const vw = video.videoWidth || 16, vh = video.videoHeight || 9;
    const s = Math.min(r.width / vw, r.height / vh);
    const dw = vw * s, dh = vh * s;
    const ox = r.left + (r.width - dw) / 2, oy = r.top + (r.height - dh) / 2;
    const x = (cx - ox) / dw, y = (cy - oy) / dh;
    return { x: clamp01(x), y: clamp01(y), inside: x >= -0.02 && x <= 1.02 && y >= -0.02 && y <= 1.02 };
  }
  const clamp01 = (v) => Math.max(0, Math.min(1, v));

  // ---- 확대/이동 ----
  function applyTransform() {
    const w = stage.clientWidth, h = stage.clientHeight;
    const sw = w * scale, sh = h * scale;
    tx = Math.min(0, Math.max(w - sw, tx));
    ty = Math.min(0, Math.max(h - sh, ty));
    if (scale <= 1.001) { tx = 0; ty = 0; }
    surface.style.transformOrigin = '0 0';
    surface.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    stage.classList.toggle('zoomed', scale > 1.001);
    if (opts.onZoom) opts.onZoom(scale);
  }
  function zoomAt(cx, cy, factor) {
    const rect = stage.getBoundingClientRect();
    const px = cx - rect.left, py = cy - rect.top;
    const next = Math.max(MINZ, Math.min(MAXZ, scale * factor));
    if (next === scale) return;
    // 포커스 지점이 고정되도록 translate 보정
    const k = next / scale;
    tx = px - (px - tx) * k; ty = py - (py - ty) * k;
    scale = next; applyTransform();
  }
  function setZoom(z, cx, cy) { const rect = stage.getBoundingClientRect(); zoomAt(cx ?? rect.left + rect.width / 2, cy ?? rect.top + rect.height / 2, z / scale); }
  function resetView() { scale = 1; tx = 0; ty = 0; applyTransform(); }

  // ---- 가상 커서 표시 (터치) ----
  const cursor = document.createElement('div'); cursor.className = 'touch-cursor'; stage.appendChild(cursor);
  let cursorHideT = 0;
  function showCursor(cx, cy) { cursor.style.left = (cx - stage.getBoundingClientRect().left) + 'px'; cursor.style.top = (cy - stage.getBoundingClientRect().top) + 'px'; cursor.classList.add('on'); clearTimeout(cursorHideT); cursorHideT = setTimeout(() => cursor.classList.remove('on'), 1500); }

  // ================= 데스크톱(마우스) =================
  let moveQ = null, raf = 0; const downBtns = new Set(); let lastClick = { t: 0, x: 0, y: 0, b: 0, n: 0 };
  const flush = () => { raf = 0; if (moveQ) { session.sendInput([moveQ]); moveQ = null; } };
  function mouseMove(e) { if (!session.control) return; const p = norm(e.clientX, e.clientY); moveQ = { t: 'move', x: p.x, y: p.y }; if (!raf) raf = requestAnimationFrame(flush); }
  function mouseDown(e) {
    stage.focus({ preventScroll: true });
    if (!session.control) return; const p = norm(e.clientX, e.clientY); if (!p.inside) return; e.preventDefault();
    try { evEl.setPointerCapture(e.pointerId); } catch (_) {}
    const now = Date.now(); const near = Math.abs(e.clientX - lastClick.x) < 6 && Math.abs(e.clientY - lastClick.y) < 6;
    lastClick.n = (now - lastClick.t < 400 && near && lastClick.b === e.button) ? lastClick.n + 1 : 1;
    lastClick = { t: now, x: e.clientX, y: e.clientY, b: e.button, n: lastClick.n };
    downBtns.add(e.button); if (moveQ) { session.sendInput([moveQ]); moveQ = null; }
    session.sendInput([{ t: 'down', x: p.x, y: p.y, b: e.button, n: lastClick.n }]);
  }
  function mouseUp(e) { if (!session.control || !downBtns.has(e.button)) return; downBtns.delete(e.button); const p = norm(e.clientX, e.clientY); session.sendInput([{ t: 'up', x: p.x, y: p.y, b: e.button }]); }
  function wheel(e) { if (!session.control) return; e.preventDefault(); const p = norm(e.clientX, e.clientY); if (!p.inside) return; const f = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1; session.sendInput([{ t: 'wheel', x: p.x, y: p.y, dx: Math.round(e.deltaX * f), dy: Math.round(e.deltaY * f) }]); }

  // ================= 모바일(터치) =================
  const pts = new Map(); // pointerId -> {x,y,x0,y0,t0}
  let gesture = null; // 'tap'|'drag'|'pan'|'pinch'|'scroll'|'press'
  let pressTimer = 0, pressActive = false, movedFar = false;
  let pinchStart = 0, scrollAccum = 0, lastTapTime = 0, lastTapPos = { x: 0, y: 0 };
  const TAP_MS = 300, MOVE_TOL = 10, PRESS_MS = 500;

  function touchDown(e) {
    stage.focus({ preventScroll: true });
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: Date.now() });
    try { evEl.setPointerCapture(e.pointerId); } catch (_) {}
    if (pts.size === 1) {
      movedFar = false; pressActive = false; gesture = 'tap';
      showCursor(e.clientX, e.clientY);
      clearTimeout(pressTimer);
      pressTimer = setTimeout(() => {
        if (pts.size === 1 && !movedFar && session.control && scale <= 1.001) {
          pressActive = true; gesture = 'press'; const p = norm(e.clientX, e.clientY);
          navigator.vibrate && navigator.vibrate(15);
          session.sendInput([{ t: 'move', x: p.x, y: p.y }, { t: 'down', x: p.x, y: p.y, b: 0 }]);
          stage.classList.add('dragging');
        }
      }, PRESS_MS);
    } else if (pts.size === 2) {
      clearTimeout(pressTimer);
      const [a, b] = [...pts.values()]; pinchStart = dist(a, b); scrollAccum = 0; gesture = 'twofinger';
    }
  }
  function touchMove(e) {
    const p = pts.get(e.pointerId); if (!p) return;
    p.x = e.clientX; p.y = e.clientY;
    if (pts.size === 1) {
      const dx = e.clientX - p.x0, dy = e.clientY - p.y0;
      if (!movedFar && Math.hypot(e.clientX - p.x0, e.clientY - p.y0) > MOVE_TOL) movedFar = true;
      if (pressActive) { // 드래그(길게 눌러 끌기)
        const n = norm(e.clientX, e.clientY); showCursor(e.clientX, e.clientY); session.sendInput([{ t: 'move', x: n.x, y: n.y }]);
      } else if (scale > 1.001) { // 확대 상태: 팬(이동)
        gesture = 'pan'; tx += (e.clientX - (p.px ?? e.clientX)); ty += (e.clientY - (p.py ?? e.clientY)); applyTransform();
      } else if (movedFar && session.control) { // 커서 이동(탭 모드)
        gesture = 'move'; const n = norm(e.clientX, e.clientY); showCursor(e.clientX, e.clientY); session.sendInput([{ t: 'move', x: n.x, y: n.y }]);
      }
      p.px = e.clientX; p.py = e.clientY;
    } else if (pts.size === 2) {
      const [a, b] = [...pts.values()]; const d = dist(a, b); const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const dpz = Math.abs(d - pinchStart);
      // 핀치 확대 vs 두 손가락 스크롤 판별
      if (gesture === 'twofinger') gesture = dpz > 12 ? 'pinch' : 'scroll';
      if (gesture === 'pinch') { zoomAt(mid.x, mid.y, d / pinchStart); pinchStart = d; }
      else if (gesture === 'scroll' && session.control) {
        const avgDy = ((a.y - (a.py ?? a.y)) + (b.y - (b.py ?? b.y))) / 2;
        const avgDx = ((a.x - (a.px ?? a.x)) + (b.x - (b.px ?? b.x))) / 2;
        if (Math.abs(avgDy) > 0.3 || Math.abs(avgDx) > 0.3) {
          const n = norm(mid.x, mid.y); session.sendInput([{ t: 'wheel', x: n.x, y: n.y, dx: Math.round(-avgDx * 2), dy: Math.round(-avgDy * 2) }]);
        }
      }
      for (const q of [a, b]) { q.px = q.x; q.py = q.y; }
    }
  }
  function touchUp(e) {
    const p = pts.get(e.pointerId); const had = pts.size; pts.delete(e.pointerId); clearTimeout(pressTimer);
    if (!p) return;
    const dt = Date.now() - p.t0;
    if (pressActive && had === 1) { // 드래그 종료
      const n = norm(e.clientX, e.clientY); session.sendInput([{ t: 'up', x: n.x, y: n.y, b: 0 }]); pressActive = false; stage.classList.remove('dragging');
    } else if (had === 1 && !movedFar && dt < TAP_MS && session.control) { // 한 손가락 탭 = 클릭
      const n = norm(e.clientX, e.clientY);
      const now = Date.now(); const near = Math.abs(e.clientX - lastTapPos.x) < 24 && Math.abs(e.clientY - lastTapPos.y) < 24;
      const dbl = now - lastTapTime < 320 && near;
      lastTapTime = now; lastTapPos = { x: e.clientX, y: e.clientY };
      showCursor(e.clientX, e.clientY);
      session.sendInput([{ t: 'move', x: n.x, y: n.y }, { t: 'down', x: n.x, y: n.y, b: 0, n: dbl ? 2 : 1 }, { t: 'up', x: n.x, y: n.y, b: 0 }]);
    } else if (had === 2 && gesture === 'twofinger' && dt < TAP_MS && session.control) { // 두 손가락 탭 = 우클릭
      const n = norm(e.clientX, e.clientY); session.sendInput([{ t: 'move', x: n.x, y: n.y }, { t: 'down', x: n.x, y: n.y, b: 2 }, { t: 'up', x: n.x, y: n.y, b: 2 }]);
    }
    if (pts.size === 0) gesture = null;
    if (pts.size === 1) { const only = [...pts.values()][0]; only.px = only.x; only.py = only.y; gesture = 'tap'; movedFar = true; }
  }
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  // ================= 분기 =================
  function onPointerDown(e) { if (e.pointerType === 'touch') { e.preventDefault(); touchDown(e); } else mouseDown(e); }
  function onPointerMove(e) { if (e.pointerType === 'touch') { e.preventDefault(); touchMove(e); } else mouseMove(e); }
  function onPointerUp(e) { if (e.pointerType === 'touch') { e.preventDefault(); touchUp(e); } else mouseUp(e); }
  function onContext(e) { e.preventDefault(); }

  // ================= 물리 키보드 (데스크톱) =================
  const pressedKeys = new Set();
  function onKeyDown(e) {
    if (!session.control || !session.capturingKeys) return;
    if (e.code === 'Escape' && e.shiftKey && e.metaKey) { releaseKeys(); return; }
    e.preventDefault(); e.stopPropagation();
    if (e.repeat && !isMod(e.code)) { session.sendInput([{ t: 'key', code: e.code, down: true, key: e.key, repeat: true }]); return; }
    if (e.repeat) return; pressedKeys.add(e.code); session.sendInput([{ t: 'key', code: e.code, down: true, key: e.key }]);
  }
  function onKeyUp(e) { if (!session.capturingKeys) return; e.preventDefault(); e.stopPropagation(); pressedKeys.delete(e.code); session.sendInput([{ t: 'key', code: e.code, down: false, key: e.key }]); }
  const releaseKeys = () => { if (pressedKeys.size || downBtns.size) { session.sendInput([{ t: 'release' }]); pressedKeys.clear(); downBtns.clear(); } if (pressActive) { pressActive = false; stage.classList.remove('dragging'); } };
  function onBlur() { releaseKeys(); session.capturingKeys = false; stage.classList.remove('kb'); session._emit && session._emit('keyboard', false); }
  function onFocus() { if (session.control && !kb.open) { session.capturingKeys = true; stage.classList.add('kb'); session._emit && session._emit('keyboard', true); } }

  // ================= 화면 키보드 (모바일) =================
  const kb = { open: false };
  const hidden = document.createElement('input');
  hidden.className = 'kb-capture'; hidden.setAttribute('autocapitalize', 'off'); hidden.setAttribute('autocomplete', 'off'); hidden.setAttribute('autocorrect', 'off'); hidden.setAttribute('spellcheck', 'false'); hidden.setAttribute('aria-hidden', 'true');
  stage.appendChild(hidden);
  let composing = false;
  hidden.addEventListener('compositionstart', () => { composing = true; });
  hidden.addEventListener('compositionend', (e) => { composing = false; if (e.data && session.control) session.sendText(e.data); hidden.value = ''; });
  hidden.addEventListener('input', (e) => {
    if (composing) return;
    const it = e.inputType || '';
    if (it.startsWith('delete') || it === 'insertLineBreak') { hidden.value = ''; return; } // 특수키는 keydown 에서 처리
    if (e.data && session.control) session.sendText(e.data);
    hidden.value = '';
  });
  const SPECIAL = { Backspace: 'Backspace', Enter: 'Enter', Tab: 'Tab', Escape: 'Escape', ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown', ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight', Delete: 'Delete', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown' };
  hidden.addEventListener('keydown', (e) => {
    if (composing) return;
    if (SPECIAL[e.code] || SPECIAL[e.key]) { e.preventDefault(); const code = SPECIAL[e.code] || SPECIAL[e.key]; if (session.control) session.sendInput([{ t: 'key', code, down: true }, { t: 'key', code, down: false }]); }
  });
  hidden.addEventListener('blur', () => { if (kb.open) setKeyboard(false); });
  function setKeyboard(on) {
    kb.open = on;
    if (on) { hidden.value = ''; hidden.focus({ preventScroll: true }); stage.classList.add('kb-open'); }
    else { hidden.blur(); stage.classList.remove('kb-open'); }
    if (opts.onKeyboard) opts.onKeyboard(on);
  }

  const isMod = (c) => /^(Shift|Control|Alt|Meta)(Left|Right)$|^CapsLock$/.test(c);
  function onVisibility() { if (document.hidden) releaseKeys(); }

  // ---- 바인딩 ----
  stage.style.touchAction = 'none'; evEl.style.touchAction = 'none';
  evEl.addEventListener('pointerdown', onPointerDown);
  evEl.addEventListener('pointermove', onPointerMove);
  evEl.addEventListener('pointerup', onPointerUp);
  evEl.addEventListener('pointercancel', onPointerUp);
  evEl.addEventListener('wheel', wheel, { passive: false });
  evEl.addEventListener('contextmenu', onContext);
  stage.addEventListener('keydown', onKeyDown);
  stage.addEventListener('keyup', onKeyUp);
  stage.addEventListener('blur', onBlur);
  stage.addEventListener('focus', onFocus);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('blur', onBlur);

  applyTransform();

  return {
    destroy() {
      releaseKeys(); clearTimeout(pressTimer); clearTimeout(cursorHideT); cancelAnimationFrame(raf);
      evEl.removeEventListener('pointerdown', onPointerDown); evEl.removeEventListener('pointermove', onPointerMove); evEl.removeEventListener('pointerup', onPointerUp); evEl.removeEventListener('pointercancel', onPointerUp);
      evEl.removeEventListener('wheel', wheel); evEl.removeEventListener('contextmenu', onContext); stage.removeEventListener('keydown', onKeyDown); stage.removeEventListener('keyup', onKeyUp);
      stage.removeEventListener('blur', onBlur); stage.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onVisibility); window.removeEventListener('blur', onBlur);
      surface.style.transform = ''; try { cursor.remove(); hidden.remove(); } catch (_) {}
    },
    zoomIn: () => setZoom(Math.min(MAXZ, scale + 0.5)),
    zoomOut: () => setZoom(Math.max(MINZ, scale - 0.5)),
    resetView, getZoom: () => scale, isZoomed: () => scale > 1.001,
    openKeyboard: () => setKeyboard(true), closeKeyboard: () => setKeyboard(false), toggleKeyboard: () => setKeyboard(!kb.open), keyboardOpen: () => kb.open,
    releaseKeys,
  };
}
