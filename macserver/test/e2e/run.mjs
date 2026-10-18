// E2E: 서버 + 에이전트(가짜 카메라) + 뷰어를 Chromium 에서 끝까지 돌려봅니다.
//   node test/e2e/run.mjs [--headed]
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createMacServer } = require('../../server/index.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '.out'); fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const step = (s) => console.log('\x1b[36m▶\x1b[0m', s);
const ok = (s) => console.log('\x1b[32m✓\x1b[0m', s);
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); ok(m); };

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-e2e-')); const shareDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-share-'));
fs.writeFileSync(path.join(shareDir, 'README.md'), '# 프로젝트\n\n안녕하세요 macserver');
fs.mkdirSync(path.join(shareDir, '디자인')); fs.writeFileSync(path.join(shareDir, '디자인', 'notes.txt'), 'notes');
fs.writeFileSync(path.join(shareDir, 'photo.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#1db954"/></svg>');
fs.writeFileSync(path.join(shareDir, 'archive.zip'), Buffer.alloc(2048));

const srv = await createMacServer({ dataDir, port: 0, bind: '127.0.0.1' });
const base = srv.urls().local; const token = srv.auth.localToken;
console.log('server', base);

const browser = await chromium.launch({ executablePath: CHROME, headless: !process.argv.includes('--headed'), args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
const errors = [];
const newPage = async (ctx, name) => { const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(`${name}: ${e.message}`)); p.on('console', (m) => { if (m.type() === 'error' && !/favicon|ERR_|Failed to load resource/.test(m.text())) errors.push(`${name} console: ${m.text()}`); }); return p; };
const shot = (p, n) => p.screenshot({ path: path.join(OUT, n + '.png'), fullPage: false });
try {
  // ---- 에이전트 ----
  step('agent');
  const agentCtx = await browser.newContext({ viewport: { width: 800, height: 600 } });
  const agent = await newPage(agentCtx, 'agent');
  await agent.goto(`${base}/agent?token=${token}&fake=1`);
  await agent.waitForFunction(() => document.getElementById('status').textContent.includes('서버 연결됨'), null, { timeout: 10000 });
  ok('agent connected');

  // ---- 호스트 콘솔: 초기 설정 ----
  step('setup wizard');
  const hostCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ko-KR' });
  const host = await newPage(hostCtx, 'host');
  await host.goto(`${base}/?lt=${token}`);
  await host.waitForSelector('.auth-card h1');
  await shot(host, '01-setup-1');
  await host.fill('.auth-card input[placeholder="예: hunza"]', 'hunza');
  await host.fill('.auth-card input[placeholder="예: 훈자"]', '훈자');
  const pws = await host.$$('.auth-card input[type=password]'); await pws[0].fill('password123'); await pws[1].fill('password123');
  await host.click('.auth-card button.btn.primary');
  await host.waitForSelector('.auth-card input.mono');
  await host.fill('.auth-card input.mono', shareDir); await host.fill('.auth-card input[placeholder^="공유 이름"]', 'Projects');
  await shot(host, '02-setup-2');
  await host.click('.auth-card button.btn.primary');
  await host.waitForSelector('.auth-card .callout');
  await host.click('.auth-card button.btn.primary');
  await host.waitForSelector('.greeting, .hero h1', { timeout: 10000 });
  await host.waitForTimeout(600);
  await shot(host, '03-home');
  assert((await host.textContent('.hero h1')).includes('훈자'), 'home greets admin');
  assert(await host.$('.lib-item'), 'library shows items');

  // ---- 화면 세션 ----
  step('screen session (viewer ⇄ agent over WebRTC)');
  await host.click('.nav-item:has-text("화면")');
  await host.waitForSelector('.stage');
  await shot(host, '04-screen-idle');
  await host.click('.stage .overlay button.btn.primary');
  await host.waitForFunction(() => { const v = document.querySelector('.stage video'); return v && v.videoWidth > 0; }, null, { timeout: 20000 });
  await host.waitForTimeout(1500);
  await shot(host, '05-screen-live');
  const st = await host.evaluate(() => { const v = document.querySelector('.stage video'); return { w: v.videoWidth, h: v.videoHeight }; });
  assert(st.w === 1280 && st.h === 720, `video 1280x720 received (${st.w}x${st.h})`);
  const sb = await host.textContent('.statusbar');
  assert(sb.includes('제어 중') || sb.includes('보기'), 'statusbar shows session');
  // 입력: 스테이지 클릭 → agent 로그
  const box = await host.$eval('.stage video', (v) => { const r = v.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await host.mouse.move(box.x, box.y); await host.mouse.down(); await host.mouse.up();
  await host.mouse.wheel(0, 120);
  await host.keyboard.press('KeyA');
  await host.waitForTimeout(500);
  const logged = await agent.evaluate(() => window.__inputLog.map((e) => e.t));
  assert(logged.includes('move') && logged.includes('down') && logged.includes('up'), 'agent received mouse events: ' + logged.join(','));
  assert(logged.includes('wheel'), 'agent received wheel');
  assert(logged.includes('key'), 'agent received key');
  const down = await agent.evaluate(() => window.__inputLog.find((e) => e.t === 'down'));
  assert(Math.abs(down.x - 0.5) < 0.05 && Math.abs(down.y - 0.5) < 0.05, `click normalized near center (${down.x.toFixed(2)}, ${down.y.toFixed(2)})`);
  // 텍스트 보내기
  await host.click('.side button:has-text("텍스트 보내기")');
  await host.fill('.modal textarea', '안녕하세요');
  await host.click('.modal button.btn.primary');
  await host.waitForTimeout(300);
  const txt = await agent.evaluate(() => window.__inputLog.find((e) => e.t === 'text'));
  assert(txt && txt.text === '안녕하세요', 'agent received unicode text');
  // 화질 변경 / 상태 API
  const status = await fetch(`${base}/api/admin/status`, { headers: { Authorization: 'Bearer ' + srv.auth.listSessions()[0] ? '' : '' } }).catch(() => null);
  const hubSessions = srv.hub.statusSnapshot().sessions;
  assert(hubSessions.length === 1 && hubSessions[0].state === 'connected', 'hub reports connected session');
  // 홈으로 가도 세션 유지 (상태바)
  await host.click('.nav-item:has-text("홈")');
  await host.waitForTimeout(400);
  assert((await host.textContent('.statusbar')).includes('화면'), 'session persists across navigation');
  await shot(host, '06-home-with-session');
  await host.click('.statusbar button[title="연결 끊기"]');
  await host.waitForTimeout(500);
  assert(srv.hub.statusSnapshot().sessions.length === 0, 'session ended on stop');

  // ---- 파일 ----
  step('files');
  await host.click('.lib-item:has-text("Projects")');
  await host.waitForSelector('.row.files-cols');
  await host.waitForTimeout(500);
  await shot(host, '07-files');
  const names = await host.$$eval('.row.files-cols .nm .t', (els) => els.map((e) => e.textContent));
  assert(names[0] === '디자인' && names.includes('README.md'), 'file list sorted dirs first: ' + names.join(','));
  // 업로드
  const tmpUp = path.join(os.tmpdir(), 'upload-ui.txt'); fs.writeFileSync(tmpUp, 'uploaded via ui');
  await host.setInputFiles('input[type=file]:not([webkitdirectory])', tmpUp);
  await host.waitForFunction(() => [...document.querySelectorAll('.row.files-cols .nm .t')].some((e) => e.textContent === 'upload-ui.txt'), null, { timeout: 10000 });
  ok('upload appears in list');
  assert(fs.existsSync(path.join(shareDir, 'upload-ui.txt')), 'file written to share');
  // 한글 파일명은 Playwright setInputFiles 가 change 이벤트를 못 쏘므로 API 로 직접 검증 (Node 측 로그인)
  { const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'X-MacServer': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'hunza', password: 'password123' }) }).then((x) => x.json());
    const put = await fetch(`${base}/api/files/upload?share=${srv.shares.all[0].id}&path=${encodeURIComponent('한글파일.txt')}`, { method: 'PUT', headers: { 'X-MacServer': '1', 'Content-Type': 'application/octet-stream', Authorization: 'Bearer ' + login.token }, body: Buffer.from('한글 내용', 'utf8') });
    assert(put.ok && fs.readFileSync(path.join(shareDir, '한글파일.txt'), 'utf8') === '한글 내용', 'unicode filename + content upload via API'); }
  // 미리보기
  await host.dblclick('.row.files-cols:has-text("README.md")');
  await host.waitForSelector('.modal pre');
  await host.waitForFunction(() => document.querySelector('.modal pre').textContent.includes('macserver'));
  await shot(host, '08-preview');
  await host.keyboard.press('Escape');
  // 새 폴더
  await host.click('.actionbar button[title="새 폴더"]');
  await host.fill('.modal input', '새폴더'); await host.click('.modal button.btn.primary');
  await host.waitForFunction(() => [...document.querySelectorAll('.row.files-cols .nm .t')].some((e) => e.textContent === '새폴더'));
  ok('mkdir via UI');
  // 폴더 진입 + 브레드크럼
  await host.dblclick('.row.files-cols:has-text("디자인")');
  await host.waitForFunction(() => location.pathname.includes('/files/') && document.querySelector('.crumbs .cur')?.textContent === '디자인');
  ok('navigate into folder');
  // 컨텍스트 메뉴
  await host.click('.row.files-cols:has-text("notes.txt")', { button: 'right' });
  await host.waitForSelector('.menu');
  await shot(host, '09-context-menu');
  await host.keyboard.press('Escape');
  // 그리드 뷰
  await host.click('.actionbar .segment button[title="격자"]');
  await host.waitForSelector('.grid .card');
  await shot(host, '10-files-grid');
  await host.click('.actionbar .segment button[title="목록"]');

  // ---- 검색 ----
  step('search');
  await host.click('.nav-item:has-text("검색")');
  await host.fill('.topbar input', 'notes');
  await host.waitForSelector('.row.files-cols:has-text("notes.txt")', { timeout: 8000 });
  await shot(host, '11-search');

  // ---- 계정 ----
  step('accounts');
  await host.click('.nav-item:has-text("계정")');
  await host.waitForSelector('.row.accounts-cols');
  await host.click('.actionbar .play-btn');
  await host.waitForSelector('.modal');
  await host.fill('.modal input[placeholder^="영문"]', 'guest'); await host.fill('.modal input[placeholder="표시 이름"]', '손님'); await host.fill('.modal input[type=password]', 'guestpass1');
  await host.click('.modal .share-access .segment button:has-text("읽기")');
  await shot(host, '12-account-dialog');
  await host.click('.modal .form-row:has-text("화면 보기") .toggle'); // 화면 보기 끄기
  await host.click('.modal button.btn.primary');
  await host.waitForFunction(() => document.querySelectorAll('.row.accounts-cols').length === 2);
  await shot(host, '13-accounts');
  ok('account created via UI');

  // ---- 설정 ----
  step('settings');
  await host.click('.nav-item:has-text("설정")');
  await host.waitForSelector('.settings-section h2');
  await host.waitForTimeout(500);
  await shot(host, '14-settings');
  await host.screenshot({ path: path.join(OUT, '14-settings-full.png'), fullPage: true });
  // 활동
  await host.goto(`${base}/activity`); await host.waitForSelector('.audit-cols'); await host.waitForTimeout(400); await shot(host, '15-activity');

  // ---- 게스트 로그인 (별도 컨텍스트) ----
  step('guest login');
  const guestCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const guest = await newPage(guestCtx, 'guest');
  await guest.goto(base);
  await guest.waitForSelector('.auth-card');
  await shot(guest, '16-login');
  await guest.fill('input[placeholder="아이디"]', 'guest'); await guest.fill('input[placeholder="비밀번호"]', 'wrong'); await guest.click('.auth-card button.btn.primary');
  await guest.waitForFunction(() => document.querySelector('.auth-card .error')?.textContent.length > 0);
  await guest.fill('input[placeholder="비밀번호"]', 'guestpass1'); await guest.click('.auth-card button.btn.primary');
  await guest.waitForSelector('.hero h1', { timeout: 10000 });
  await guest.waitForTimeout(500);
  await shot(guest, '17-guest-home');
  assert(!(await guest.$('.nav-item:has-text("계정")')), 'guest has no accounts nav');
  await guest.click('.lib-item:has-text("Projects")');
  await guest.waitForSelector('.row.files-cols');
  assert(!(await guest.$('.actionbar button[title="새 폴더"]')), 'guest (ro) has no new-folder button');
  await guest.click('.nav-item:has-text("화면")');
  await guest.waitForSelector('.stage .overlay');
  const ov = await guest.textContent('.stage .overlay');
  assert(ov.includes('권한이 없어요'), 'guest without screen permission sees notice');
  await shot(guest, '18-guest-screen');

  // 작은 화면
  await host.setViewportSize({ width: 820, height: 700 }); await host.goto(`${base}/`); await host.waitForSelector('.hero h1'); await host.waitForTimeout(400); await shot(host, '19-narrow');

  if (errors.length) { console.log('\n\x1b[33mBrowser errors:\x1b[0m'); for (const e of errors) console.log(' -', e); }
  const fatal = errors.filter((e) => !/console:/.test(e));
  if (fatal.length) throw new Error('page errors: ' + fatal.join(' | '));
  console.log('\n\x1b[32mE2E PASSED\x1b[0m  screenshots →', OUT);
} catch (e) {
  console.error('\n\x1b[31mE2E FAILED:\x1b[0m', e.message);
  for (const p of [...browser.contexts()].flatMap((c) => c.pages())) { try { await p.screenshot({ path: path.join(OUT, 'failure-' + Date.now() + '.png') }); } catch (_) {} }
  if (errors.length) for (const er of errors) console.log(' -', er);
  process.exitCode = 1;
} finally {
  await browser.close(); await srv.shutdown();
  fs.rmSync(dataDir, { recursive: true, force: true }); fs.rmSync(shareDir, { recursive: true, force: true });
}
