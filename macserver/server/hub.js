'use strict';
const { WebSocketServer } = require('ws');
const { id, now, iso, isLoopback, clientIp } = require('./util');
const { isAdmin, COOKIE } = require('./auth');

/**
 * 실시간 허브 (/ws)
 *  - agent   : 호스트 캡처 에이전트 (Electron 숨김 창 / 테스트용 브라우저). 로컬 토큰 필요.
 *  - viewer  : 화면 보기 클라이언트 (계정 세션 필요, screenView 권한)
 *  - console : UI 세션 (상태 구독, 호스트 승인 응답)
 *
 * 시그널링:
 *  viewer → {type:'screen:request', wantControl}
 *  hub    → agent {type:'screen:start', sessionId, viewer:{...}, control}
 *  agent  → {type:'signal', sessionId, data:{sdp|candidate}}  ⇄  viewer
 *  viewer → {type:'screen:stop'} / 연결 종료
 */
class Hub {
  constructor(ctx) {
    this.ctx = ctx;
    this.wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
    this.clients = new Set();     // { ws, role, account, session, ip, id, connectedAt }
    this.agent = null;            // 현재 에이전트 클라이언트
    this.sessions = new Map();    // sessionId → { id, viewerClient, user, control, startedAt, state, approvalTimer }
    this.pendingApprovals = new Map();
    this.wss.on('connection', (ws, req, meta) => this._onConnection(ws, req, meta));
    this._hb = setInterval(() => this._heartbeat(), 20000);
    if (this._hb.unref) this._hb.unref();
  }

  close() {
    clearInterval(this._hb);
    for (const c of this.clients) { try { c.ws.close(1001, 'server shutdown'); } catch (_) {} }
    this.wss.close();
  }

  /** http server 'upgrade' 처리 */
  handleUpgrade(req, socket, head) {
    const url = new URL(req.url, 'http://x');
    if (url.pathname !== '/ws') { socket.destroy(); return; }
    const { auth } = this.ctx;
    const tok = url.searchParams.get('token');
    const wantRole = url.searchParams.get('role') || 'console';
    let meta = null;
    if (wantRole === 'agent') {
      if (!isLoopback(clientIp(req)) || !auth.isLocalToken(tok)) { reject(socket, 403); return; }
      meta = { role: 'agent', account: { username: 'agent', role: 'host', displayName: 'agent' } };
    } else {
      req.cookies = parseCookies(req.headers.cookie || '');
      req.query = Object.fromEntries(url.searchParams.entries());
      const ctx = auth.resolve(req);
      if (!ctx) { reject(socket, 401); return; }
      meta = { role: wantRole === 'viewer' ? 'viewer' : 'console', account: ctx.account, session: ctx.session };
    }
    this.wss.handleUpgrade(req, socket, head, (ws) => this.wss.emit('connection', ws, req, meta));
  }

  _onConnection(ws, req, meta) {
    const client = { ws, role: meta.role, account: meta.account, session: meta.session, ip: clientIp(req), id: id('c_'), connectedAt: now(), alive: true, ua: String(req.headers['user-agent'] || '').slice(0, 120) };
    this.clients.add(client);
    ws.on('pong', () => { client.alive = true; });
    ws.on('message', (data) => this._onMessage(client, data));
    ws.on('close', () => this._onClose(client));
    ws.on('error', () => {});

    if (client.role === 'agent') {
      if (this.agent && this.agent !== client) { try { this.agent.ws.close(4000, 'replaced'); } catch (_) {} }
      this.agent = client;
      this.send(client, { type: 'agent:config', config: this.agentConfig() });
      this.ctx.audit.log('agent.connected', {});
      this.broadcastStatus();
    } else {
      this.send(client, { type: 'hello', clientId: client.id, role: client.role, hostName: this.ctx.store.settings.hostName, agentOnline: !!this.agent, shortcuts: require('./keymap').SHORTCUTS });
      if (client.role === 'console' && isAdmin(client.account)) this.send(client, { type: 'status', ...this.statusSnapshot() });
      else this.send(client, { type: 'status', ...this.publicStatus() });
    }
  }

