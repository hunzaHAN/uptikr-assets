'use strict';
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const { HttpError, lanAddresses, isLoopback, clientIp } = require('./util');
const { COOKIE, csrfGuard, isAdmin } = require('./auth');
const { filesRouter } = require('./files');
const { adminRouter } = require('./admin');
const { VERSION } = require('./config');
const { SHORTCUTS } = require('./keymap');

const WEB_DIR = path.join(__dirname, '..', 'web');

function createApp(ctx) {
  const { auth, accounts, shares, audit, store, hub, hooks } = ctx;
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.use((req, res, next) => {
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });
  app.use(cookieParser());
  app.use(express.json({ limit: '2mb' }));
  app.use('/api', csrfGuard);

  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  const setCookie = (req, res, tok) => res.cookie(COOKIE, tok, auth.cookieOptions(req));

  // ---------- 공개 정보 ----------
  app.get('/api/info', (req, res) => {
    const s = store.settings;
    res.json({
      app: 'macserver', version: VERSION, hostName: s.hostName, language: s.language,
      needsSetup: accounts.count() === 0,
      isLocal: isLoopback(clientIp(req)),
      https: !!s.https.enabled, agentOnline: !!hub.agent,
    });
  });

  // ---------- 초기 설정 (계정이 하나도 없을 때만, 로컬 또는 누구나?) ----------
  // 보안: 첫 관리자 생성은 로컬 요청 또는 setup 토큰이 있을 때만 허용
  app.post('/api/setup', wrap(async (req, res) => {
    if (accounts.count() > 0) throw new HttpError(409, '이미 초기 설정이 완료되었습니다.');
    const local = isLoopback(clientIp(req));
    const okToken = req.body && req.body.setupToken && auth.isLocalToken(req.body.setupToken);
    if (!local && !okToken && !process.env.MACSERVER_ALLOW_REMOTE_SETUP) throw new HttpError(403, '초기 설정은 Mac mini(호스트)에서 직접 진행해야 합니다.');
    const { username, password, displayName, share } = req.body || {};
    const acc = accounts.create({ username, password, displayName, role: 'admin' }, 'setup');
    let created = null;
    if (share && share.path) { try { created = shares.create({ name: share.name || path.basename(share.path), path: share.path }, username); } catch (e) { created = { error: e.message }; } }
    const full = accounts.byUsername(username);
    const sess = auth.createSession(full, req, 'web');
    setCookie(req, res, sess.token);
    audit.log('setup.complete', { user: username });
    hub.broadcastStatus();
    res.json({ ok: true, account: acc, share: created, token: sess.token });
  }));

  // 초기 설정 중 폴더 탐색 (계정이 없을 때만, 로컬 또는 setupToken)
  app.get('/api/setup/dirs', wrap(async (req, res) => {
    if (accounts.count() > 0) throw new HttpError(409, '이미 초기 설정이 완료되었습니다.');
    const local = isLoopback(clientIp(req));
    if (!local && !auth.isLocalToken(String(req.query.setupToken || ''))) throw new HttpError(403, '권한이 없습니다.');
    const { listDirs } = require('./admin');
    res.json(await listDirs(req.query.path));
  }));

  // ---------- 인증 ----------
  app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body || {};
    const { session, account } = auth.login(req, username, password);
    setCookie(req, res, session.token);
    res.json({ ok: true, token: session.token, user: userView(account, session), hostName: store.settings.hostName });
  });
  app.post('/api/auth/local', (req, res) => {
    const { session, account } = auth.loginLocal(req, (req.body || {}).token);
    setCookie(req, res, session.token);
    res.json({ ok: true, token: session.token, user: userView(account, session), hostName: store.settings.hostName });
  });
  app.post('/api/auth/logout', auth.optional(), (req, res) => {
    if (req.auth) { auth.destroySession(req.auth.session.token); audit.log('auth.logout', { user: req.account.username }); }
    res.clearCookie(COOKIE, { path: '/' });
    res.json({ ok: true });
  });
  app.get('/api/auth/me', auth.required(), (req, res) => {
    res.json({ user: userView(req.account, req.auth.session), hostName: store.settings.hostName, language: store.settings.language, shortcuts: SHORTCUTS, agentOnline: !!hub.agent, isLocal: isLoopback(clientIp(req)) });
  });
  app.post('/api/auth/password', auth.required(), (req, res) => {
    if (req.account.role === 'host') throw new HttpError(400, '호스트 콘솔은 비밀번호가 없습니다.');
    const { currentPassword, newPassword } = req.body || {};
    accounts.verify(req.account.username, currentPassword);
    accounts.update(req.account.id, { password: newPassword }, req.account.username);
    res.json({ ok: true });
  });

  // ---------- 시스템 (로그인 사용자) ----------
  app.get('/api/system/info', auth.required(), (req, res) => {
    const s = store.settings;
    res.json({ hostName: s.hostName, port: ctx.port(), https: !!s.https.enabled, lan: isAdmin(req.account) ? lanAddresses() : [], version: VERSION, agentOnline: !!hub.agent, isElectron: !!process.versions.electron });
  });

  // ---------- 라우터 ----------
  app.use('/api/files', filesRouter(ctx));
  app.use('/api/admin', adminRouter(ctx));
  if (ctx.extraRoutes) ctx.extraRoutes(app);

  // ---------- 정적 파일 ----------
  app.use(express.static(WEB_DIR, { index: false, etag: true, maxAge: 0 }));
  app.get(['/', '/index.html'], (req, res) => res.sendFile(path.join(WEB_DIR, 'index.html')));
  app.get('/agent', (req, res) => res.sendFile(path.join(WEB_DIR, 'agent.html')));
  // SPA 라우트
  app.get(/^\/(home|screen|files|accounts|settings|login|setup|search|activity)(\/.*)?$/, (req, res) => res.sendFile(path.join(WEB_DIR, 'index.html')));

  // ---------- 오류 처리 ----------
  app.use((req, res) => res.status(404).json({ error: 'Not found' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
    if (status >= 500) console.error('[macserver] error:', err);
    if (res.headersSent) { try { res.end(); } catch (_) {} return; }
    res.status(status).json({ error: err.message || 'Error', code: err.code });
  });
  return app;
}

function userView(acc, session) {
  return {
    id: acc.id, username: acc.username, displayName: acc.displayName, role: acc.role,
    isAdmin: isAdmin(acc), isHost: acc.role === 'host',
    permissions: acc.permissions, sessionKind: session ? session.kind : 'web',
  };
}

module.exports = { createApp, userView, WEB_DIR };
