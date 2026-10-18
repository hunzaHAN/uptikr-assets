'use strict';
const fs = require('fs');
const path = require('path');
const { iso } = require('./util');

const MAX_BYTES = 5 * 1024 * 1024;

/** JSONL 감사 로그 (로그인, 파일 작업, 화면 세션 등) */
class Audit {
  constructor(dataDir, { onEvent } = {}) {
    this.file = path.join(dataDir, 'audit.log');
    this.onEvent = onEvent;
    this.recent = [];
    this._load();
  }
  _load() {
    try {
      const txt = fs.readFileSync(this.file, 'utf8');
      const lines = txt.trim().split('\n').slice(-500);
      this.recent = lines.map((l) => { try { return JSON.parse(l); } catch (_) { return null; } }).filter(Boolean);
    } catch (_) { this.recent = []; }
  }
  log(type, data = {}) {
    const entry = { ts: iso(), type, ...data };
    this.recent.push(entry);
    if (this.recent.length > 500) this.recent.shift();
    try {
      fs.appendFileSync(this.file, JSON.stringify(entry) + '\n', { mode: 0o600 });
      const st = fs.statSync(this.file);
      if (st.size > MAX_BYTES) {
        try { fs.renameSync(this.file, this.file + '.1'); } catch (_) {}
      }
    } catch (_) { /* 로그 실패는 무시 */ }
    if (this.onEvent) { try { this.onEvent(entry); } catch (_) {} }
    return entry;
  }
  list({ limit = 100, type, user } = {}) {
    let items = this.recent;
    if (type) items = items.filter((e) => e.type === type || (e.type || '').startsWith(type + '.'));
    if (user) items = items.filter((e) => e.user === user);
    return items.slice(-limit).reverse();
  }
}

module.exports = { Audit };
