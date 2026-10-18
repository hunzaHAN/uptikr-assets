'use strict';
const express = require('express');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const { HttpError, lanAddresses } = require('./util');
const { VERSION } = require('./config');

/**
 * 관리자 API (/api/admin) — admin/host 전용
 */
function adminRouter(ctx) {
  const { auth, accounts, shares, audit, store, hub, hooks } = ctx;
  const r = express.Router();
  r.use(auth.admin());
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  const actor = (req) => req.account.username;

  // ---- 계정 ----
  r.get('/accounts', (req, res) => res.json({ accounts: accounts.all.map((a) => accounts.publicView(a)) }));
  r.post('/accounts', (req, res) => {
    const acc = accounts.create(req.body || {}, actor(req));
    hub.broadcastStatus();
    res.status(201).json({ account: acc });
  });
  r.put('/accounts/:id', (req, res) => {
    const acc = accounts.update(req.params.id, req.body || {}, actor(req));
    if (req.body && (req.body.enabled === false || req.body.password)) auth.destroyAccountSessions(req.params.id);
    hub.onPermissionsChanged(req.params.id);
    res.json({ account: acc });
  });
  r.delete('/accounts/:id', (req, res) => {
    if (req.account.id === req.params.id) throw new HttpError(400, '자기 자신은 삭제할 수 없습니다.');
    accounts.remove(req.params.id, actor(req));
    auth.destroyAccountSessions(req.params.id);
    hub.onPermissionsChanged(req.params.id);
    res.json({ ok: true });
  });

  // ---- 공유 ----
  r.get('/shares', (req, res) => res.json({ shares: shares.all }));
  r.post('/shares', (req, res) => { const s = shares.create(req.body || {}, actor(req)); hub.broadcastStatus(); res.status(201).json({ share: s }); });
  r.put('/shares/:id', (req, res) => { const s = shares.update(req.params.id, req.body || {}, actor(req)); hub.broadcastStatus(); res.json({ share: s }); });
  r.delete('/shares/:id', (req, res) => { shares.remove(req.params.id, actor(req)); hub.broadcastStatus(); res.json({ ok: true }); });

  // ---- 폴더 탐색 (공유 추가용) ----
  r.get('/fs/dirs', wrap(async (req, res) => res.json(await listDirs(req.query.path))));

  // ---- 설정 ----
  r.get('/settings', (req, res) => res.json({ settings: store.settings, dataDir: store.dataDir }));
  r.put('/settings', wrap(async (req, res) => {
    const patch = sanitizeSettings(req.body || {});
    const before = { ...store.settings };
    const next = store.updateSettings(patch);
    audit.log('settings.update', { actor: actor(req), keys: Object.keys(patch) });
    const needsRestart = ['port', 'bindAddress'].some((k) => patch[k] !== undefined && patch[k] !== before[k])
      || (patch.https && JSON.stringify(patch.https) !== JSON.stringify(before.https));
    hub.onSettingsChanged(next, before);
    res.json({ settings: next, needsRestart });
  }));
  r.post('/restart', wrap(async (req, res) => {
    res.json({ ok: true, message: '서버를 재시작합니다.' });
    setTimeout(() => { if (hooks && hooks.restartServer) hooks.restartServer(); }, 300);
  }));

  // ---- 상태 / 감사 로그 / 세션 ----
  r.get('/status', (req, res) => res.json(hub.statusSnapshot()));
  r.get('/audit', (req, res) => res.json({ entries: audit.list({ limit: Math.min(Number(req.query.limit) || 100, 500), type: req.query.type, user: req.query.user }) }));
  r.get('/sessions', (req, res) => res.json({ sessions: auth.listSessions() }));
  r.delete('/sessions/:id', (req, res) => { auth.revokeSessionById(req.params.id); res.json({ ok: true }); });

  // ---- 시스템 ----
  r.get('/system', wrap(async (req, res) => {
    res.json({
      version: VERSION, platform: process.platform, arch: process.arch, node: process.version, electron: process.versions.electron || null,
      hostname: os.hostname(), uptime: process.uptime(), lan: lanAddresses(), dataDir: store.dataDir,
      native: hooks && hooks.nativeStatus ? await hooks.nativeStatus() : { available: false, reason: 'not-electron' },
      permissions: hooks && hooks.permissions ? await hooks.permissions() : null,
      displays: hooks && hooks.displays ? await hooks.displays() : [],
    });
  }));
  r.post('/system/:action', wrap(async (req, res) => {
    const a = req.params.action;
    if (!hooks || !hooks.system) throw new HttpError(400, 'Electron 앱에서만 가능합니다.');
    const out = await hooks.system(a, req.body || {});
    res.json({ ok: true, result: out });
  }));

  return r;
}

