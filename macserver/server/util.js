'use strict';
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

function id(prefix = '') {
  return prefix + crypto.randomBytes(9).toString('base64url');
}
function token(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}
function now() { return Date.now(); }
function iso(ts = Date.now()) { return new Date(ts).toISOString(); }

/** 원자적 JSON 쓰기 (tmp → rename) */
function writeJsonAtomic(file, data) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}
function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return fallback;
    // 손상된 파일은 백업해두고 기본값 사용
    try { fs.copyFileSync(file, file + '.corrupt-' + Date.now()); } catch (_) {}
    return fallback;
  }
}

/** LAN IPv4 주소 목록 */
function lanAddresses() {
  const out = [];
  const ifs = os.networkInterfaces();
  for (const [name, addrs] of Object.entries(ifs)) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal) out.push({ iface: name, address: a.address });
    }
  }
  // en0 (Wi-Fi/이더넷)을 앞으로
  out.sort((a, b) => (a.iface === 'en0' ? -1 : b.iface === 'en0' ? 1 : a.iface.localeCompare(b.iface)));
  return out;
}

function isLoopback(ip) {
  if (!ip) return false;
  const v = ip.replace(/^::ffff:/, '');
  return v === '127.0.0.1' || v === '::1' || v.startsWith('127.');
}
function clientIp(req) {
  const ip = (req.socket && req.socket.remoteAddress) || '';
  return ip.replace(/^::ffff:/, '');
}

function humanSize(bytes) {
  if (bytes == null) return '';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0; let n = Number(bytes);
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return (i === 0 ? n : n.toFixed(n >= 100 ? 0 : 1)) + ' ' + u[i];
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a)); const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function sanitizeName(name) {
  // 파일/폴더 이름: 경로 구분자, 제어문자, 선행 '..' 금지
  if (typeof name !== 'string') return null;
  const n = name.normalize('NFC').trim();
  if (!n || n === '.' || n === '..') return null;
  if (/[\/\\\0]/.test(n)) return null;
  if (/[\x00-\x1f]/.test(n)) return null;
  if (n.length > 255) return null;
  return n;
}

function pick(obj, keys) {
  const o = {};
  for (const k of keys) if (obj[k] !== undefined) o[k] = obj[k];
  return o;
}

class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    if (extra) Object.assign(this, extra);
  }
}

module.exports = {
  id, token, now, iso, writeJsonAtomic, readJson, lanAddresses, isLoopback, clientIp,
  humanSize, safeEqual, sanitizeName, pick, HttpError,
};
