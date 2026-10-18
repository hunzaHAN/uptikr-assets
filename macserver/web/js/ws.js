// 콘솔용 WebSocket (상태 구독 / 승인 / 호스트 토글)
import { state, set, emit } from './state.js';

let ws = null, timer = null, backoff = 1000, wantOpen = false, pingTimer = null;
export function connectConsole() {
  wantOpen = true;
  open();
}
function open() {
  if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws?role=console`);
  ws.onopen = () => { backoff = 1000; emit('ws:open'); clearInterval(pingTimer); pingTimer = setInterval(() => send({ type: 'ping', t: Date.now() }), 25000); };
  ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch (_) { return; } handle(m); };
  ws.onclose = (e) => { clearInterval(pingTimer); emit('ws:close'); if (!wantOpen) return; if (e.code === 4001) { set({ user: null }); emit('auth:lost'); return; } clearTimeout(timer); timer = setTimeout(open, backoff); backoff = Math.min(backoff * 2, 15000); };
  ws.onerror = () => {};
}
export function disconnectConsole() { wantOpen = false; clearTimeout(timer); clearInterval(pingTimer); if (ws) { try { ws.close(); } catch (_) {} ws = null; } }
export function send(msg) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); }
function handle(m) {
  switch (m.type) {
    case 'hello': set({ agentOnline: !!m.agentOnline, hostName: m.hostName || state.hostName, shortcuts: m.shortcuts || state.shortcuts }); break;
    case 'status': set({ status: m, agentOnline: !!m.agentOnline }); emit('status', m); break;
    case 'approval:request': emit('approval', m); break;
    case 'notice': emit('notice', m); break;
    case 'audit': emit('audit', m.entry); break;
    case 'agent:error': emit('agent:error', m); break;
    default: break;
  }
}