async function listDirs(input) {
  let p = String(input || os.homedir());
  if (p.startsWith('~')) p = path.join(os.homedir(), p.slice(1));
  p = path.resolve(p);
  let st; try { st = await fsp.stat(p); } catch (_) { throw new HttpError(404, '폴더가 없습니다.'); }
  if (!st.isDirectory()) throw new HttpError(400, '폴더가 아닙니다.');
  const names = await fsp.readdir(p, { withFileTypes: true });
  const dirs = [];
  for (const d of names) {
    if (d.name.startsWith('.')) continue;
    if (d.isDirectory() || d.isSymbolicLink()) {
      try { const s = await fsp.stat(path.join(p, d.name)); if (s.isDirectory()) dirs.push({ name: d.name, path: path.join(p, d.name) }); } catch (_) {}
    }
  }
  dirs.sort((a, b) => a.name.localeCompare(b.name, 'ko', { numeric: true }));
  const favorites = ['Desktop', 'Documents', 'Downloads', 'Movies', 'Music', 'Pictures', 'Public']
    .map((n) => ({ name: n, path: path.join(os.homedir(), n) })).filter((f) => fs.existsSync(f.path));
  const volumes = [];
  try { for (const v of fs.readdirSync('/Volumes')) volumes.push({ name: v, path: '/Volumes/' + v }); } catch (_) {}
  return { path: p, parent: path.dirname(p) !== p ? path.dirname(p) : null, dirs, favorites, volumes, home: os.homedir() };
}

function sanitizeSettings(b) {
  const out = {};
  if (b.hostName !== undefined) out.hostName = String(b.hostName).trim().slice(0, 40) || os.hostname();
  if (b.port !== undefined) { const p = Number(b.port); if (!Number.isInteger(p) || p < 1 || p > 65535) throw new HttpError(400, '포트는 1~65535 사이여야 합니다.'); out.port = p; }
  if (b.bindAddress !== undefined) { const v = String(b.bindAddress).trim(); if (!['0.0.0.0', '127.0.0.1', '::'].includes(v) && !/^[\d.]+$/.test(v)) throw new HttpError(400, '잘못된 바인드 주소'); out.bindAddress = v; }
  if (b.language !== undefined) out.language = ['ko', 'en'].includes(b.language) ? b.language : 'ko';
  if (b.https !== undefined) out.https = { enabled: !!b.https.enabled, certPath: String(b.https.certPath || ''), keyPath: String(b.https.keyPath || '') };
  if (b.iceServers !== undefined && Array.isArray(b.iceServers)) out.iceServers = b.iceServers.slice(0, 8).map((s) => ({ urls: s.urls, username: s.username, credential: s.credential }));
  if (b.turn !== undefined) out.turn = { urls: String(b.turn.urls || '').trim(), username: String(b.turn.username || ''), credential: String(b.turn.credential || '') };
  if (b.approvalPolicy !== undefined) out.approvalPolicy = b.approvalPolicy === 'ask' ? 'ask' : 'auto';
  if (b.allowControl !== undefined) out.allowControl = !!b.allowControl;
  if (b.sharingPaused !== undefined) out.sharingPaused = !!b.sharingPaused;
  if (b.displayId !== undefined) out.displayId = b.displayId === null || b.displayId === '' ? null : String(b.displayId);
  if (b.invertScroll !== undefined) out.invertScroll = !!b.invertScroll;
  if (b.captureFps !== undefined) out.captureFps = Math.min(60, Math.max(5, Number(b.captureFps) || 30));
  if (b.sessionTtlHours !== undefined) out.sessionTtlHours = Math.min(24 * 365, Math.max(1, Number(b.sessionTtlHours) || 336));
  if (b.maxLoginAttempts !== undefined) out.maxLoginAttempts = Math.min(100, Math.max(3, Number(b.maxLoginAttempts) || 10));
  if (b.lockoutMinutes !== undefined) out.lockoutMinutes = Math.min(1440, Math.max(1, Number(b.lockoutMinutes) || 15));
  if (b.maxUploadMB !== undefined) out.maxUploadMB = Math.max(1, Number(b.maxUploadMB) || 20480);
  if (b.webdav !== undefined) out.webdav = { enabled: !!b.webdav.enabled };
  if (b.allowDeleteToTrash !== undefined) out.allowDeleteToTrash = !!b.allowDeleteToTrash;
  return out;
}

module.exports = { adminRouter, sanitizeSettings, listDirs };
