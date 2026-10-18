'use strict';
const bcrypt = require('bcryptjs');
const { id, now, iso, HttpError, pick } = require('./util');

const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{1,31}$/i;
const ROLES = ['admin', 'user'];
const ACCESS = ['none', 'ro', 'rw'];

/**
 * 계정 모델
 * {
 *   id, username, displayName, passwordHash, role: 'admin'|'user', enabled,
 *   permissions: { screenView, screenControl },
 *   shares: [{ shareId, access: 'ro'|'rw' }],
 *   createdAt, updatedAt, lastLoginAt, failedAttempts, lockedUntil
 * }
 */
class Accounts {
  constructor(store, audit) {
    this.store = store;
    this.audit = audit;
  }
  get all() { return this.store.accounts; }
  count() { return this.store.accounts.length; }
  byId(aid) { return this.store.accounts.find((a) => a.id === aid) || null; }
  byUsername(u) {
    const n = String(u || '').toLowerCase();
    return this.store.accounts.find((a) => a.username.toLowerCase() === n) || null;
  }
  adminCount() { return this.store.accounts.filter((a) => a.role === 'admin' && a.enabled).length; }

  validatePassword(pw) {
    if (typeof pw !== 'string' || pw.length < 8) throw new HttpError(400, '비밀번호는 8자 이상이어야 합니다.');
    if (pw.length > 128) throw new HttpError(400, '비밀번호가 너무 깁니다.');
  }

  create({ username, password, displayName, role = 'user', permissions = {}, shares = [], enabled = true }, actor = 'system') {
    username = String(username || '').trim();
    if (!USERNAME_RE.test(username)) throw new HttpError(400, '아이디는 2~32자의 영문/숫자/._- 만 사용할 수 있습니다.');
    if (this.byUsername(username)) throw new HttpError(409, '이미 존재하는 아이디입니다.');
    if (!ROLES.includes(role)) throw new HttpError(400, '잘못된 역할입니다.');
    this.validatePassword(password);
    const acc = {
      id: id('acc_'),
      username,
      displayName: String(displayName || username).trim().slice(0, 64) || username,
      passwordHash: bcrypt.hashSync(password, 10),
      role,
      enabled: !!enabled,
      permissions: {
        screenView: role === 'admin' ? true : !!permissions.screenView,
        screenControl: role === 'admin' ? true : !!permissions.screenControl,
      },
      shares: normalizeShares(shares),
      createdAt: iso(), updatedAt: iso(), lastLoginAt: null,
      failedAttempts: 0, lockedUntil: null,
    };
    this.store.accounts.push(acc);
    this.store.save('accounts');
    this.audit.log('account.create', { actor, user: username, role });
    return this.publicView(acc);
  }

  update(aid, patch, actor = 'system') {
    const acc = this.byId(aid);
    if (!acc) throw new HttpError(404, '계정을 찾을 수 없습니다.');
    if (patch.displayName !== undefined) acc.displayName = String(patch.displayName).trim().slice(0, 64) || acc.username;
    if (patch.role !== undefined) {
      if (!ROLES.includes(patch.role)) throw new HttpError(400, '잘못된 역할입니다.');
      if (acc.role === 'admin' && patch.role !== 'admin' && this.adminCount() <= 1) {
        throw new HttpError(400, '마지막 관리자 계정의 역할은 변경할 수 없습니다.');
      }
      acc.role = patch.role;
    }
    if (patch.enabled !== undefined) {
      if (acc.role === 'admin' && !patch.enabled && this.adminCount() <= 1) {
        throw new HttpError(400, '마지막 관리자 계정은 비활성화할 수 없습니다.');
      }
      acc.enabled = !!patch.enabled;
    }
    if (patch.permissions) {
      acc.permissions = {
        screenView: patch.permissions.screenView !== undefined ? !!patch.permissions.screenView : acc.permissions.screenView,
        screenControl: patch.permissions.screenControl !== undefined ? !!patch.permissions.screenControl : acc.permissions.screenControl,
      };
    }
    if (acc.role === 'admin') acc.permissions = { screenView: true, screenControl: true };
    if (patch.shares !== undefined) acc.shares = normalizeShares(patch.shares);
    if (patch.password !== undefined && patch.password !== '') {
      this.validatePassword(patch.password);
      acc.passwordHash = bcrypt.hashSync(patch.password, 10);
      acc.failedAttempts = 0; acc.lockedUntil = null;
      this.audit.log('account.password', { actor, user: acc.username });
    }
    acc.updatedAt = iso();
    this.store.save('accounts');
    this.audit.log('account.update', { actor, user: acc.username });
    return this.publicView(acc);
  }

