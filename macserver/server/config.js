'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs');

const APP_NAME = 'macserver';
const VERSION = require('../package.json').version;

function defaultDataDir() {
  if (process.env.MACSERVER_DATA) return process.env.MACSERVER_DATA;
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', APP_NAME);
  }
  return path.join(os.homedir(), '.' + APP_NAME);
}

const DEFAULT_SETTINGS = Object.freeze({
  hostName: os.hostname().replace(/\.local$/, ''),
  port: 7777,
  bindAddress: '0.0.0.0',
  language: 'ko',
  https: { enabled: false, certPath: '', keyPath: '' },
  // WebRTC
  iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }],
  turn: { urls: '', username: '', credential: '' },
  // 화면 공유 정책
  approvalPolicy: 'auto',      // 'auto' | 'ask'
  allowControl: true,          // 호스트 전역 제어 허용 스위치
  sharingPaused: false,        // 호스트에서 공유 일시정지
  displayId: null,             // 캡처할 디스플레이 (null = 주 디스플레이)
  invertScroll: false,
  captureFps: 30,
  // 세션/보안
  sessionTtlHours: 24 * 14,
  maxLoginAttempts: 10,
  lockoutMinutes: 15,
  maxUploadMB: 20480,
  // 파일 서버
  webdav: { enabled: false },
  allowDeleteToTrash: true,
});

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); return p; }

module.exports = { APP_NAME, VERSION, defaultDataDir, DEFAULT_SETTINGS, ensureDir };
