'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startTestServer, makeClient } = require('./helpers');

test('setup → login → accounts → shares → files', async (t) => {
  const T = await startTestServer();
  const { api, base, shareDir } = T;
  t.after(() => T.stop());

  await t.test('info shows needsSetup', async () => {
    const r = await api.get('/api/info');
    assert.equal(r.status, 200); assert.equal(r.data.needsSetup, true);
  });
  await t.test('CSRF guard rejects POST without header', async () => {
    const res = await fetch(base + '/api/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(res.status, 403);
  });
  await t.test('setup creates admin + share', async () => {
    const r = await api.post('/api/setup', { username: 'hunza', password: 'password123', displayName: 'Hunza', share: { name: 'Projects', path: shareDir } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.account.role, 'admin'); assert.ok(r.data.share.id);
    api.setToken(r.data.token);
    const again = await api.post('/api/setup', { username: 'x', password: 'password123' });
    assert.equal(again.status, 409);
  });
  await t.test('weak password rejected / bad username rejected', async () => {
    assert.equal((await api.post('/api/admin/accounts', { username: 'bob', password: 'short' })).status, 400);
    assert.equal((await api.post('/api/admin/accounts', { username: 'b o b', password: 'password123' })).status, 400);
  });
  let shareId, userId;
  await t.test('admin creates user with ro access', async () => {
    const sh = await api.get('/api/admin/shares'); shareId = sh.data.shares[0].id;
    const r = await api.post('/api/admin/accounts', { username: 'bob', password: 'password123', displayName: 'Bob', permissions: { screenView: true, screenControl: false }, shares: [{ shareId, access: 'ro' }] });
    assert.equal(r.status, 201, JSON.stringify(r.data)); userId = r.data.account.id;
    assert.deepEqual(r.data.account.shares, [{ shareId, access: 'ro' }]);
    assert.equal((await api.post('/api/admin/accounts', { username: 'BOB', password: 'password123' })).status, 409);
  });
  const bob = makeClient(base);
  await t.test('login as bob (wrong then right)', async () => {
    assert.equal((await bob.post('/api/auth/login', { username: 'bob', password: 'wrong' })).status, 401);
    const r = await bob.post('/api/auth/login', { username: 'bob', password: 'password123' });
    assert.equal(r.status, 200); bob.setToken(r.data.token);
    const me = await bob.get('/api/auth/me'); assert.equal(me.data.user.username, 'bob'); assert.equal(me.data.user.isAdmin, false);
    assert.equal((await bob.get('/api/admin/accounts')).status, 403);
  });
  await t.test('bob lists & reads files but cannot write', async () => {
    const shares = await bob.get('/api/files/shares'); assert.equal(shares.data.shares.length, 1); assert.equal(shares.data.shares[0].access, 'ro'); assert.equal(shares.data.shares[0].path, undefined);
    const list = await bob.get(`/api/files/list?share=${shareId}&path=`);
    assert.equal(list.status, 200); assert.deepEqual(list.data.entries.map((e) => e.name), ['sub', 'hello.txt']);
    const dl = await bob.get(`/api/files/download?share=${shareId}&path=hello.txt`);
    assert.equal(dl.status, 200); assert.equal(Buffer.from(dl.data).toString(), 'hello world');
    assert.match(dl.headers.get('content-disposition'), /attachment/);
    const txt = await bob.get(`/api/files/text?share=${shareId}&path=sub/nested.md`); assert.equal(txt.data.text, '# nested');
    assert.equal((await bob.post('/api/files/mkdir', { share: shareId, path: '', name: 'nope' })).status, 403);
    assert.equal((await bob.put(`/api/files/upload?share=${shareId}&path=x.txt`, Buffer.from('x'))).status, 403);
    const zip = await bob.get(`/api/files/download?share=${shareId}&path=sub`); assert.equal(zip.status, 200); assert.equal(zip.headers.get('content-type'), 'application/zip'); assert.ok(zip.data.byteLength > 20);
  });
  await t.test('path traversal is blocked', async () => {
    for (const p of ['../', '..%2F..%2Fetc%2Fpasswd', 'sub/../../x', '/etc/passwd', '%2e%2e/']) {
      const r = await bob.get(`/api/files/list?share=${shareId}&path=${p}`);
      assert.ok([400, 403, 404].includes(r.status), `${p} → ${r.status}`);
    }
    // 심볼릭 링크 탈출
    const outside = fs.mkdtempSync(path.join(require('os').tmpdir(), 'outside-'));
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret');
    fs.symlinkSync(outside, path.join(shareDir, 'escape'));
    const r = await bob.get(`/api/files/list?share=${shareId}&path=escape`);
    assert.equal(r.status, 403);
    const r2 = await bob.get(`/api/files/download?share=${shareId}&path=escape/secret.txt`);
    assert.equal(r2.status, 403);
    fs.unlinkSync(path.join(shareDir, 'escape')); fs.rmSync(outside, { recursive: true });
  });
  await t.test('admin writes: upload / mkdir / rename / move / delete', async () => {
    const up = await api.put(`/api/files/upload?share=${shareId}&path=docs/new.txt`, Buffer.from('uploaded!'));
    assert.equal(up.status, 200, JSON.stringify(up.data)); assert.equal(up.data.entry.size, 9);
    assert.equal(fs.readFileSync(path.join(shareDir, 'docs', 'new.txt'), 'utf8'), 'uploaded!');
    assert.equal((await api.put(`/api/files/upload?share=${shareId}&path=docs/new.txt`, Buffer.from('again'))).status, 409);
    assert.equal((await api.put(`/api/files/upload?share=${shareId}&path=docs/new.txt&overwrite=1`, Buffer.from('again'))).status, 200);
    assert.equal((await api.post('/api/files/mkdir', { share: shareId, path: 'docs', name: 'inner' })).status, 200);
    assert.equal((await api.post('/api/files/mkdir', { share: shareId, path: 'docs', name: '../bad' })).status, 400);
    const rn = await api.post('/api/files/rename', { share: shareId, path: 'docs/new.txt', name: 'renamed.txt' }); assert.equal(rn.status, 200); assert.equal(rn.data.path, 'docs/renamed.txt');
    const mv = await api.post('/api/files/move', { share: shareId, paths: ['docs/renamed.txt'], dest: 'docs/inner' }); assert.equal(mv.status, 200);
    assert.ok(fs.existsSync(path.join(shareDir, 'docs/inner/renamed.txt')));
    const st = await api.get(`/api/files/stat?share=${shareId}&path=docs`); assert.equal(st.data.type, 'dir'); assert.equal(st.data.summary.files, 1);
    const sr = await api.get(`/api/files/search?q=renam`); assert.equal(sr.data.results.length, 1);
    const del = await api.post('/api/files/delete', { share: shareId, paths: ['docs'] }); assert.equal(del.status, 200);
    assert.ok(!fs.existsSync(path.join(shareDir, 'docs')));
    assert.equal((await api.post('/api/files/delete', { share: shareId, paths: [''] })).status, 400);
  });
  await t.test('permission change propagates; last admin protected', async () => {
    const r = await api.put(`/api/admin/accounts/${userId}`, { shares: [{ shareId, access: 'rw' }] }); assert.equal(r.status, 200);
    assert.equal((await bob.post('/api/files/mkdir', { share: shareId, path: '', name: 'bobdir' })).status, 200);
    const me = await api.get('/api/auth/me');
    assert.equal((await api.put(`/api/admin/accounts/${me.data.user.id}`, { role: 'user' })).status, 400);
    assert.equal((await api.del(`/api/admin/accounts/${me.data.user.id}`)).status, 400);
    // 비활성화 → 세션 무효
    assert.equal((await api.put(`/api/admin/accounts/${userId}`, { enabled: false })).status, 200);
    assert.equal((await bob.get('/api/auth/me')).status, 401);
    assert.equal((await bob.post('/api/auth/login', { username: 'bob', password: 'password123' })).status, 403);
  });
  await t.test('settings update + audit + status', async () => {
    const r = await api.put('/api/admin/settings', { approvalPolicy: 'ask', captureFps: 99, port: 7777 });
    assert.equal(r.status, 200); assert.equal(r.data.settings.approvalPolicy, 'ask'); assert.equal(r.data.settings.captureFps, 60);
    assert.equal((await api.put('/api/admin/settings', { port: 70000 })).status, 400);
    const a = await api.get('/api/admin/audit?limit=50'); assert.ok(a.data.entries.some((e) => e.type === 'file.upload'));
    const s = await api.get('/api/admin/status'); assert.equal(s.data.agentOnline, false); assert.equal(s.data.accounts, 2);
    const sys = await api.get('/api/admin/system'); assert.ok(sys.data.version);
    const dirs = await api.get('/api/admin/fs/dirs?path=' + encodeURIComponent(shareDir)); assert.equal(dirs.status, 200); assert.ok(dirs.data.dirs.some((d) => d.name === 'sub'));
  });
  await t.test('share delete detaches from accounts', async () => {
    assert.equal((await api.del(`/api/admin/shares/${shareId}`)).status, 200);
    const acc = (await api.get('/api/admin/accounts')).data.accounts.find((a) => a.id === userId);
    assert.deepEqual(acc.shares, []);
  });
  await t.test('logout clears session', async () => {
    assert.equal((await api.post('/api/auth/logout')).status, 200);
    assert.equal((await api.get('/api/auth/me')).status, 401);
  });
});

test('login rate limit locks account', async (t) => {
  const T = await startTestServer();
  t.after(() => T.stop());
  const { api, base } = T;
  await api.post('/api/setup', { username: 'admin', password: 'password123' });
  const c = makeClient(base);
  let last;
  for (let i = 0; i < 10; i++) last = await c.post('/api/auth/login', { username: 'admin', password: 'nope' + i });
  assert.equal(last.status, 401);
  last = await c.post('/api/auth/login', { username: 'admin', password: 'password123' });
  assert.equal(last.status, 423);
});

test('persistence survives restart', async (t) => {
  const T = await startTestServer();
  const { api, dataDir, shareDir } = T;
  await api.post('/api/setup', { username: 'admin', password: 'password123', share: { name: 'S', path: shareDir } });
  T.srv.store.flush();
  await T.srv.shutdown();
  const { createMacServer } = require('../server/index');
  const srv2 = await createMacServer({ dataDir, port: 0, bind: '127.0.0.1' });
  t.after(async () => { await srv2.shutdown(); fs.rmSync(dataDir, { recursive: true, force: true }); fs.rmSync(shareDir, { recursive: true, force: true }); });
  assert.equal(srv2.accounts.count(), 1); assert.equal(srv2.shares.all.length, 1);
  const c = makeClient(srv2.urls().local);
  const r = await c.post('/api/auth/login', { username: 'admin', password: 'password123' });
  assert.equal(r.status, 200);
});