  _onClose(client) {
    this.clients.delete(client);
    if (client === this.agent) {
      this.agent = null;
      this.ctx.audit.log('agent.disconnected', {});
      for (const s of [...this.sessions.values()]) this.endSession(s.id, 'agent-disconnected');
    }
    for (const s of [...this.sessions.values()]) {
      if (s.viewerClient === client) this.endSession(s.id, 'viewer-disconnected');
    }
    this.broadcastStatus();
  }

  _heartbeat() {
    for (const c of this.clients) {
      if (!c.alive) { try { c.ws.terminate(); } catch (_) {} continue; }
      c.alive = false; try { c.ws.ping(); } catch (_) {}
    }
  }

  send(client, msg) { if (client && client.ws.readyState === 1) { try { client.ws.send(JSON.stringify(msg)); } catch (_) {} } }
  broadcast(filter, msg) { for (const c of this.clients) if (filter(c)) this.send(c, msg); }

  agentConfig() {
    const s = this.ctx.store.settings;
    const ice = [...(s.iceServers || [])];
    if (s.turn && s.turn.urls) ice.push({ urls: s.turn.urls.split(',').map((x) => x.trim()).filter(Boolean), username: s.turn.username, credential: s.turn.credential });
    return { iceServers: ice, captureFps: s.captureFps, sharingPaused: !!s.sharingPaused, allowControl: !!s.allowControl, invertScroll: !!s.invertScroll, displayId: s.displayId };
  }

