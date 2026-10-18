'use strict';
const http = require('http');
const https = require('https');
const { Store } = require('./store');
const { Audit } = require('./audit');
const { Accounts } = require('./accounts');
const { Shares } = require('./shares');
const { Auth } = require('./auth');
const { Hub } = require('./hub');
const { createApp } = require('./app');
const { loadTls } = require('./tls');
const { defaultDataDir, VERSION } = require('./config');
const { lanAddresses } = require('./util');

/**
 * macserver 서버 인스턴스 생성
 * @param {object} opts
 *  - dataDir: 데이터 디렉터리
 *  - hooks: Electron 연동 훅 { trash(abs), nativeStatus(), permissions(), displays(), system(action, body), restartServer() }
 *  - port / bind: 설정 덮어쓰기
 */
async function createMacServer(opts = {}) {
  const dataDir = opts.dataDir || defaultDataDir();
  const store = new Store(dataDir);
  if (opts.port !== undefined && opts.port !== null) store.settings.port = Number(opts.port);
  if (opts.bind) store.settings.bindAddress = opts.bind;
  const ctx = { store, dataDir, hooks: opts.hooks || {}, port: () => ctx._port || store.settings.port };
  ctx.audit = new Audit(dataDir, { onEvent: (e) => ctx.hub && ctx.hub.pushAudit(e) });
  ctx.accounts = new Accounts(store, ctx.audit);
  ctx.shares = new Shares(store, ctx.audit, ctx.accounts);
  ctx.auth = new Auth({ store, accounts: ctx.accounts, audit: ctx.audit, settings: () => store.settings });
  ctx.settings = () => store.settings;
  ctx.hub = new Hub(ctx);
  ctx.extraRoutes = opts.extraRoutes;
  ctx.app = createApp(ctx);
  ctx.hooks.restartServer = ctx.hooks.restartServer || (() => restart());

  let server = null;
  async function listen() {
    const s = store.settings;
    const tls = loadTls(s, dataDir);
    server = tls ? https.createServer({ key: tls.key, cert: tls.cert }, ctx.app) : http.createServer(ctx.app);
    server.on('upgrade', (req, socket, head) => ctx.hub.handleUpgrade(req, socket, head));
    server.keepAliveTimeout = 65000;
    server.requestTimeout = 0; // 대용량 업로드/다운로드
    server.headersTimeout = 120000;
    await new Promise((resolve, reject) => {
      const onErr = (e) => reject(e);
      server.once('error', onErr);
      server.listen(s.port, s.bindAddress, () => { server.off('error', onErr); resolve(); });
    });
    ctx._port = server.address().port;
    ctx.tls = !!tls;
    ctx.audit.log('server.start', { port: ctx._port, https: !!tls, version: VERSION });
    return ctx;
  }
  async function close() {
    if (!server) return;
    const srv = server; server = null;
    await new Promise((resolve) => { srv.closeAllConnections?.(); srv.close(() => resolve()); setTimeout(resolve, 2000).unref?.(); });
  }
  async function restart() {
    await close();
    try { await listen(); } catch (e) { console.error('[macserver] 재시작 실패:', e.message); throw e; }
    if (opts.onRestart) opts.onRestart(ctx);
  }
  async function shutdown() {
    ctx.hub.close(); ctx.auth.close(); store.flush();
    await close();
  }

  await listen();
  return Object.assign(ctx, {
    listen, close, restart, shutdown,
    get server() { return server; },
    urls() {
      const proto = ctx.tls ? 'https' : 'http';
      return { local: `${proto}://127.0.0.1:${ctx._port}`, lan: lanAddresses().map((a) => `${proto}://${a.address}:${ctx._port}`) };
    },
  });
}

module.exports = { createMacServer };
