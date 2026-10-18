// 뷰어 입력 캡처 — 포인터/휠/키보드 이벤트를 정규화하여 세션으로 전송
export function attachInput(stage, video, session) {
  let moveQueued = null, rafId = 0, downButtons = new Set(), lastClick = { t: 0, x: 0, y: 0, n: 0 };
  const pressedKeys = new Set();

  /** 비디오의 실제 표시 영역(레터박스 제외) 기준 정규화 좌표 */
  function norm(e) {
    const r = video.getBoundingClientRect();
    const vw = video.videoWidth || 16, vh = video.videoHeight || 9;
    const scale = Math.min(r.width / vw, r.height / vh);
    const dw = vw * scale, dh = vh * scale;
    const ox = r.left + (r.width - dw) / 2, oy = r.top + (r.height - dh) / 2;
    const x = (e.clientX - ox) / dw, y = (e.clientY - oy) / dh;
    return { x: clamp(x), y: clamp(y), inside: x >= 0 && x <= 1 && y >= 0 && y <= 1 };
  }
  const clamp = (v) => Math.max(0, Math.min(1, v));
  const flush = () => { rafId = 0; if (moveQueued) { session.sendInput([moveQueued]); moveQueued = null; } };

  const onPointerMove = (e) => { if (!session.control) return; const p = norm(e); moveQueued = { t: 'move', x: p.x, y: p.y }; if (!rafId) rafId = requestAnimationFrame(flush); };
  const onPointerDown = (e) => {
    stage.focus({ preventScroll: true });
    if (!session.control) return;
    const p = norm(e); if (!p.inside) return;
    e.preventDefault();
    try { stage.setPointerCapture(e.pointerId); } catch (_) {}
    const now = Date.now();
    const near = Math.abs(e.clientX - lastClick.x) < 6 && Math.abs(e.clientY - lastClick.y) < 6;
    lastClick.n = (now - lastClick.t < 400 && near && lastClick.b === e.button) ? lastClick.n + 1 : 1;
    lastClick = { ...lastClick, t: now, x: e.clientX, y: e.clientY, b: e.button };
    downButtons.add(e.button);
    if (moveQueued) { session.sendInput([moveQueued]); moveQueued = null; }
    session.sendInput([{ t: 'down', x: p.x, y: p.y, b: e.button, n: lastClick.n }]);
  };
  const onPointerUp = (e) => { if (!session.control) return; if (!downButtons.has(e.button)) return; downButtons.delete(e.button); const p = norm(e); session.sendInput([{ t: 'up', x: p.x, y: p.y, b: e.button }]); };
  const onWheel = (e) => {
    if (!session.control) return; e.preventDefault();
    const p = norm(e); if (!p.inside) return;
    const f = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1;
    session.sendInput([{ t: 'wheel', x: p.x, y: p.y, dx: Math.round(e.deltaX * f), dy: Math.round(e.deltaY * f) }]);
  };
  const onContext = (e) => { e.preventDefault(); };
  const onKeyDown = (e) => {
    if (!session.control || !session.capturingKeys) return;
    if (e.code === 'Escape' && e.shiftKey && e.metaKey) { releaseKeys(); return; } // 비상 해제: ⇧⌘Esc
    e.preventDefault(); e.stopPropagation();
    if (e.repeat && !isModifier(e.code)) { session.sendInput([{ t: 'key', code: e.code, down: true, key: e.key, repeat: true }]); return; }
    if (e.repeat) return;
    pressedKeys.add(e.code);
    session.sendInput([{ t: 'key', code: e.code, down: true, key: e.key }]);
  };
  const onKeyUp = (e) => {
    if (!session.capturingKeys) return;
    e.preventDefault(); e.stopPropagation();
    pressedKeys.delete(e.code);
    session.sendInput([{ t: 'key', code: e.code, down: false, key: e.key }]);
  };
  const releaseKeys = () => { if (pressedKeys.size || downButtons.size) { session.sendInput([{ t: 'release' }]); pressedKeys.clear(); downButtons.clear(); } };
  const onBlur = () => { releaseKeys(); session.capturingKeys = false; stage.classList.remove('kb'); session._emit && session._emit('keyboard', false); };
  const onFocus = () => { if (session.control) { session.capturingKeys = true; stage.classList.add('kb'); session._emit && session._emit('keyboard', true); } };
  const onVisibility = () => { if (document.hidden) releaseKeys(); };

  stage.addEventListener('pointermove', onPointerMove);
  stage.addEventListener('pointerdown', onPointerDown);
  stage.addEventListener('pointerup', onPointerUp);
  stage.addEventListener('pointercancel', onPointerUp);
  stage.addEventListener('wheel', onWheel, { passive: false });
  stage.addEventListener('contextmenu', onContext);
  stage.addEventListener('keydown', onKeyDown);
  stage.addEventListener('keyup', onKeyUp);
  stage.addEventListener('blur', onBlur);
  stage.addEventListener('focus', onFocus);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('blur', onBlur);
  return () => {
    releaseKeys();
    stage.removeEventListener('pointermove', onPointerMove); stage.removeEventListener('pointerdown', onPointerDown); stage.removeEventListener('pointerup', onPointerUp); stage.removeEventListener('pointercancel', onPointerUp);
    stage.removeEventListener('wheel', onWheel); stage.removeEventListener('contextmenu', onContext); stage.removeEventListener('keydown', onKeyDown); stage.removeEventListener('keyup', onKeyUp);
    stage.removeEventListener('blur', onBlur); stage.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onVisibility); window.removeEventListener('blur', onBlur);
    cancelAnimationFrame(rafId);
  };
}
function isModifier(code) { return /^(Shift|Control|Alt|Meta)(Left|Right)$|^CapsLock$/.test(code); }
