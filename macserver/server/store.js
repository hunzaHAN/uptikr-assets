'use strict';
const path = require('path');
const { readJson, writeJsonAtomic } = require('./util');
const { DEFAULT_SETTINGS, ensureDir } = require('./config');

/**
 * 단순 JSON 파일 저장소.
 * accounts.json / shares.json / settings.json / sessions.json
 * 모든 데이터는 메모리에 올려두고 변경 시 원자적으로 기록합니다.
 */
class Store {
  constructor(dataDir) {
    this.dataDir = ensureDir(dataDir);
    this.files = {
      accounts: path.join(dataDir, 'accounts.json'),
      shares: path.join(dataDir, 'shares.json'),
      settings: path.join(dataDir, 'settings.json'),
      sessions: path.join(dataDir, 'sessions.json'),
    };
    this.accounts = readJson(this.files.accounts, []);
    this.shares = readJson(this.files.shares, []);
    this.settings = mergeSettings(readJson(this.files.settings, {}));
    this.sessions = readJson(this.files.sessions, []);
    this._timers = {};
  }
  save(kind, immediate = false) {
    const write = () => {
      delete this._timers[kind];
      writeJsonAtomic(this.files[kind], this[kind]);
    };
    if (immediate) { clearTimeout(this._timers[kind]); write(); return; }
    // 짧은 디바운스 (연속 변경 묶기)
    if (this._timers[kind]) return;
    this._timers[kind] = setTimeout(write, 50);
    if (this._timers[kind].unref) this._timers[kind].unref();
  }
  flush() {
    for (const kind of Object.keys(this._timers)) {
      clearTimeout(this._timers[kind]);
      delete this._timers[kind];
      writeJsonAtomic(this.files[kind], this[kind]);
    }
  }
  updateSettings(patch) {
    this.settings = mergeSettings({ ...this.settings, ...patch });
    this.save('settings', true);
    return this.settings;
  }
}

function mergeSettings(s) {
  const out = { ...DEFAULT_SETTINGS, ...s };
  out.https = { ...DEFAULT_SETTINGS.https, ...(s.https || {}) };
  out.turn = { ...DEFAULT_SETTINGS.turn, ...(s.turn || {}) };
  out.webdav = { ...DEFAULT_SETTINGS.webdav, ...(s.webdav || {}) };
  if (!Array.isArray(out.iceServers) || !out.iceServers.length) out.iceServers = DEFAULT_SETTINGS.iceServers;
  return out;
}

module.exports = { Store, mergeSettings };
