'use strict';
// macserver Electron 메인 프로세스
//  - 서버 기동 (server/index.js)
//  - 호스트 콘솔 창 (BrowserWindow → 로컬 토큰 자동 로그인)
//  - 숨김 에이전트 창 (화면 캡처 + WebRTC 송출 + 입력 브리지)
//  - 트레이, 메뉴, macOS 권한 헬퍼
const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, shell, desktopCapturer, screen, clipboard, nativeImage, systemPreferences } = require('electron');
const path = require('path');
const fs = require('fs');
const { createMacServer } = require('../server/index');
const { NativeInput, checkPermissions } = require('./native-bridge');

const DEV = !!process.env.MACSERVER_DEV;
let server = null, win = null, agentWin = null, tray = null, nativeInput = null;
let captureDisplayId = null, agentConfig = {};
let quitting = false;

const singleLock = app.requestSingleInstanceLock();
if (!singleLock) { app.quit(); process.exit(0); }
app.on('second-instance', () => { showConsole(); });

app.setName('macserver');
if (app.setAboutPanelOptions) app.setAboutPanelOptions({ applicationName: 'macserver', applicationVersion: require('../package.json').version, credits: 'Mac 화면 원격 제어 + 폴더 서버' });

async function boot() {
  nativeInput = new NativeInput();
  nativeInput.start();
  server = await createMacServer({
    hooks: {
      trash: async (absPath) => { try { await shell.trashItem(absPath); return true; } catch (_) { return false; } },
      nativeStatus: async () => nativeInput.status(),
      permissions: async () => { try { return await checkPermissions(); } catch (_) { return { screen: null, accessibility: null }; } },
      displays: async () => displayList(),
      system: async (action, body) => systemAction(action, body),
      restartServer: () => restartServer(),
    },
    onRestart: () => { reloadConsole(); restartAgent(); },
  });
  createTray();
  showConsole();
  startAgent();
  if (process.env.MACSERVER_SMOKE) runSmoke();
  // 권한 미허용 시 첫 실행에 안내
  setTimeout(async () => { const p = await checkPermissions().catch(() => ({})); if (p && p.screen === false) notifyPermission(); }, 1500);
}

function displayList() {
  try {
    const primary = screen.getPrimaryDisplay();
    return screen.getAllDisplays().map((d) => ({ id: String(d.id), label: d.label || `디스플레이 ${d.id}`, bounds: d.bounds, primary: d.id === primary.id, scaleFactor: d.scaleFactor }));
  } catch (_) { return []; }
}

// ---------- 호스트 콘솔 ----------
function consoleUrl() {
  const u = server.urls().local;
  return `${u}/?lt=${encodeURIComponent(server.auth.localToken)}`;
}
function showConsole() {
  if (win && !win.isDestroyed()) { win.show(); win.focus(); return; }
  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 720, minHeight: 500, backgroundColor: '#000000',
    titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 18 }, show: false,
    title: 'macserver',
    webPreferences: { preload: path.join(__dirname, 'preload-console.js'), contextIsolation: true, nodeIntegration: false, spellcheck: false },
  });
  win.loadURL(consoleUrl());
  win.once('ready-to-show', () => win.show());
  win.on('close', (e) => { if (!quitting) { e.preventDefault(); win.hide(); if (process.platform === 'darwin' && app.dock) {/* keep running in tray */} } });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
}
function reloadConsole() { if (win && !win.isDestroyed()) win.loadURL(consoleUrl()); }

