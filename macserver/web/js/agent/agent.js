// 호스트 화면 에이전트 — 화면 캡처(getDisplayMedia) → WebRTC 송출, 제어 채널 수신 → 네이티브 입력 브리지
// Electron 숨김 창(window.macserverAgent 브리지) 또는 일반 브라우저(/agent?token=…)에서 동작
const bridge = window.macserverAgent || null;
const params = new URLSearchParams(location.search);
const TOKEN = (bridge && bridge.token) || params.get('token');
const FAKE = params.get('fake') === '1';            // 테스트: getUserMedia(가짜 장치)
const logEl = document.getElementById('log'); const statusEl = document.getElementById('status'); const preview = document.getElementById('preview');
const QUALITY = { low: { maxBitrate: 1_500_000, maxFramerate: 15, scale: 2, hint: 'detail' }, auto: { maxBitrate: 6_000_000, maxFramerate: 30, scale: 1, hint: 'detail' }, smooth: { maxBitrate: 8_000_000, maxFramerate: 60, scale: 1, hint: 'motion' }, high: { maxBitrate: 12_000_000, maxFramerate: 30, scale: 1, hint: 'detail' } };

let ws = null, config = { iceServers: [], captureFps: 30, allowControl: true, sharingPaused: false, invertScroll: false };
let stream = null, streamPromise = null, releaseTimer = null;
const sessions = new Map(); // sessionId → { pc, dc, control, viewer, quality }
window.__inputLog = [];     // 브라우저 테스트용

function log(...a) { const line = `[${new Date().toLocaleTimeString()}] ${a.map((x) => typeof x === 'string' ? x : JSON.stringify(x)).join(' ')}`; console.log('[agent]', ...a); if (logEl) { logEl.textContent = (line + '\n' + logEl.textContent).slice(0, 20000); } }
function setStatus(txt, ok) { if (statusEl) { statusEl.textContent = txt; statusEl.className = ok ? 'ok' : ok === false ? 'bad' : ''; } if (bridge && bridge.status) bridge.status(txt); }

