'use strict';
const { token, now, iso, HttpError, isLoopback, clientIp, safeEqual } = require('./util');

const COOKIE = 'msid';

/**
 * 세션 관리 + 인증 미들웨어
 * 세션: { token, accountId, role, user, displayName, createdAt, expiresAt, ip, ua, kind: 'web'|'host' }
 */
class Auth {
  constructor({ store, accounts, audit, settings }) {
    this.store = store; this.accounts = accounts; this.audit = audit;
    this.getSettings = settings;
    this.localToken = token(32);      // Electron 호스트 콘솔/에이전트 전용 (프로세스 수명)
    this.ipAttempts = new Map();      // IP별 실패 횟수
    this._gc();
  }
  _gc() {
    const t = now();
    const before = this.store.sessions.length;
    this.store.sessions = this.store.sessions.filter((s) => new Date(s.expiresAt).getTime() > t);
    if (this.store.sessions.length !== before) this.store.save('sessions');
    this._gcTimer = setTimeout(() => this._gc(), 10 * 60 * 1000);
    if (this._gcTimer.unref) this._gcTimer.unref();
  }
  close() { clearTimeout(this._gcTimer); }

  createSession(acc, req, kind = 'web') {
    const ttl = (this.getSettings().sessionTtlHours || 336) * 3600 * 1000;
    const s = {
      token: token(32), accountId: acc.id, role: acc.role, user: acc.username, displayName: acc.displayName,
      createdAt: iso(), expiresAt: iso(now() + ttl), lastSeenAt: iso(),
      ip: req ? clientIp(req) : '', ua: req ? String(req.headers['user-agent'] || '').slice(0, 200) : '', kind,
    };
    this.store.sessions.push(s);
    this.store.save('sessions');
    return s;
  }
  destroySession(tok) {
    const i = this.store.sessions.findIndex((s) => s.token === tok);
    if (i >= 0) { this.store.sessions.splice(i, 1); this.store.save('sessions'); }
  }
  destroyAccountSessions(accountId) {
    this.store.sessions = this.store.sessions.filter((s) => s.accountId !== accountId);
    this.store.save('sessions');
  }
  sessionByToken(tok) {
    if (!tok) return null;
    const s = this.store.sessions.find((x) => x.token === tok);
    if (!s) return null;
    if (new Date(s.expiresAt).getTime() < now()) { this.destroySession(tok); return null; }
    return s;
  }
  listSessions() { return this.store.sessions.map((s) => ({ ...s, token: undefined, id: s.token.slice(0, 8) })); }
  revokeSessionById(shortId) {
    const before = this.store.sessions.length;
    this.store.sessions = this.store.sessions.filter((s) => s.token.slice(0, 8) !== shortId);
    if (before !== this.store.sessions.length) this.store.save('sessions');
    return before !== this.store.sessions.length;
  }

  /** 요청에서 토큰 추출 (쿠키 → Bearer → ?token=) */
  tokenFromReq(req) {
    const c = req.cookies && req.cookies[COOKIE];
    if (c) return c;
    const h = req.headers.authorization;
    if (h && /^Bearer\s+/i.test(h)) return h.replace(/^Bearer\s+/i, '').trim();
    if (req.query && req.query.token) return String(req.query.token);
    return null;
  }

  /** 세션 → 유저 컨텍스트. host 세션은 가상 host 계정. */
  resolve(req) {
    const tok = this.tokenFromReq(req);
    const s = this.sessionByToken(tok);
    if (!s) return null;
    if (s.kind === 'host') {
      return { session: s, account: hostAccount(this.getSettings().hostName) };
    }
    const acc = this.accounts.byId(s.accountId);
    if (!acc || !acc.enabled) return null;
    s.lastSeenAt = iso();
    return { session: s, account: acc };
  }

  /** 로그인 처리 (IP 기반 속도 제한 포함) */
  login(req, username, password) {
    const ip = clientIp(req);
    const st = this.getSettings();
    const rec = this.ipAttempts.get(ip) || { count: 0, until: 0 };
    if (rec.until > now()) throw new HttpError(429, '로그인 시도가 너무 많습니다. 잠시 후 다시 시도하세요.');
    try {
      const acc = this.accounts.verify(username, password, { maxAttempts: st.maxLoginAttempts, lockoutMinutes: st.lockoutMinutes });
      this.ipAttempts.delete(ip);
      const sess = this.createSession(acc, req, 'web');
      this.audit.log('auth.login', { user: acc.username, ip });
      return { session: sess, account: acc };
    } catch (e) {
      rec.count += 1;
      if (rec.count >= (st.maxLoginAttempts || 10) * 2) { rec.until = now() + (st.lockoutMinutes || 15) * 60000; rec.count = 0; }
      this.ipAttempts.set(ip, rec);
      this.audit.log('auth.fail', { user: String(username || '').slice(0, 32), ip, reason: e.message });
      throw e;
    }
  }

  /** Electron 호스트 콘솔: 로컬 토큰 → host 세션 */
  loginLocal(req, tok) {
    if (!isLoopback(clientIp(req))) throw new HttpError(403, '로컬에서만 가능합니다.');
    if (!tok || !safeEqual(tok, this.localToken)) throw new HttpError(403, '로컬 토큰이 올바르지 않습니다.');
    const acc = hostAccount(this.getSettings().hostName);
    const sess = this.createSession(acc, req, 'host');
    return { session: sess, account: acc };
  }
  isLocalToken(tok) { return !!tok && safeEqual(tok, this.localToken); }

  cookieOptions(req) {
    const secure = !!(req && (req.secure || req.headers['x-forwarded-proto'] === 'https'));
    return { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: (this.getSettings().sessionTtlHours || 336) * 3600 * 1000 };
  }

  // ---- 미들웨어 ----
  required() {
    return (req, res, next) => {
      const ctx = this.resolve(req);
      if (!ctx) return next(new HttpError(401, '로그인이 필요합니다.'));
      req.auth = ctx; req.account = ctx.account;
      next();
    };
  }
  admin() {
    return (req, res, next) => {
      const ctx = this.resolve(req);
      if (!ctx) return next(new HttpError(401, '로그인이 필요합니다.'));
      if (!isAdmin(ctx.account)) return next(new HttpError(403, '관리자 권한이 필요합니다.'));
      req.auth = ctx; req.account = ctx.account;
      next();
    };
  }
  optional() {
    return (req, res, next) => { const ctx = this.resolve(req); if (ctx) { req.auth = ctx; req.account = ctx.account; } next(); };
  }
}

function hostAccount(hostName) {
  return {
    id: 'host', username: 'host', displayName: hostName || 'Host', role: 'host', enabled: true,
    permissions: { screenView: true, screenControl: true }, shares: [],
  };
}
function isAdmin(acc) { return !!acc && (acc.role === 'admin' || acc.role === 'host'); }

/** CSRF 방어: 상태 변경 요청은 커스텀 헤더 필요 (브라우저 폼/크로스사이트 요청 차단) */
function csrfGuard(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.headers.authorization) return next(); // API 클라이언트
  if (req.headers['x-macserver'] === '1') return next();
  return next(new HttpError(403, 'X-MacServer 헤더가 필요합니다.'));
}

module.exports = { Auth, COOKIE, isAdmin, hostAccount, csrfGuard };