// ---------- 숨김 에이전트 ----------
function startAgent() {
  if (agentWin && !agentWin.isDestroyed()) return;
  agentWin = new BrowserWindow({
    width: 480, height: 360, show: DEV, skipTaskbar: true, title: 'macserver agent',
    webPreferences: { preload: path.join(__dirname, 'preload-agent.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  // 화면 캡처 요청 자동 승인 (Electron 30+): 선택된 디스플레이를 소스로 지정
  if (agentWin.webContents.session.setDisplayMediaRequestHandler) {
    agentWin.webContents.session.setDisplayMediaRequestHandler(async (request, callback) => {
      try {
        const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
        let source = sources[0];
        if (captureDisplayId) { const match = sources.find((s) => String(s.display_id) === String(captureDisplayId)); if (match) source = match; }
        callback({ video: source, audio: 'loopback' });
      } catch (e) { callback({}); }
    }, { useSystemPicker: false });
  }
  agentWin.loadURL(`${server.urls().local}/agent?token=${encodeURIComponent(server.auth.localToken)}`);
  agentWin.on('closed', () => { agentWin = null; });
  if (DEV) agentWin.webContents.openDevTools({ mode: 'detach' });
}
function restartAgent() { if (agentWin && !agentWin.isDestroyed()) { agentWin.destroy(); agentWin = null; } startAgent(); }

// ---------- IPC (에이전트) ----------
ipcMain.on('agent:token', (e) => { e.returnValue = server ? server.auth.localToken : ''; });
ipcMain.handle('agent:displays', () => displayList());
ipcMain.handle('agent:input', (e, events) => {
  if (!nativeInput.available()) throw new Error('입력 헬퍼가 없습니다. 설정 > macOS 권한에서 빌드하세요.');
  nativeInput.send(events);
  return true;
});
ipcMain.handle('agent:clipboard:get', () => clipboard.readText());
ipcMain.handle('agent:clipboard:set', (e, text) => { clipboard.writeText(String(text || '')); return true; });
ipcMain.handle('agent:setconfig', (e, cfg) => { agentConfig = cfg || {}; if (cfg && cfg.displayId !== undefined) captureDisplayId = cfg.displayId; if (nativeInput && captureDisplayId) { try { nativeInput.send([{ t: 'display', id: Number(captureDisplayId) }]); } catch (_) {} } return true; });
ipcMain.on('agent:status', (e, txt) => { if (tray) tray.setToolTip('macserver — ' + txt); });

// 클립보드 응답을 에이전트로 전달
function wireNativeClipboard() {
  nativeInput.on((msg) => { if (msg.clipboard !== undefined && agentWin && !agentWin.isDestroyed()) agentWin.webContents.send('native:clipboard', msg.clipboard); });
}

// ---------- IPC (콘솔) ----------
ipcMain.handle('pick-folder', async (e, start) => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], defaultPath: start && fs.existsSync(start) ? start : app.getPath('home') });
  return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
});
ipcMain.handle('open-remote', (e, url) => { const w = new BrowserWindow({ width: 1200, height: 800, backgroundColor: '#000', title: 'macserver — 원격' }); w.loadURL(url); return true; });
ipcMain.handle('win', (e, action) => { if (!win) return; if (action === 'minimize') win.minimize(); });

// ---------- 시스템 액션 (설정 화면) ----------
async function systemAction(action, body = {}) {
  switch (action) {
    case 'open-privacy': {
      const kind = body.kind;
      const url = kind === 'accessibility' ? 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility' : 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture';
      await shell.openExternal(url); return { opened: true };
    }
    case 'prompt-accessibility': { const p = await checkPermissions({ promptAx: true }); return p; }
    case 'request-screen': { const p = await checkPermissions({ requestScreen: true }); return p; }
    case 'relaunch': { app.relaunch(); app.exit(0); return { ok: true }; }
    case 'build-native': return buildNative();
    default: throw new Error('알 수 없는 동작: ' + action);
  }
}
function buildNative() {
  return new Promise((resolve) => {
    const { spawn } = require('child_process');
    const script = path.join(__dirname, '..', 'scripts', 'build-native.sh');
    const p = spawn('bash', [script], { cwd: path.join(__dirname, '..') });
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (err += d));
    p.on('exit', (code) => { if (code === 0) { nativeInput.stop(); nativeInput = new NativeInput(); nativeInput.start(); wireNativeClipboard(); resolve({ ok: true, out }); } else resolve({ ok: false, error: (err || out).slice(-400) }); });
    p.on('error', (e) => resolve({ ok: false, error: e.message }));
  });
}

async function restartServer() { if (!server) return; await server.restart(); }

// ---------- 스모크 테스트 (CI/헤드리스 검증) ----------
async function runSmoke() {
  const out = { urls: server.urls(), native: nativeInput.status() };
  const started = Date.now();
  // 에이전트 연결 대기
  await new Promise((res) => { const iv = setInterval(() => { if (server.hub.agent || Date.now() - started > 15000) { clearInterval(iv); res(); } }, 200); });
  out.agentOnline = !!server.hub.agent;
  // 에이전트 창에서 화면 캡처 가능 여부 확인 (getDisplayMedia)
  try {
    out.captureTest = await agentWin.webContents.executeJavaScript(`(async () => { try { const s = await navigator.mediaDevices.getDisplayMedia({ video: true }); const t = s.getVideoTracks()[0]; const st = t.getSettings(); s.getTracks().forEach(x=>x.stop()); return { ok: true, width: st.width, height: st.height }; } catch (e) { return { ok: false, error: e.name + ': ' + e.message }; } })()`);
  } catch (e) { out.captureTest = { ok: false, error: e.message }; }
  // 콘솔 창 로드 확인
  try { out.consoleTitle = await win.webContents.executeJavaScript('document.title'); out.consoleHasApp = await win.webContents.executeJavaScript('!!document.querySelector(".app, .auth-card")'); } catch (e) { out.consoleError = e.message; }
  // 스크린샷
  try { const img = await win.webContents.capturePage(); require('fs').writeFileSync(path.join(__dirname, '..', 'test', '.tmp', 'electron-console.png'), img.toPNG()); out.screenshot = true; } catch (e) { out.screenshotError = e.message; }
  console.log('SMOKE_RESULT ' + JSON.stringify(out));
  quitting = true; app.quit();
}

