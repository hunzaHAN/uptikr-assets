'use strict';
// 네이티브 입력 헬퍼(macserver-input) 를 자식 프로세스로 관리하고 JSON 명령을 전달
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

function resolveBinary(name) {
  const candidates = [
    process.resourcesPath ? path.join(process.resourcesPath, 'native', name) : null, // 패키징된 앱
    path.join(__dirname, '..', 'native', 'build', name),                               // 개발
  ].filter(Boolean);
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return null;
}

class NativeInput {
  constructor() {
    this.proc = null; this.binary = resolveBinary('macserver-input'); this.ready = false; this.lastError = null;
    this._buf = ''; this._pending = []; this._listeners = new Set();
  }
  available() { return !!this.binary; }
  status() { return { available: !!this.binary, running: !!this.proc, path: this.binary, ready: this.ready, reason: this.binary ? null : 'native/build/macserver-input 없음 (npm run build:native)' }; }
  on(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); }
  start() {
    if (this.proc || !this.binary) return this.available();
    try {
      this.proc = spawn(this.binary, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) { this.lastError = e.message; this.proc = null; return false; }
    this.proc.stdout.on('data', (d) => this._onData(d));
    this.proc.stderr.on('data', (d) => { this.lastError = d.toString().slice(0, 200); });
    this.proc.on('exit', (code) => { this.ready = false; this.proc = null; if (code !== 0 && code !== null) this.lastError = 'exit ' + code; });
    this.proc.on('error', (e) => { this.lastError = e.message; this.proc = null; });
    return true;
  }
  _onData(d) {
    this._buf += d.toString();
    let idx;
    while ((idx = this._buf.indexOf('\n')) >= 0) {
      const line = this._buf.slice(0, idx); this._buf = this._buf.slice(idx + 1);
      if (!line.trim()) continue;
      let msg; try { msg = JSON.parse(line); } catch (_) { continue; }
      if (msg.ready) this.ready = true;
      for (const fn of this._listeners) { try { fn(msg); } catch (_) {} }
    }
  }
  /** 입력 이벤트 배열 전송. clipboard:get 응답은 on() 리스너로 돌아옴 */
  send(events) {
    if (!this.proc) { if (!this.start()) throw new Error('입력 헬퍼를 시작할 수 없어요: ' + (this.lastError || '빌드되지 않음')); }
    const arr = Array.isArray(events) ? events : [events];
    try { this.proc.stdin.write(JSON.stringify(arr) + '\n'); } catch (e) { this.lastError = e.message; throw e; }
  }
  stop() { if (this.proc) { try { this.proc.stdin.end(); this.proc.kill(); } catch (_) {} this.proc = null; } }
}

async function checkPermissions({ promptAx = false, requestScreen = false } = {}) {
  const bin = resolveBinary('macserver-perms');
  if (!bin) return { screen: null, accessibility: null, reason: 'perms 헬퍼 없음' };
  return new Promise((resolve) => {
    const args = []; if (promptAx) args.push('--prompt-ax'); if (requestScreen) args.push('--request-screen');
    const p = spawn(bin, args); let out = '';
    p.stdout.on('data', (d) => (out += d.toString()));
    p.on('exit', () => { try { resolve(JSON.parse(out.trim())); } catch (_) { resolve({ screen: null, accessibility: null }); } });
    p.on('error', () => resolve({ screen: null, accessibility: null }));
  });
}

module.exports = { NativeInput, checkPermissions, resolveBinary };