  _onMessage(client, raw) {
    let msg; try { msg = JSON.parse(raw.toString()); } catch (_) { return; }
    if (!msg || typeof msg.type !== 'string') return;
    const { accounts } = this.ctx;
    switch (msg.type) {
      case 'ping': return this.send(client, { type: 'pong', t: msg.t });

      // ---------- viewer ----------
      case 'screen:request': {
        if (client.role !== 'viewer') return this.send(client, { type: 'error', error: 'viewer 역할이 아닙니다.' });
        if (!accounts.canViewScreen(client.account)) return this.send(client, { type: 'screen:denied', reason: '화면 보기 권한이 없습니다.' });
        if (!this.agent) return this.send(client, { type: 'screen:denied', reason: '호스트 에이전트가 오프라인입니다. Mac mini에서 macserver 앱이 실행 중인지 확인하세요.' });
        const st = this.ctx.store.settings;
        if (st.sharingPaused) return this.send(client, { type: 'screen:denied', reason: '호스트가 화면 공유를 일시정지했습니다.' });
        // 기존 세션 정리
        for (const s of [...this.sessions.values()]) if (s.viewerClient === client) this.endSession(s.id, 'restart');
        const control = !!msg.wantControl && st.allowControl && accounts.canControlScreen(client.account);
        const sess = { id: id('ss_'), viewerClient: client, user: client.account.username, displayName: client.account.displayName, control, startedAt: now(), state: 'pending', ip: client.ip };
        this.sessions.set(sess.id, sess);
        if (st.approvalPolicy === 'ask' && client.account.role !== 'host') {
          sess.state = 'awaiting-approval';
          this.send(client, { type: 'screen:pending', sessionId: sess.id, reason: '호스트의 승인을 기다리는 중…' });
          const hostConsoles = [...this.clients].filter((c) => c.role === 'console' && c.account.role === 'host');
          if (!hostConsoles.length) { this.endSession(sess.id, 'no-host-console'); return this.send(client, { type: 'screen:denied', reason: '승인할 호스트 콘솔이 없습니다.' }); }
          for (const hc of hostConsoles) this.send(hc, { type: 'approval:request', sessionId: sess.id, user: sess.user, displayName: sess.displayName, control, ip: client.ip });
          sess.approvalTimer = setTimeout(() => { if (this.sessions.get(sess.id)?.state === 'awaiting-approval') { this.send(client, { type: 'screen:denied', reason: '호스트가 응답하지 않았습니다.' }); this.endSession(sess.id, 'approval-timeout'); } }, 45000);
          this.broadcastStatus();
          return;
        }
        return this._startSession(sess);
      }
      case 'screen:stop': {
        for (const s of [...this.sessions.values()]) if (s.viewerClient === client) this.endSession(s.id, 'viewer-stopped');
        return;
      }
      case 'signal': {
        const sess = this.sessions.get(msg.sessionId);
        if (!sess) return;
        if (client.role === 'viewer' && sess.viewerClient === client) {
          return this.send(this.agent, { type: 'signal', sessionId: sess.id, data: msg.data });
        }
        if (client === this.agent) return this.send(sess.viewerClient, { type: 'signal', sessionId: sess.id, data: msg.data });
        return;
      }

      // ---------- agent ----------
      case 'screen:state': {
        if (client !== this.agent) return;
        const sess = this.sessions.get(msg.sessionId);
        if (!sess) return;
        sess.state = msg.state; sess.stats = msg.stats || sess.stats;
        if (msg.state === 'connected' && !sess.connectedAt) { sess.connectedAt = now(); this.ctx.audit.log('screen.connected', { user: sess.user, control: sess.control, ip: sess.ip }); }
        if (msg.state === 'ended') return this.endSession(sess.id, msg.reason || 'agent-ended');
        this.send(sess.viewerClient, { type: 'screen:state', sessionId: sess.id, state: msg.state, reason: msg.reason });
        return this.broadcastStatus();
      }
      case 'agent:info': { if (client !== this.agent) return; client.info = msg.info; return this.broadcastStatus(); }
      case 'agent:error': { if (client !== this.agent) return; this.ctx.audit.log('agent.error', { error: String(msg.error).slice(0, 200) }); return this.broadcast((c) => c.role === 'console' && isAdmin(c.account), { type: 'agent:error', error: msg.error }); }

      // ---------- host console ----------
      case 'approval:response': {
        if (client.role !== 'console' || client.account.role !== 'host') return;
        const sess = this.sessions.get(msg.sessionId);
        if (!sess || sess.state !== 'awaiting-approval') return;
        clearTimeout(sess.approvalTimer);
        if (msg.allow) { if (msg.control === false) sess.control = false; this.ctx.audit.log('screen.approved', { user: sess.user }); return this._startSession(sess); }
        this.send(sess.viewerClient, { type: 'screen:denied', reason: '호스트가 요청을 거절했습니다.' });
        this.ctx.audit.log('screen.rejected', { user: sess.user });
        return this.endSession(sess.id, 'rejected');
      }
      case 'host:kick': {
        if (!isAdmin(client.account)) return;
        if (this.sessions.has(msg.sessionId)) { this.send(this.sessions.get(msg.sessionId).viewerClient, { type: 'screen:denied', reason: '호스트가 세션을 종료했습니다.' }); this.endSession(msg.sessionId, 'kicked'); }
        return;
      }
      case 'host:toggle': {
        if (!isAdmin(client.account)) return;
        const patch = {};
        if (msg.sharingPaused !== undefined) patch.sharingPaused = !!msg.sharingPaused;
        if (msg.allowControl !== undefined) patch.allowControl = !!msg.allowControl;
        const before = { ...this.ctx.store.settings };
        const next = this.ctx.store.updateSettings(patch);
        return this.onSettingsChanged(next, before);
      }
      default: return;
    }
  }

  _startSession(sess) {
    sess.state = 'connecting';
    this.send(this.agent, { type: 'screen:start', sessionId: sess.id, viewer: { user: sess.user, displayName: sess.displayName, ip: sess.ip }, control: sess.control });
    this.send(sess.viewerClient, { type: 'screen:accepted', sessionId: sess.id, control: sess.control });
    this.ctx.audit.log('screen.start', { user: sess.user, control: sess.control, ip: sess.ip });
    this.broadcastStatus();
    this.broadcast((c) => c.role === 'console' && isAdmin(c.account), { type: 'notice', kind: 'screen-start', user: sess.user, displayName: sess.displayName, control: sess.control });
  }

  endSession(sessionId, reason) {
    const sess = this.sessions.get(sessionId);
    if (!sess) return;
    clearTimeout(sess.approvalTimer);
    this.sessions.delete(sessionId);
    this.send(this.agent, { type: 'screen:end', sessionId, reason });
    this.send(sess.viewerClient, { type: 'screen:ended', sessionId, reason });
    if (sess.state !== 'awaiting-approval' && sess.state !== 'pending') {
      this.ctx.audit.log('screen.end', { user: sess.user, reason, durationSec: Math.round((now() - sess.startedAt) / 1000) });
    }
    this.broadcastStatus();
  }

