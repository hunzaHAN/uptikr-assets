#!/usr/bin/env node
'use strict';
/**
 * Electron 없이 서버만 실행 (개발/테스트/헤드리스).
 *   node server/cli.js [--port 7777] [--data ~/.macserver] [--bind 0.0.0.0]
 * 화면 공유 에이전트는 브라우저로 /agent?token=<로컬토큰> 에 접속하면 (getDisplayMedia 로) 동작합니다.
 */
const { createMacServer } = require('./index');

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; };

(async () => {
  const srv = await createMacServer({ dataDir: opt('data'), port: opt('port') !== undefined ? Number(opt('port')) : undefined, bind: opt('bind') });
  const u = srv.urls();
  console.log(`\n  macserver v${require('../package.json').version} (server-only mode)`);
  console.log(`  데이터 디렉터리 : ${srv.dataDir}`);
  console.log(`  로컬           : ${u.local}`);
  for (const l of u.lan) console.log(`  LAN            : ${l}`);
  console.log(`  호스트 콘솔     : ${u.local}/?lt=${srv.auth.localToken}`);
  console.log(`  에이전트(브라우저): ${u.local}/agent?token=${srv.auth.localToken}`);
  if (srv.accounts.count() === 0) console.log('\n  ⚠ 계정이 없습니다. 위 호스트 콘솔 주소를 열어 초기 설정을 진행하세요.');
  console.log('');
  const stop = async () => { console.log('\n[macserver] 종료 중…'); await srv.shutdown(); process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
})().catch((e) => { console.error('[macserver] 시작 실패:', e.message); process.exit(1); });