  remove(aid, actor = 'system') {
    const idx = this.store.accounts.findIndex((a) => a.id === aid);
    if (idx < 0) throw new HttpError(404, '계정을 찾을 수 없습니다.');
    const acc = this.store.accounts[idx];
    if (acc.role === 'admin' && this.adminCount() <= 1) throw new HttpError(400, '마지막 관리자 계정은 삭제할 수 없습니다.');
    this.store.accounts.splice(idx, 1);
    this.store.save('accounts');
    this.audit.log('account.delete', { actor, user: acc.username });
    return true;
  }

  /** 로그인 검증. 성공 시 계정 반환, 실패 시 HttpError */
  verify(username, password, { maxAttempts = 10, lockoutMinutes = 15 } = {}) {
    const acc = this.byUsername(username);
    // 존재하지 않는 계정도 동일한 시간 소비 (유저 열거 방지)
    if (!acc) { bcrypt.compareSync(String(password || ''), DUMMY_HASH); throw new HttpError(401, '아이디 또는 비밀번호가 올바르지 않습니다.'); }
    if (!acc.enabled) throw new HttpError(403, '비활성화된 계정입니다.');
    if (acc.lockedUntil && new Date(acc.lockedUntil).getTime() > now()) {
      throw new HttpError(423, `로그인 시도가 너무 많습니다. ${lockoutMinutes}분 후 다시 시도하세요.`);
    }
    const ok = bcrypt.compareSync(String(password || ''), acc.passwordHash);
    if (!ok) {
      acc.failedAttempts = (acc.failedAttempts || 0) + 1;
      if (acc.failedAttempts >= maxAttempts) {
        acc.lockedUntil = iso(now() + lockoutMinutes * 60000);
        acc.failedAttempts = 0;
        this.audit.log('auth.locked', { user: acc.username });
      }
      this.store.save('accounts');
      throw new HttpError(401, '아이디 또는 비밀번호가 올바르지 않습니다.');
    }
    acc.failedAttempts = 0; acc.lockedUntil = null; acc.lastLoginAt = iso();
    this.store.save('accounts');
    return acc;
  }

  /** 계정이 공유 폴더에 가진 권한 ('none'|'ro'|'rw') */
  accessFor(acc, shareId) {
    if (!acc) return 'none';
    if (acc.role === 'admin' || acc.role === 'host') return 'rw';
    const e = (acc.shares || []).find((s) => s.shareId === shareId);
    return e ? e.access : 'none';
  }
  canViewScreen(acc) { return !!acc && acc.enabled !== false && (acc.role === 'admin' || acc.role === 'host' || !!acc.permissions?.screenView); }
  canControlScreen(acc) { return !!acc && acc.enabled !== false && (acc.role === 'admin' || acc.role === 'host' || !!acc.permissions?.screenControl); }

  publicView(acc) {
    if (!acc) return null;
    return pick(acc, ['id', 'username', 'displayName', 'role', 'enabled', 'permissions', 'shares', 'createdAt', 'updatedAt', 'lastLoginAt', 'lockedUntil']);
  }
  /** 공유 삭제 시 참조 정리 */
  detachShare(shareId) {
    let changed = false;
    for (const a of this.store.accounts) {
      const before = a.shares.length;
      a.shares = a.shares.filter((s) => s.shareId !== shareId);
      if (a.shares.length !== before) changed = true;
    }
    if (changed) this.store.save('accounts');
  }
}

const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 10);

function normalizeShares(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set(); const out = [];
  for (const s of list) {
    if (!s || typeof s.shareId !== 'string') continue;
    if (!ACCESS.includes(s.access) || s.access === 'none') continue;
    if (seen.has(s.shareId)) continue;
    seen.add(s.shareId);
    out.push({ shareId: s.shareId, access: s.access });
  }
  return out;
}

module.exports = { Accounts, USERNAME_RE, ROLES, ACCESS };
