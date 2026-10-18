'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { lanAddresses } = require('./util');

/** 자체 서명 인증서 생성/로드 (HTTPS 옵션용) */
function ensureSelfSigned(dataDir, hostName) {
  const dir = path.join(dataDir, 'tls');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const certPath = path.join(dir, 'cert.pem');
  const keyPath = path.join(dir, 'key.pem');
  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) return { certPath, keyPath, created: false };
  const selfsigned = require('selfsigned');
  const altNames = [
    { type: 2, value: 'localhost' },
    { type: 2, value: hostName || os.hostname() },
    { type: 2, value: (hostName || os.hostname()).replace(/\.local$/, '') + '.local' },
    { type: 7, ip: '127.0.0.1' },
    ...lanAddresses().map((a) => ({ type: 7, ip: a.address })),
  ];
  const pems = selfsigned.generate([{ name: 'commonName', value: hostName || 'macserver' }], {
    days: 3650, keySize: 2048, algorithm: 'sha256',
    extensions: [{ name: 'basicConstraints', cA: false }, { name: 'keyUsage', digitalSignature: true, keyEncipherment: true }, { name: 'extKeyUsage', serverAuth: true }, { name: 'subjectAltName', altNames }],
  });
  fs.writeFileSync(certPath, pems.cert, { mode: 0o600 });
  fs.writeFileSync(keyPath, pems.private, { mode: 0o600 });
  return { certPath, keyPath, created: true };
}

function loadTls(settings, dataDir) {
  const h = settings.https || {};
  if (!h.enabled) return null;
  let certPath = h.certPath, keyPath = h.keyPath;
  if (!certPath || !keyPath || !fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
    ({ certPath, keyPath } = ensureSelfSigned(dataDir, settings.hostName));
  }
  return { cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath), certPath, keyPath };
}

module.exports = { ensureSelfSigned, loadTls };