// ---------- 시그널링 ----------
function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws?role=agent&token=${encodeURIComponent(TOKEN || '')}`);
  ws.onopen = () => { setStatus('서버 연결됨 · 뷰어 대기 중', true); log('ws open'); sendInfo(); };
  ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch (_) { return; } onMessage(m).catch((err) => { log('error', err.message); send({ type: 'agent:error', error: err.message }); }); };
  ws.onclose = (e) => { setStatus(`서버 연결 끊김 (${e.code}) · 재연결 중…`, false); for (const id of [...sessions.keys()]) endSession(id, 'ws-closed', false); setTimeout(connect, e.code === 4000 ? 5000 : 2000); };
  ws.onerror = () => {};
}
function send(m) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); }
async function sendInfo() {
  let displays = [];
  try { if (bridge && bridge.getDisplays) displays = await bridge.getDisplays(); } catch (_) {}
  send({ type: 'agent:info', info: { mode: bridge ? 'electron' : 'browser', fake: FAKE, displays, ua: navigator.userAgent.slice(0, 80) } });
}

async function onMessage(m) {
  switch (m.type) {
    case 'agent:config': config = { ...config, ...m.config }; log('config', config); if (bridge && bridge.setConfig) bridge.setConfig(config); if (config.sharingPaused) for (const id of [...sessions.keys()]) endSession(id, 'paused'); for (const s of sessions.values()) if (!config.allowControl && s.control) setControl(s, false); break;
    case 'screen:start': await startSession(m); break;
    case 'screen:update': { const s = sessions.get(m.sessionId); if (s && m.control !== undefined) setControl(s, !!m.control); break; }
    case 'screen:end': endSession(m.sessionId, m.reason, false); break;
    case 'signal': { const s = sessions.get(m.sessionId); if (!s) return; await onSignal(s, m.data); break; }
    default: break;
  }
}

// ---------- 캡처 ----------
async function getStream() {
  if (stream && stream.active) return stream;
  if (streamPromise) return streamPromise;
  streamPromise = (async () => {
    const fps = Number(config.captureFps) || 30;
    let s;
    if (FAKE) s = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720, frameRate: fps }, audio: false });
    else s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: fps, max: 60 }, width: { ideal: 3840 }, height: { ideal: 2160 }, displaySurface: 'monitor' }, audio: false, selfBrowserSurface: 'include', surfaceSwitching: 'exclude', systemAudio: 'exclude' });
    const track = s.getVideoTracks()[0];
    try { track.contentHint = 'detail'; } catch (_) {}
    track.onended = () => { log('capture track ended'); stream = null; for (const id of [...sessions.keys()]) endSession(id, 'capture-ended'); };
    if (preview) preview.srcObject = s;
    const st = track.getSettings(); log('capture started', `${st.width}x${st.height}@${st.frameRate}`);
    stream = s; return s;
  })();
  try { return await streamPromise; } finally { streamPromise = null; }
}
function scheduleRelease() {
  clearTimeout(releaseTimer);
  releaseTimer = setTimeout(() => { if (!sessions.size && stream) { for (const t of stream.getTracks()) t.stop(); stream = null; if (preview) preview.srcObject = null; log('capture released'); } }, 15000);
}

// ---------- 세션 ----------
async function startSession(m) {
  if (sessions.has(m.sessionId)) endSession(m.sessionId, 'restart', false);
  const s = { id: m.sessionId, viewer: m.viewer, control: !!m.control && config.allowControl, pc: null, dc: null, quality: 'auto', pendingIce: [] };
  sessions.set(s.id, s); clearTimeout(releaseTimer);
  log('session start', s.viewer, 'control=' + s.control);
  let media;
  try { media = await getStream(); }
  catch (e) { log('capture failed', e.name, e.message); send({ type: 'screen:state', sessionId: s.id, state: 'ended', reason: 'capture-failed' }); send({ type: 'agent:error', error: '화면 캡처 실패: ' + (e.message || e.name) + ' (시스템 설정 > 개인정보 보호 및 보안 > 화면 기록 권한을 확인하세요)' }); sessions.delete(s.id); return; }
  const pc = new RTCPeerConnection({ iceServers: config.iceServers || [], bundlePolicy: 'max-bundle' });
  s.pc = pc;
  const track = media.getVideoTracks()[0];
  const sender = pc.addTrack(track, media);
  s.sender = sender;
  // 코덱 선호: H.264(하드웨어) → VP9 → VP8
  try {
    const tr = pc.getTransceivers().find((t) => t.sender === sender);
    if (tr && tr.setCodecPreferences && RTCRtpSender.getCapabilities) {
      const caps = RTCRtpSender.getCapabilities('video').codecs;
      const pref = [...caps.filter((c) => /H264/i.test(c.mimeType)), ...caps.filter((c) => /VP9/i.test(c.mimeType)), ...caps.filter((c) => /VP8/i.test(c.mimeType)), ...caps.filter((c) => !/H264|VP9|VP8/i.test(c.mimeType))];
      tr.setCodecPreferences(pref);
    }
  } catch (_) {}
  const dc = pc.createDataChannel('control', { ordered: true });
  s.dc = dc;
  dc.onopen = () => { log('dc open', s.id); dcSend(s, { t: 'hello', control: s.control, display: displayInfo(track) }); applyQuality(s, s.quality); };
  dc.onmessage = (e) => onControl(s, e.data);
  pc.onicecandidate = (e) => send({ type: 'signal', sessionId: s.id, data: { candidate: e.candidate ? e.candidate.toJSON() : null } });
  pc.onconnectionstatechange = () => {
    log('pc', s.id, pc.connectionState);
    if (pc.connectionState === 'connected') send({ type: 'screen:state', sessionId: s.id, state: 'connected' });
    else if (pc.connectionState === 'failed') endSession(s.id, 'ice-failed');
    else if (pc.connectionState === 'closed') endSession(s.id, 'closed');
  };
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  send({ type: 'signal', sessionId: s.id, data: { sdp: pc.localDescription, iceServers: config.iceServers } });
  send({ type: 'screen:state', sessionId: s.id, state: 'offered' });
  s.statsTimer = setInterval(() => reportStats(s), 5000);
}
async function onSignal(s, data) {
  if (data.sdp) { await s.pc.setRemoteDescription(data.sdp); for (const c of s.pendingIce) { try { await s.pc.addIceCandidate(c); } catch (_) {} } s.pendingIce = []; }
  else if (data.candidate !== undefined) { if (s.pc.remoteDescription) { try { await s.pc.addIceCandidate(data.candidate || undefined); } catch (e) { log('ice add failed', e.message); } } else s.pendingIce.push(data.candidate); }
}
function endSession(id, reason, notify = true) {
  const s = sessions.get(id); if (!s) return;
  sessions.delete(id); clearInterval(s.statsTimer);
  try { s.dc && s.dc.close(); } catch (_) {} try { s.pc && s.pc.close(); } catch (_) {}
  if (bridge && bridge.input) bridge.input([{ t: 'release' }]);
  if (notify) send({ type: 'screen:state', sessionId: id, state: 'ended', reason });
  log('session end', id, reason);
  if (!sessions.size) scheduleRelease();
}
function setControl(s, enabled) { s.control = enabled && config.allowControl; dcSend(s, { t: 'control', enabled: s.control }); if (!s.control && bridge && bridge.input) bridge.input([{ t: 'release' }]); }
function dcSend(s, m) { if (s.dc && s.dc.readyState === 'open') { try { s.dc.send(JSON.stringify(m)); } catch (_) {} } }
function displayInfo(track) { const st = track.getSettings(); return { width: st.width, height: st.height, frameRate: st.frameRate }; }
async function applyQuality(s, preset) {
  const q = QUALITY[preset] || QUALITY.auto; s.quality = preset;
  try {
    const p = s.sender.getParameters(); if (!p.encodings || !p.encodings.length) p.encodings = [{}];
    p.encodings[0].maxBitrate = q.maxBitrate; p.encodings[0].maxFramerate = q.maxFramerate; p.encodings[0].scaleResolutionDownBy = q.scale;
    p.degradationPreference = q.hint === 'motion' ? 'maintain-framerate' : 'maintain-resolution';
    await s.sender.setParameters(p);
    const track = s.sender.track; if (track) track.contentHint = q.hint;
  } catch (e) { log('setParameters failed', e.message); }
}
async function reportStats(s) {
  try {
    const r = await s.pc.getStats(); let out = null;
    r.forEach((x) => { if (x.type === 'outbound-rtp' && x.kind === 'video') out = x; });
    if (out) send({ type: 'screen:state', sessionId: s.id, state: 'connected', stats: { fps: Math.round(out.framesPerSecond || 0), width: out.frameWidth, height: out.frameHeight, encoder: out.encoderImplementation, quality: s.quality, qualityLimitation: out.qualityLimitationReason } });
  } catch (_) {}
}

// ---------- 제어 채널 ----------
async function onControl(s, raw) {
  let events; try { events = JSON.parse(raw); } catch (_) { return; }
  if (!Array.isArray(events)) events = [events];
  const inputs = [];
  for (const ev of events) {
    if (!ev || typeof ev.t !== 'string') continue;
    switch (ev.t) {
      case 'quality': applyQuality(s, ev.preset); break;
      case 'ping': dcSend(s, { t: 'pong', ts: ev.ts }); break;
      case 'clipboard:get': { if (bridge && bridge.readClipboard) { try { dcSend(s, { t: 'clipboard', text: await bridge.readClipboard() }); } catch (e) { dcSend(s, { t: 'error', error: e.message }); } } else dcSend(s, { t: 'clipboard', text: null }); break; }
      case 'clipboard': { if (!s.control) break; if (bridge && bridge.writeClipboard) bridge.writeClipboard(String(ev.text || '')); window.__inputLog.push(ev); break; }
      case 'release': inputs.push(ev); break;
      default:
        if (!s.control || config.sharingPaused) break;
        if (ev.t === 'wheel' && config.invertScroll) { ev.dx = -ev.dx; ev.dy = -ev.dy; }
        inputs.push(ev);
    }
  }
  if (!inputs.length) return;
  if (bridge && bridge.input) { try { await bridge.input(inputs); } catch (e) { dcSend(s, { t: 'error', error: e.message }); log('input error', e.message); } }
  else { window.__inputLog.push(...inputs); if (window.__inputLog.length > 500) window.__inputLog.splice(0, window.__inputLog.length - 500); }
}

// ---------- 시작 ----------
if (!TOKEN) { setStatus('토큰이 없습니다. macserver 앱에서 자동으로 열리거나, 서버 콘솔에 출력된 에이전트 주소로 접속하세요.', false); }
else {
  if (!bridge) { const b = document.createElement('button'); b.textContent = '화면 캡처 미리 시작 (권한 확인)'; b.onclick = () => getStream().catch((e) => setStatus('캡처 실패: ' + e.message, false)); document.getElementById('actions').appendChild(b); }
  connect();
}
window.addEventListener('beforeunload', () => { for (const id of [...sessions.keys()]) endSession(id, 'agent-unload'); });
