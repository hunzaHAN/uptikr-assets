// 모바일 E2E: 터치 탭=클릭, 화면 키보드 입력, 몰입/창모드 전환 (iPhone 에뮬레이션)
//   node test/e2e/mobile.mjs
import { chromium, devices } from 'playwright-core';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { fileURLToPath } from 'node:url'; import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createMacServer } = require('../../server/index.js');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '.out-mobile'); fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const ok = (s) => console.log('\x1b[32m✓\x1b[0m', s);
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); ok(m); };

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-m-')); const shareDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-ms-'));
const srv = await createMacServer({ dataDir, port: 0, bind: '127.0.0.1' });
const base = srv.urls().local; const token = srv.auth.localToken;
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
const errors = [];
try {
  const ac = await browser.newContext(); const agent = await ac.newPage();
  await agent.goto(`${base}/agent?token=${token}&fake=1`);
  await agent.waitForFunction(() => document.getElementById('status').textContent.includes('서버 연결됨'), null, { timeout: 10000 });
  await fetch(base + '/api/setup', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-MacServer': '1' }, body: JSON.stringify({ username: 'hunza', password: 'password123', displayName: '훈자', share: { name: 'Projects', path: shareDir } }) }).then((r) => r.json());

  const ctx = await browser.newContext({ ...devices['iPhone 13'], hasTouch: true, isMobile: true });
  const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(base); await p.waitForSelector('.auth-card');
  await p.fill('input[placeholder="아이디"]', 'hunza'); await p.fill('input[placeholder="비밀번호"]', 'password123'); await p.click('.auth-card button.btn.primary');
  await p.waitForSelector('.hero h1', { timeout: 10000 });
  await p.click('.nav-item:has-text("화면")'); await p.waitForSelector('.stage'); await p.click('.stage .overlay button.btn.primary');
  await p.waitForFunction(() => { const v = document.querySelector('.stage video'); return v && v.videoWidth > 0; }, null, { timeout: 20000 }); await p.waitForTimeout(1200);
  assert(await p.evaluate(() => document.getElementById('app').classList.contains('immersive-screen')), 'immersive by default on phone');
  await p.screenshot({ path: path.join(OUT, '1-immersive.png') });

  const box = await p.$eval('.stage video', (v) => { const r = v.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await p.touchscreen.tap(box.x, box.y); await p.waitForTimeout(400);
  const tl = await agent.evaluate(() => window.__inputLog.map((e) => e.t));
  assert(tl.includes('down') && tl.includes('up'), 'touch tap → click: ' + tl.join(','));
  const td = await agent.evaluate(() => window.__inputLog.filter((e) => e.t === 'down').pop());
  assert(Math.abs(td.x - 0.5) < 0.08 && Math.abs(td.y - 0.5) < 0.08, `tap normalized center (${td.x.toFixed(2)},${td.y.toFixed(2)})`);

  await p.tap('.stage .tb-handle'); await p.waitForSelector('.stage.tb-open .vtoolbar'); await p.waitForTimeout(350);
  const tb = await p.evaluate(() => { const t = document.querySelector('.vtoolbar'); const r = t.getBoundingClientRect(); return { w: Math.round(r.width), vis: [...t.querySelectorAll('.tb-btn')].filter((b) => b.getBoundingClientRect().width > 0).length }; });
  assert(tb.w > 300 && tb.vis === 12, `toolbar spans width with all buttons (${tb.w}px, ${tb.vis})`);
  await p.screenshot({ path: path.join(OUT, '2-toolbar.png') });

  await p.tap('.vtoolbar .tb-btn[title="키보드"]'); await p.waitForTimeout(300);
  assert(await p.evaluate(() => document.activeElement && document.activeElement.classList.contains('kb-capture')), 'keyboard button raises on-screen keyboard');
  await agent.evaluate(() => (window.__inputLog.length = 0));
  await p.type('.kb-capture', 'Hello', { delay: 20 }); await p.waitForTimeout(300);
  const typed = await agent.evaluate(() => window.__inputLog.filter((e) => e.t === 'text').map((e) => e.text).join(''));
  assert(typed.length > 0, 'on-screen typing streams to host: "' + typed + '"');

  await p.tap('.stage .tb-handle'); await p.waitForTimeout(100); await p.tap('.vtoolbar .tb-btn[title="창 모드(작게)"]'); await p.waitForTimeout(300);
  assert(await p.isVisible('.sidebar'), 'window mode restores chrome on phone');
  await p.screenshot({ path: path.join(OUT, '3-window.png') });

  const fatal = errors.filter((e) => !/favicon/.test(e));
  if (fatal.length) throw new Error('page errors: ' + fatal.join(' | '));
  console.log('\n\x1b[32mMOBILE E2E PASSED\x1b[0m  →', OUT);
} catch (e) {
  console.error('\n\x1b[31mMOBILE E2E FAILED:\x1b[0m', e.message);
  for (const pg of [...browser.contexts()].flatMap((c) => c.pages())) { try { await pg.screenshot({ path: path.join(OUT, 'fail-' + Date.now() + '.png') }); } catch (_) {} }
  process.exitCode = 1;
} finally {
  await browser.close(); await srv.shutdown();
  fs.rmSync(dataDir, { recursive: true, force: true }); fs.rmSync(shareDir, { recursive: true, force: true });
}