  /** 계정 권한 변경 → 해당 유저 세션 재평가 */
  onPermissionsChanged(accountId) {
    const { accounts } = this.ctx;
    for (const s of [...this.sessions.values()]) {
      const acc = accounts.byId(s.viewerClient.account.id);
      if (!acc || !acc.enabled || !accounts.canViewScreen(acc)) { this.send(s.viewerClient, { type: 'screen:denied', reason: '권한이 변경되었습니다.' }); this.endSession(s.id, 'permission-revoked'); continue; }
      const control = s.control && accounts.canControlScreen(acc);
      if (control !== s.control) { s.control = control; this.send(this.agent, { type: 'screen:update', sessionId: s.id, control }); this.send(s.viewerClient, { type: 'screen:update', sessionId: s.id, control }); }
    }
    for (const c of this.clients) if (c.account && c.account.id === accountId) { const acc = accounts.byId(accountId); if (!acc || !acc.enabled) { try { c.ws.close(4001, 'account disabled'); } catch (_) {} } else c.account = acc; }
    this.broadcastStatus();
  }

  onSettingsChanged(next, before) {
    if (this.agent) this.send(this.agent, { type: 'agent:config', config: this.agentConfig() });
    if (next.sharingPaused && !before.sharingPaused) {
      for (const s of [...this.sessions.values()]) { this.send(s.viewerClient, { type: 'screen:denied', reason: '호스트가 화면 공유를 일시정지했습니다.' }); this.endSession(s.id, 'paused'); }
    }
    if (!next.allowControl && before.allowControl) {
      for (const s of this.sessions.values()) if (s.control) { s.control = false; this.send(this.agent, { type: 'screen:update', sessionId: s.id, control: false }); this.send(s.viewerClient, { type: 'screen:update', sessionId: s.id, control: false }); }
    }
    this.broadcastStatus();
  }

  statusSnapshot() {
    const s = this.ctx.store.settings;
    return {
      agentOnline: !!this.agent,
      agentInfo: this.agent ? this.agent.info || null : null,
      sharingPaused: !!s.sharingPaused, allowControl: !!s.allowControl, approvalPolicy: s.approvalPolicy,
      sessions: [...this.sessions.values()].map((x) => ({ id: x.id, user: x.user, displayName: x.displayName, control: x.control, state: x.state, startedAt: iso(x.startedAt), ip: x.ip, stats: x.stats || null })),
      clients: [...this.clients].filter((c) => c.role !== 'agent').map((c) => ({ id: c.id, role: c.role, user: c.account.username, displayName: c.account.displayName, ip: c.ip, connectedAt: iso(c.connectedAt), ua: c.ua })),
      accounts: this.ctx.accounts.count(), shares: this.ctx.shares.all.length,
    };
  }
  publicStatus() {
    const s = this.ctx.store.settings;
    return { agentOnline: !!this.agent, sharingPaused: !!s.sharingPaused, allowControl: !!s.allowControl, approvalPolicy: s.approvalPolicy, sessions: this.sessions.size, viewers: [...this.clients].filter((c) => c.role === 'viewer').length };
  }
  broadcastStatus() {
    const full = { type: 'status', ...this.statusSnapshot() };
    const pub = { type: 'status', ...this.publicStatus() };
    for (const c of this.clients) {
      if (c.role === 'agent') continue;
      this.send(c, isAdmin(c.account) ? full : pub);
    }
  }
  /** 감사 로그 이벤트를 관리자 콘솔에 실시간 전달 */
  pushAudit(entry) { this.broadcast((c) => c.role === 'console' && isAdmin(c.account), { type: 'audit', entry }); }
}

function parseCookies(str) {
  const out = {};
  for (const part of str.split(';')) { const i = part.indexOf('='); if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); }
  return out;
}
function reject(socket, code) {
  const text = code === 401 ? 'Unauthorized' : 'Forbidden';
  try { socket.write(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); } catch (_) {}
  socket.destroy();
}

module.exports = { Hub };
