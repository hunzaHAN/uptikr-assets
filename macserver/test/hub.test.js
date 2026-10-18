'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const { startTestServer, makeClient } = require('./helpers');

function connect(url, headers) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers });
    const queue = []; const waiters = [];
    ws.on('message', (d) => {
      const m = JSON.parse(d.toString());
      const i = waiters.findIndex((w) => !w.pred || w.pred(m));
      if (i >= 0) waiters.splice(i, 1)[0].res(m); else queue.push(m);
    });
    const next = (pred, timeoutMs = 5000) => new Promise((res, rej) => {
      const idx = queue.findIndex((m) => !pred || pred(m));
      if (idx >= 0) return res(queue.splice(idx, 1)[0]);
      const w = { pred, res };
      waiters.push(w);
      setTimeout(() => { const k = waiters.indexOf(w); if (k >= 0) { waiters.splice(k, 1); rej(new Error('timeout waiting for message; queue=' + JSON.stringify(queue.map((m) => m.type)))); } }, timeoutMs).unref();
    });
    ws.on('open', () => resolve({ ws, next, send: (m) => ws.send(JSON.stringify(m)) }));
    ws.on('error', reject);
    ws.on('unexpected-response', (req, res) => reject(new Error('HTTP ' + res.statusCode)));
  });
}

test('hub: auth, signaling relay, approvals, kick', async (t) => {
  const T = await startTestServer();
  t.after(() => T.stop());
  const { api, base, srv } = T;
  const wsBase = base.replace('http', 'ws') + '/ws';
  const setup = await api.post('/api/setup', { username: 'admin', password: 'password123' });
  api.setToken(setup.data.token);
  await api.post('/api/admin/accounts', { username: 'viewer', password: 'password123', permissions: { screenView: true, screenControl: true } });
  await api.post('/api/admin/accounts', { username: 'noview', password: 'password123', permissions: { screenView: false } });
  const v = makeClient(base); const lv = await v.post('/api/auth/login', { username: 'viewer', password: 'password123' }); v.setToken(lv.data.token);
  const nv = makeClient(base); const lnv = await nv.post('/api/auth/login', { username: 'noview', password: 'password123' }); nv.setToken(lnv.data.token);

  await t.test('rejects unauthenticated / bad agent token', async () => {
    await assert.rejects(connect(wsBase + '?role=viewer'), /401/);
    await assert.rejects(connect(wsBase + '?role=agent&token=bad'), /403/);
  });

  const agent = await connect(wsBase + '?role=agent&token=' + srv.auth.localToken);
  const cfg = await agent.next((m) => m.type === 'agent:config');
  assert.ok(Array.isArray(cfg.config.iceServers));

  const viewer = await connect(wsBase + '?role=viewer&token=' + v.token);
  const hello = await viewer.next((m) => m.type === 'hello'); assert.equal(hello.agentOnline, true);

  await t.test('viewer without permission is denied', async () => {
    const nov = await connect(wsBase + '?role=viewer&token=' + nv.token);
    await nov.next((m) => m.type === 'hello');
    nov.send({ type: 'screen:request', wantControl: true });
    const d = await nov.next((m) => m.type === 'screen:denied'); assert.match(d.reason, /권한/);
    nov.ws.close();
  });

  let sessionId;
  await t.test('request → agent start → signal relay both ways', async () => {
    viewer.send({ type: 'screen:request', wantControl: true });
    const start = await agent.next((m) => m.type === 'screen:start');
    assert.equal(start.viewer.user, 'viewer'); assert.equal(start.control, true); sessionId = start.sessionId;
    const acc = await viewer.next((m) => m.type === 'screen:accepted'); assert.equal(acc.sessionId, sessionId);
    agent.send({ type: 'signal', sessionId, data: { sdp: { type: 'offer', sdp: 'v=0' } } });
    const off = await viewer.next((m) => m.type === 'signal'); assert.equal(off.data.sdp.type, 'offer');
    viewer.send({ type: 'signal', sessionId, data: { sdp: { type: 'answer', sdp: 'v=0' } } });
    const ans = await agent.next((m) => m.type === 'signal'); assert.equal(ans.data.sdp.type, 'answer');
    agent.send({ type: 'screen:state', sessionId, state: 'connected' });
    await viewer.next((m) => m.type === 'screen:state' && m.state === 'connected');
    const st = await api.get('/api/admin/status'); assert.equal(st.data.sessions.length, 1); assert.equal(st.data.sessions[0].state, 'connected');
  });

  await t.test('allowControl=false revokes control live', async () => {
    await api.put('/api/admin/settings', { allowControl: false });
    const upd = await viewer.next((m) => m.type === 'screen:update'); assert.equal(upd.control, false);
    const aupd = await agent.next((m) => m.type === 'screen:update'); assert.equal(aupd.control, false);
    await api.put('/api/admin/settings', { allowControl: true });
    await agent.next((m) => m.type === 'agent:config');
  });

  await t.test('kick ends session for both', async () => {
    const admin = await connect(wsBase + '?role=console&token=' + api.token);
    await admin.next((m) => m.type === 'hello');
    admin.send({ type: 'host:kick', sessionId });
    await viewer.next((m) => m.type === 'screen:denied');
    await viewer.next((m) => m.type === 'screen:ended');
    await agent.next((m) => m.type === 'screen:end');
    admin.ws.close();
  });

  await t.test('approval policy ask: host console approves', async () => {
    await api.put('/api/admin/settings', { approvalPolicy: 'ask' });
    await agent.next((m) => m.type === 'agent:config');
    // 호스트 콘솔 (로컬 토큰)
    const hostLogin = await api.post('/api/auth/local', { token: srv.auth.localToken }, { noAuth: true });
    assert.equal(hostLogin.status, 200);
    const host = await connect(wsBase + '?role=console&token=' + hostLogin.data.token);
    await host.next((m) => m.type === 'hello');
    viewer.send({ type: 'screen:request', wantControl: true });
    await viewer.next((m) => m.type === 'screen:pending');
    const req = await host.next((m) => m.type === 'approval:request'); assert.equal(req.user, 'viewer');
    host.send({ type: 'approval:response', sessionId: req.sessionId, allow: true, control: false });
    const start = await agent.next((m) => m.type === 'screen:start'); assert.equal(start.control, false);
    await viewer.next((m) => m.type === 'screen:accepted');
    viewer.send({ type: 'screen:stop' });
    await agent.next((m) => m.type === 'screen:end');
    await viewer.next((m) => m.type === 'screen:ended');
    host.ws.close();
  });

  await t.test('agent disconnect ends sessions', async () => {
    await api.put('/api/admin/settings', { approvalPolicy: 'auto' });
    await agent.next((m) => m.type === 'agent:config');
    viewer.send({ type: 'screen:request' });
    await agent.next((m) => m.type === 'screen:start');
    await viewer.next((m) => m.type === 'screen:accepted');
    agent.ws.close();
    const ended = await viewer.next((m) => m.type === 'screen:ended'); assert.equal(ended.reason, 'agent-disconnected');
    viewer.send({ type: 'screen:request' });
    const d = await viewer.next((m) => m.type === 'screen:denied'); assert.match(d.reason, /오프라인/);
  });
  viewer.ws.close();
});
