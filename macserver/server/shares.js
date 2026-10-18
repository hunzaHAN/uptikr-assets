'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { id, iso, HttpError, pick } = require('./util');

const NAME_RE = /^[^\/\\\0:]{1,64}$/;

/**
 * 공유 폴더 모델
 * { id, name, path, description, color, createdAt, updatedAt }
 */
class Shares {
  constructor(store, audit, accounts) {
    this.store = store; this.audit = audit; this.accounts = accounts;
  }
  get all() { return this.store.shares; }
  byId(sid) { return this.store.shares.find((s) => s.id === sid) || null; }
  byName(name) { return this.store.shares.find((s) => s.name.toLowerCase() === String(name).toLowerCase()) || null; }

  static resolvePath(p) {
    if (typeof p !== 'string' || !p.trim()) throw new HttpError(400, '경로를 입력하세요.');
    let abs = p.trim();
    if (abs.startsWith('~')) abs = path.join(os.homedir(), abs.slice(1));
    abs = path.resolve(abs);
    let real;
    try { real = fs.realpathSync.native(abs); } catch (e) { throw new HttpError(400, '존재하지 않는 폴더입니다: ' + abs); }
    const st = fs.statSync(real);
    if (!st.isDirectory()) throw new HttpError(400, '폴더가 아닙니다: ' + abs);
    return real;
  }

  create({ name, path: p, description = '', color }, actor = 'system') {
    name = String(name || '').trim();
    if (!NAME_RE.test(name) || name === '.' || name === '..') throw new HttpError(400, '공유 이름은 1~64자이며 / \\ : 를 포함할 수 없습니다.');
    if (this.byName(name)) throw new HttpError(409, '이미 같은 이름의 공유가 있습니다.');
    const real = Shares.resolvePath(p);
    if (real === '/' ) throw new HttpError(400, '루트(/) 전체를 공유할 수 없습니다.');
    const share = {
      id: id('shr_'), name, path: real,
      description: String(description || '').slice(0, 200),
      color: color || pickColor(name),
      createdAt: iso(), updatedAt: iso(),
    };
    this.store.shares.push(share);
    this.store.save('shares');
    this.audit.log('share.create', { actor, share: name, path: real });
    return share;
  }
  update(sid, patch, actor = 'system') {
    const s = this.byId(sid);
    if (!s) throw new HttpError(404, '공유를 찾을 수 없습니다.');
    if (patch.name !== undefined) {
      const name = String(patch.name).trim();
      if (!NAME_RE.test(name)) throw new HttpError(400, '잘못된 공유 이름입니다.');
      const dup = this.byName(name);
      if (dup && dup.id !== sid) throw new HttpError(409, '이미 같은 이름의 공유가 있습니다.');
      s.name = name;
    }
    if (patch.path !== undefined) s.path = Shares.resolvePath(patch.path);
    if (patch.description !== undefined) s.description = String(patch.description).slice(0, 200);
    if (patch.color !== undefined) s.color = String(patch.color).slice(0, 16);
    s.updatedAt = iso();
    this.store.save('shares');
    this.audit.log('share.update', { actor, share: s.name });
    return s;
  }
  remove(sid, actor = 'system') {
    const idx = this.store.shares.findIndex((s) => s.id === sid);
    if (idx < 0) throw new HttpError(404, '공유를 찾을 수 없습니다.');
    const [s] = this.store.shares.splice(idx, 1);
    this.store.save('shares');
    this.accounts.detachShare(sid);
    this.audit.log('share.delete', { actor, share: s.name });
    return true;
  }
  /** 계정이 접근 가능한 공유 목록 (access 포함) */
  forAccount(acc) {
    return this.store.shares
      .map((s) => ({ ...pick(s, ['id', 'name', 'description', 'color', 'createdAt']), access: this.accounts.accessFor(acc, s.id), path: (acc && (acc.role === 'admin' || acc.role === 'host')) ? s.path : undefined }))
      .filter((s) => s.access !== 'none');
  }
}

const COLORS = ['#1db954', '#e8115b', '#8d67ab', '#1e3264', '#ba5d07', '#148a08', '#e91429', '#0d73ec', '#f59b23', '#477d95', '#509bf5', '#dc148c'];
function pickColor(name) {
  let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}

module.exports = { Shares, pickColor, COLORS };
