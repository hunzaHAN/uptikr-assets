// 화면 세션 (뷰어 측) — 시그널링 WS + RTCPeerConnection + 제어 데이터채널
import { state, set, emit } from '../state.js';

const QUALITY = {
  low:    { label: '저대역폭', desc: '~1.5 Mbps · 15fps · 축소', maxBitrate: 1_500_000, maxFramerate: 15, scale: 2, hint: 'detail' },
  auto:   { label: '자동', desc: '네트워크에 맞춰 조절', maxBitrate: 6_000_000, maxFramerate: 30, scale: 1, hint: 'detail' },
  smooth: { label: '부드럽게', desc: '동영상·애니메이션 우선', maxBitrate: 8_000_000, maxFramerate: 60, scale: 1, hint: 'motion' },
  high:   { label: '고화질', desc: '텍스트 선명도 우선 · ~12 Mbps', maxBitrate: 12_000_000, maxFramerate: 30, scale: 1, hint: 'detail' },
};
export { QUALITY };

export class ScreenSession {
  constructor({ wantControl = true } = {}) {
    this.wantControl = wantControl;
    this.state = 'idle'; this.reason = null; this.sessionId = null;
    this.pc = null; this.dc = null; this.ws = null; this.stream = null;
    this.control = false; this.canControl = false; this.paused = false;
    this.quality = localStorage.getItem('ms.quality') || 'auto';
    this.connectedAt = null; this.stats = {}; this.remote = null;
    this.capturingKeys = false;
    this._listeners = new Map(); this._statsTimer = null; this._pendingIce = [];
    this._lastBytes = 0; this._lastTs = 0;
  }
  on(evt, fn) { if (!this._listeners.has(evt)) this._listeners.set(evt, new Set()); this._listeners.get(evt).add(fn); return () => this._listeners.get(evt).delete(fn); }
  _emit(evt, data) { const s = this._listeners.get(evt); if (s) for (const fn of [...s]) { try { fn(data); } catch (e) { console.error(e); } } }
  _setState(s, reason) { this.state = s; if (reason !== undefined) this.reason = reason; this._emit('state', { state: s, reason: this.reason }); set({ viewer: this }); }

