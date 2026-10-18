#!/usr/bin/env node
'use strict';
// macserver 환경 점검: Node, Electron, 네이티브 헬퍼, 권한, 접속 주소
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const C = { g: (s) => `\x1b[32m${s}\x1b[0m`, r: (s) => `\x1b[31m${s}\x1b[0m`, y: (s) => `\x1b[33m${s}\x1b[0m`, dim: (s) => `\x1b[2m${s}\x1b[0m`, b: (s) => `\x1b[1m${s}\x1b[0m` };
const ok = (m, d) => console.log(`  ${C.g('✓')} ${m}${d ? C.dim('  ' + d) : ''}`);
const bad = (m, d) => console.log(`  ${C.r('✗')} ${m}${d ? C.dim('  ' + d) : ''}`);
const warn = (m, d) => console.log(`  ${C.y('!')} ${m}${d ? C.dim('  ' + d) : ''}`);

console.log('\n' + C.b('macserver 환경 점검') + '\n');

// Node
const nodeMajor = Number(process.versions.node.split('.')[0]);
(nodeMajor >= 20 ? ok : bad)(`Node.js ${process.version}`, nodeMajor >= 20 ? '' : '20 이상 필요');

// 플랫폼
if (process.platform === 'darwin') ok(`macOS ${os.release()} (${process.arch})`);
else warn(`${process.platform} (${process.arch})`, '화면 캡처/제어는 macOS 에서만 동작');

// 의존성
(fs.existsSync(path.join(root, 'node_modules', 'express')) ? ok : bad)('npm 의존성', fs.existsSync(path.join(root, 'node_modules', 'express')) ? '' : 'npm install 실행 필요');
(fs.existsSync(path.join(root, 'node_modules', 'electron')) ? ok : warn)('Electron', fs.existsSync(path.join(root, 'node_modules', 'electron')) ? require(path.join(root, 'node_modules/electron/package.json')).version : '없음 (서버 전용 모드만 가능)');

// 네이티브 헬퍼
const inputBin = path.join(root, 'native', 'build', 'macserver-input');
const permsBin = path.join(root, 'native', 'build', 'macserver-perms');
if (fs.existsSync(inputBin)) ok('입력 브리지(Swift)', inputBin);
else if (process.platform === 'darwin') { const hasSwift = spawnSync('which', ['swiftc']).status === 0; (hasSwift ? warn : bad)('입력 브리지 미빌드', hasSwift ? 'npm run build:native 실행' : 'xcode-select --install 후 npm run build:native'); }
else warn('입력 브리지', 'macOS 에서 빌드됩니다');

// 권한 (perms 헬퍼 있으면)
if (process.platform === 'darwin' && fs.existsSync(permsBin)) {
  try { const r = JSON.parse(execSync(`"${permsBin}"`).toString()); (r.screen ? ok : warn)('화면 기록 권한', r.screen ? '허용됨' : '허용 필요 (설정 > 개인정보 보호 > 화면 기록)'); (r.accessibility ? ok : warn)('손쉬운 사용 권한', r.accessibility ? '허용됨' : '허용 필요 (설정 > 개인정보 보호 > 손쉬운 사용)'); } catch (_) {}
}

// 데이터 디렉터리 / 계정
const { defaultDataDir } = require(path.join(root, 'server', 'config'));
const dataDir = defaultDataDir();
const accountsFile = path.join(dataDir, 'accounts.json');
if (fs.existsSync(accountsFile)) { try { const n = JSON.parse(fs.readFileSync(accountsFile)).length; ok('계정', `${n}개 (${dataDir})`); } catch (_) { warn('계정 파일 손상', accountsFile); } }
else warn('계정 없음', '앱을 처음 실행하면 설정 마법사가 열립니다');

// 접속 주소
const ifs = os.networkInterfaces(); const addrs = [];
for (const list of Object.values(ifs)) for (const a of list || []) if (a.family === 'IPv4' && !a.internal) addrs.push(a.address);
let port = 7777; try { port = JSON.parse(fs.readFileSync(path.join(dataDir, 'settings.json'))).port || 7777; } catch (_) {}
console.log('\n' + C.b('접속 주소 (포트 ' + port + ')'));
console.log(`  ${C.dim('로컬')}   http://127.0.0.1:${port}`);
for (const a of addrs) console.log(`  ${C.dim('LAN')}    http://${a}:${port}`);
console.log(`  ${C.dim('Bonjour')} http://${os.hostname().replace(/\.local$/, '')}.local:${port}`);

console.log('\n' + C.dim('실행:  npm start   (앱)   |   npm run server   (서버 전용)') + '\n');