// ---------- 트레이 ----------
function trayIcon() {
  const p1 = process.resourcesPath ? path.join(process.resourcesPath, 'trayTemplate.png') : null;
  const p2 = path.join(__dirname, '..', 'build', 'trayTemplate.png');
  for (const p of [p1, p2]) { if (p && fs.existsSync(p)) { const img = nativeImage.createFromPath(p); img.setTemplateImage(true); return img; } }
  // 폴백: 단색 점 아이콘
  const img = nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAPElEQVQ4jWNgGAWjgP7g////DAwMDP8ZkAAjuiRMAZEIbBQxBqAbRMgQYgwgaBAxBqAbRMgQYgwYBaMAAJ5rEv1t2VxkAAAAAElFTkSuQmCC');
  img.setTemplateImage(true); return img;
}
function createTray() {
  try { tray = new Tray(trayIcon()); } catch (_) { return; }
  tray.setToolTip('macserver');
  refreshTrayMenu();
  tray.on('click', () => { if (process.platform !== 'darwin') showConsole(); });
}
function refreshTrayMenu() {
  if (!tray) return;
  const u = server ? server.urls() : { local: '', lan: [] };
  const items = [
    { label: `macserver v${require('../package.json').version}`, enabled: false },
    { type: 'separator' },
    { label: '콘솔 열기', click: () => showConsole() },
    { label: '접속 주소', submenu: [{ label: u.local, click: () => clipboard.writeText(u.local) }, ...u.lan.map((l) => ({ label: l, click: () => clipboard.writeText(l) })), { type: 'separator' }, { label: '(클릭하면 복사)', enabled: false }] },
    { type: 'separator' },
    { label: agentWin ? '화면 에이전트 다시 시작' : '화면 에이전트 시작', click: () => restartAgent() },
    { label: 'macOS 권한 설정…', submenu: [{ label: '화면 기록', click: () => systemAction('open-privacy', { kind: 'screen' }) }, { label: '손쉬운 사용', click: () => systemAction('open-privacy', { kind: 'accessibility' }) }] },
    { type: 'separator' },
    { label: 'macserver 종료', click: () => { quitting = true; app.quit(); } },
  ];
  tray.setContextMenu(Menu.buildFromTemplate(items));
}

function notifyPermission() {
  if (!win) return;
  dialog.showMessageBox(win, { type: 'info', title: '권한이 필요해요', message: '화면 공유를 쓰려면 화면 기록 권한이 필요합니다.', detail: '시스템 설정 > 개인정보 보호 및 보안 > 화면 및 시스템 오디오 기록에서 macserver(개발 중에는 Electron)를 허용한 뒤 앱을 다시 실행하세요.', buttons: ['설정 열기', '나중에'], defaultId: 0 }).then((r) => { if (r.response === 0) systemAction('open-privacy', { kind: 'screen' }); });
}

// ---------- 메뉴 ----------
function appMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ label: app.name, submenu: [{ role: 'about' }, { type: 'separator' }, { label: '설정…', accelerator: 'Cmd+,', click: () => { showConsole(); win.loadURL(consoleUrl().replace(/\/\?/, '/settings?')); } }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { type: 'separator' }, { label: '종료', accelerator: 'Cmd+Q', click: () => { quitting = true; app.quit(); } }] }] : []),
    { label: '파일', submenu: [{ label: '콘솔', accelerator: 'CmdOrCtrl+1', click: () => showConsole() }, isMac ? { role: 'close' } : { role: 'quit' }] },
    { label: '편집', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: '보기', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { label: '창', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'front' }] },
    { label: '도움말', submenu: [{ label: '접속 주소 복사', click: () => clipboard.writeText(server ? server.urls().local : '') }, { label: 'macOS 권한 설정 열기', click: () => systemAction('open-privacy', { kind: 'screen' }) }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(async () => {
  appMenu();
  await boot();
  wireNativeClipboard();
  app.on('activate', () => showConsole());
});
app.on('window-all-closed', (e) => { /* 트레이에 상주 */ });
app.on('before-quit', async (e) => {
  quitting = true;
  if (nativeInput) nativeInput.stop();
  if (server) { try { await server.shutdown(); } catch (_) {} }
});
process.on('uncaughtException', (e) => { console.error('uncaught', e); });