  start() {
    if (this.state !== 'idle' && this.state !== 'ended') return;
    this._setState('connecting', null);
    set({ viewer: this }); emit('viewer', this);
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws?role=viewer`);
    this.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ type: 'screen:request', wantControl: this.wantControl }));
    ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch (_) { return; } this._onWs(m); };
    ws.onclose = () => { if (this.state !== 'ended') this._end(this.reason || '서버와의 연결이 끊어졌어요.'); };
    ws.onerror = () => {};
  }
  async _onWs(m) {
    switch (m.type) {
      case 'screen:pending': this._setState('pending', m.reason); break;
      case 'screen:accepted': this.sessionId = m.sessionId; this.control = !!m.control; this.canControl = !!m.control; this._setState('connecting', '호스트와 연결 중…'); this._emit('control', this.control); break;
      case 'screen:denied': this._end(m.reason || '거절되었어요.'); break;
      case 'screen:ended': this._end(reasonText(m.reason)); break;
      case 'screen:update': if (m.control !== undefined) { this.canControl = !!m.control; if (!m.control) this.control = false; this._emit('control', this.control); } break;
      case 'screen:state': if (m.state === 'ended') this._end(reasonText(m.reason)); break;
      case 'signal': await this._onSignal(m.data); break;
      case 'error': this._end(m.error); break;
      default: break;
    }
  }
  async _onSignal(data) {
    try {
      if (data.sdp) {
        if (!this.pc) this._createPc(data.iceServers);
        await this.pc.setRemoteDescription(data.sdp);
        for (const c of this._pendingIce) { try { await this.pc.addIceCandidate(c); } catch (_) {} } this._pendingIce = [];
        if (data.sdp.type === 'offer') { const ans = await this.pc.createAnswer(); await this.pc.setLocalDescription(ans); this._signal({ sdp: this.pc.localDescription }); }
      } else if (data.candidate !== undefined) {
        if (this.pc && this.pc.remoteDescription) { try { await this.pc.addIceCandidate(data.candidate || undefined); } catch (_) {} } else this._pendingIce.push(data.candidate);
      }
    } catch (e) { console.error('signal error', e); this._end('연결 협상 실패: ' + e.message); }
  }
  _signal(data) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ type: 'signal', sessionId: this.sessionId, data })); }
  _createPc(iceServers) {
    const pc = new RTCPeerConnection({ iceServers: iceServers || [{ urls: ['stun:stun.l.google.com:19302'] }], bundlePolicy: 'max-bundle' });
    this.pc = pc;
    pc.onicecandidate = (e) => this._signal({ candidate: e.candidate ? e.candidate.toJSON() : null });
    pc.ontrack = (e) => { this.stream = e.streams[0] || new MediaStream([e.track]); this._emit('stream', this.stream); if (this.state !== 'connected') { this.connectedAt = Date.now(); this._setState('connected', null); this._startStats(); } };
    pc.ondatachannel = (e) => { this.dc = e.channel; this.dc.onmessage = (ev) => this._onDc(ev.data); this.dc.onopen = () => { this.sendControl({ t: 'quality', preset: this.quality }); this._emit('dc'); }; };
    pc.onconnectionstatechange = () => { const s = pc.connectionState; if (s === 'failed') this._end('연결이 실패했어요. 네트워크(NAT/방화벽)를 확인하세요.'); else if (s === 'disconnected') { this._emit('state', { state: this.state, reason: '연결 불안정…' }); setTimeout(() => { if (pc.connectionState === 'disconnected') { try { pc.restartIce(); } catch (_) {} } }, 2000); } else if (s === 'connected') this._emit('state', { state: this.state, reason: null }); };
  }
  _onDc(raw) {
    let m; try { m = JSON.parse(raw); } catch (_) { return; }
    if (m.t === 'hello') { this.remote = m; this._emit('remote', m); }
    else if (m.t === 'control') { this.control = !!m.enabled && this.canControl; this._emit('control', this.control); }
    else if (m.t === 'clipboard') this._emit('clipboard', m.text);
    else if (m.t === 'pong') this.stats.appRtt = Date.now() - m.ts;
    else if (m.t === 'error') this._emit('remoteError', m.error);
  }
  sendInput(events) { if (!this.dc || this.dc.readyState !== 'open' || !this.control || this.paused) return false; try { this.dc.send(JSON.stringify(events)); return true; } catch (_) { return false; } }
  sendControl(msg) { if (!this.dc || this.dc.readyState !== 'open') return false; try { this.dc.send(JSON.stringify([msg])); return true; } catch (_) { return false; } }
  toggleControl(v) { if (!this.canControl) return; this.control = v === undefined ? !this.control : !!v; this.sendControl({ t: 'release' }); this._emit('control', this.control); set({ viewer: this }); }
  togglePause() { this.paused = !this.paused; if (this.stream) for (const t of this.stream.getVideoTracks()) t.enabled = !this.paused; this.sendControl({ t: 'release' }); this._emit('state', { state: this.state }); set({ viewer: this }); }
  setQuality(preset) { if (!QUALITY[preset]) return; this.quality = preset; localStorage.setItem('ms.quality', preset); this.sendControl({ t: 'quality', preset }); this._emit('quality', preset); }
  sendText(text) { if (text) this.sendControl({ t: 'text', text }); }
  sendShortcut(keys) { const ev = []; for (const k of keys) { const mods = k.mods || []; for (const m of mods) ev.push({ t: 'key', code: MOD_CODE[m], down: true }); ev.push({ t: 'key', code: k.code, down: true }); ev.push({ t: 'key', code: k.code, down: false }); for (const m of [...mods].reverse()) ev.push({ t: 'key', code: MOD_CODE[m], down: false }); } return this.sendInput(ev); }
  setClipboard(text) { this.sendControl({ t: 'clipboard', text }); }
  requestClipboard() { this.sendControl({ t: 'clipboard:get' }); }
  stop(reason = 'user') {
    if (this.ws && this.ws.readyState === 1) { try { this.ws.send(JSON.stringify({ type: 'screen:stop' })); } catch (_) {} }
    this._end(reason === 'user' ? '연결을 끊었어요.' : reasonText(reason));
  }
  _end(reason) {
    if (this.state === 'ended') return;
    clearInterval(this._statsTimer);
    try { this.dc && this.dc.close(); } catch (_) {} try { this.pc && this.pc.close(); } catch (_) {} try { this.ws && this.ws.close(); } catch (_) {}
    if (this.stream) for (const t of this.stream.getTracks()) t.stop();
    this.dc = null; this.pc = null; this.ws = null; this.stream = null; this.control = false; this.capturingKeys = false;
    this._setState('ended', reason);
    if (state.viewer === this) set({ viewer: null }); emit('viewer', null);
  }
  _startStats() {
    clearInterval(this._statsTimer);
    this._statsTimer = setInterval(async () => {
      if (!this.pc) return;
      try {
        const report = await this.pc.getStats();
        let inbound = null, pair = null;
        report.forEach((r) => { if (r.type === 'inbound-rtp' && r.kind === 'video') inbound = r; if (r.type === 'candidate-pair' && r.state === 'succeeded' && (r.nominated || !pair)) pair = r; });
        if (inbound) {
          const now = inbound.timestamp; const bytes = inbound.bytesReceived || 0;
          const bitrate = this._lastTs ? (bytes - this._lastBytes) * 8 / ((now - this._lastTs) / 1000) : 0;
          this._lastBytes = bytes; this._lastTs = now;
          this.stats = { ...this.stats, width: inbound.frameWidth, height: inbound.frameHeight, fps: Math.round(inbound.framesPerSecond || 0), bitrate: Math.max(0, bitrate), packetsLost: inbound.packetsLost, jitter: inbound.jitter, decoder: inbound.decoderImplementation, rtt: pair ? pair.currentRoundTripTime : this.stats.rtt, candidateType: pair ? pair.localCandidateId : null };
        }
        if (pair) { const local = report.get(pair.localCandidateId); const remote = report.get(pair.remoteCandidateId); this.stats.path = local && remote ? `${local.candidateType || '?'} → ${remote.candidateType || '?'}` : null; }
        this.sendControl({ t: 'ping', ts: Date.now() });
        emit('viewer:stats', this.stats); this._emit('stats', this.stats);
      } catch (_) {}
    }, 1000);
  }
}
const MOD_CODE = { cmd: 'MetaLeft', shift: 'ShiftLeft', alt: 'AltLeft', ctrl: 'ControlLeft' };
function reasonText(r) {
  return ({ 'agent-disconnected': '호스트 앱이 종료되었거나 연결이 끊겼어요.', 'viewer-stopped': '연결을 끊었어요.', kicked: '호스트가 세션을 종료했어요.', paused: '호스트가 화면 공유를 일시정지했어요.', 'permission-revoked': '권한이 변경되었어요.', rejected: '호스트가 요청을 거절했어요.', 'approval-timeout': '호스트가 응답하지 않았어요.', restart: '세션을 다시 시작했어요.', 'agent-ended': '호스트가 전송을 중단했어요.', 'capture-failed': '호스트에서 화면 캡처에 실패했어요. 화면 기록 권한을 확인하세요.' })[r] || r || '세션이 종료되었어요.';
}
