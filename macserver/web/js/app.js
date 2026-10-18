// macserver 웹 UI 진입점 — 앱 셸(사이드바/탑바/상태바) + 라우팅
import { api, setBearer } from './api.js';
import { h, svg, clear, toast, modal, avatar, fmtBitrate, copyText } from './ui.js';
import { icon } from './icons.js';
import { t, setLang } from './i18n.js';
import { route, navigate, back, forward, startRouter, onRoute, currentPath } from './router.js';
import { state, set, on, emit, isAdmin, isHost } from './state.js';
import { connectConsole, disconnectConsole, send as wsSend } from './ws.js';
import * as Login from './views/login.js';
import * as Setup from './views/setup.js';
import * as Home from './views/home.js';
import * as Screen from './views/screen.js';
import * as Files from './views/files.js';
import * as Accounts from './views/accounts.js';
import * as Settings from './views/settings.js';
import * as Search from './views/search.js';
import * as Activity from './views/activity.js';
import { StatusBar } from './components/statusbar.js';

const root = document.getElementById('app');
let shell = null;      // { sidebar, main, content, topbar, statusbar }
let currentView = null; // { cleanup }
let statusBar = null;

// ---------- 부트스트랩 ----------
async function boot() {
  const url = new URL(location.href);
  const lt = url.searchParams.get('lt');
  let info;
  try { info = await api.info(); } catch (e) { renderFatal('서버에 연결할 수 없습니다. macserver가 실행 중인지 확인하세요.'); return; }
  set({ info, hostName: info.hostName }); setLang(info.language || 'ko');
  document.title = `macserver · ${info.hostName}`;

  if (lt) {
    // Electron 호스트 콘솔: 로컬 토큰으로 자동 로그인
    try { const r = await api.loginLocal(lt); setBearer(r.token); url.searchParams.delete('lt'); history.replaceState(null, '', url.pathname + (url.search || '')); }
    catch (e) { console.warn('local login failed', e); }
  }
  if (info.needsSetup) { renderAuthOnly(Setup, { info, localToken: lt }); return; }
  try {
    const me = await api.me();
    set({ user: me.user, hostName: me.hostName, shortcuts: me.shortcuts || [], agentOnline: !!me.agentOnline });
    await enterApp();
  } catch (e) {
    renderAuthOnly(Login, { info });
  }
}

function renderFatal(msg) { clear(root); root.appendChild(h('div.auth-page', h('div.auth-card', h('h1', 'macserver'), h('p.foot', msg), h('button.btn.primary', { onclick: () => location.reload() }, '다시 시도')))); }

function renderAuthOnly(View, props) {
  disconnectConsole();
  root.className = 'app no-sidebar';
  clear(root);
  View.render(root, { ...props, onDone: async () => { const me = await api.me(); set({ user: me.user, hostName: me.hostName, shortcuts: me.shortcuts || [], agentOnline: !!me.agentOnline }); await enterApp(); } });
}

async function enterApp() {
  root.className = 'app' + (localStorage.getItem('ms.sidebar') === 'collapsed' ? ' sidebar-collapsed' : '');
  clear(root);
  shell = buildShell();
  await refreshShares();
  connectConsole();
  if (!window.__routerStarted) { registerRoutes(); startRouter(); window.__routerStarted = true; } else { const p = currentPath(); navigate(p === '/login' || p === '/setup' ? '/' : p, { replace: true }); }
  if (currentPath() === '/login' || currentPath() === '/setup') navigate('/', { replace: true });
}

export async function refreshShares() {
  try { const r = await api.files.shares(); set({ shares: r.shares }); renderLibrary(); } catch (_) {}
}

// ---------- 셸 ----------
function buildShell() {
  const sidebar = h('aside.sidebar');
  const nav = h('div.panel.nav');
  const library = h('div.panel.library');
  sidebar.append(nav, library);

  const topbar = h('header.topbar.drag-region');
  const content = h('div.content');
  const mainScroll = h('div.main-scroll.scroll', topbar, content);
  const main = h('main.panel.main', mainScroll);
  mainScroll.addEventListener('scroll', () => topbar.classList.toggle('scrolled', mainScroll.scrollTop > 8));

  statusBar = new StatusBar({ onNavigate: navigate, wsSend });
  root.append(sidebar, main, statusBar.el);
  shell = { sidebar, nav, library, topbar, content, mainScroll, main };
  renderNav();
  renderLibrary();
  renderTopbar();
  return shell;
}

function navItems() {
  const items = [
    { path: '/', label: t('home'), icon: 'home', iconActive: 'homeFill', match: (p) => p === '/' },
    { path: '/search', label: t('search'), icon: 'search', iconActive: 'search', match: (p) => p.startsWith('/search') },
    { path: '/screen', label: t('screen'), icon: 'monitor', iconActive: 'monitorFill', match: (p) => p.startsWith('/screen'), badge: () => state.viewer && state.viewer.state === 'connected' ? 'LIVE' : null },
  ];
  if (isAdmin()) items.push({ path: '/accounts', label: t('accounts'), icon: 'users', iconActive: 'usersFill', match: (p) => p.startsWith('/accounts') });
  items.push({ path: '/settings', label: t('settings'), icon: 'settings', iconActive: 'settingsFill', match: (p) => p.startsWith('/settings') });
  return items;
}
function renderNav() {
  const { nav } = shell; clear(nav);
  nav.appendChild(h('div.brand.drag-region', h('span.logo', { html: icon('logo') }), h('span', 'macserver'), h('small', state.hostName)));
  const p = location.pathname;
  for (const it of navItems()) {
    const active = it.match(p);
    const b = h('button.nav-item', { class: active ? 'active' : '', onclick: () => navigate(it.path) }, h('span.ic', { html: icon(active ? it.iconActive : it.icon) }), h('span', it.label));
    const badge = it.badge && it.badge(); if (badge) b.appendChild(h('span.badge.green', badge));
    nav.appendChild(b);
  }
}
let libFilter = localStorage.getItem('ms.libFilter') || 'all';
function renderLibrary() {
  const { library } = shell; if (!library) return; clear(library);
  const collapsed = root.classList.contains('sidebar-collapsed');
  const header = h('button.library-header', { title: collapsed ? '라이브러리 펼치기' : '라이브러리 접기', onclick: () => { root.classList.toggle('sidebar-collapsed'); localStorage.setItem('ms.sidebar', root.classList.contains('sidebar-collapsed') ? 'collapsed' : 'open'); renderLibrary(); } }, h('span.ic', { html: icon('library') }), h('span', t('library')));
  const addBtn = isAdmin() ? h('button.icon-btn.ghost', { title: '공유 폴더 추가', onclick: (e) => { e.stopPropagation(); Settings.openAddShare().then((ok) => ok && refreshShares()); } }, svg('plus')) : null;
  library.appendChild(h('div', { style: { display: 'flex', alignItems: 'center', paddingRight: '8px' } }, header, h('span.spacer', { style: { flex: 1 } }), addBtn));
  library.appendChild(h('div.chips',
    ...[['all', '전체'], ['folder', '폴더'], ['screen', '화면']].map(([v, l]) => h('button.chip', { class: libFilter === v ? 'active' : '', onclick: () => { libFilter = v; localStorage.setItem('ms.libFilter', v); renderLibrary(); } }, l))));
  const list = h('div.lib-list.scroll');
  const p = location.pathname;
  if (libFilter !== 'folder') {
    const live = state.viewer && state.viewer.state === 'connected';
    list.appendChild(h('button.lib-item', { class: p.startsWith('/screen') ? 'active' : '', onclick: () => navigate('/screen') },
      h('span.art', { style: { background: 'linear-gradient(135deg, #1db954, #0d73ec)' }, html: icon('monitorFill') }),
      h('span.lib-text', h('span.t', t('screenOf', { host: state.hostName })), h('span.s', h('span.dot', { class: state.agentOnline ? 'on' : 'off' }), live ? '연결됨 · 제어 세션' : state.agentOnline ? '화면 · 온라인' : '화면 · 오프라인'))));
  }
  if (libFilter !== 'screen') {
    if (!state.shares.length) {
      list.appendChild(h('div.lib-empty', h('h4', '공유 폴더가 없어요'), h('p', isAdmin() ? 'Mac mini의 폴더를 골라 서버처럼 공유해 보세요.' : '관리자가 폴더를 공유하면 여기에 표시됩니다.'), isAdmin() ? h('button.btn.white.sm', { onclick: () => Settings.openAddShare().then((ok) => ok && refreshShares()) }, '폴더 공유하기') : null));
    }
    for (const s of state.shares) {
      const active = decodeURIComponent(p).startsWith('/files/' + s.id);
      list.appendChild(h('button.lib-item', { class: active ? 'active' : '', onclick: () => navigate('/files/' + s.id), oncontextmenu: (e) => { e.preventDefault(); Files.shareContextMenu(s, e); } },
        h('span.art', { style: { background: `linear-gradient(135deg, ${s.color}, #121212)` }, html: icon('folderFill') }),
        h('span.lib-text', h('span.t', s.name), h('span.s', '폴더 · ' + (s.access === 'rw' ? t('readWrite') : t('readOnly'))))));
    }
  }
  library.appendChild(list);
}
function renderTopbar() {
  const { topbar } = shell; clear(topbar);
  const navBtns = h('div.nav-btns.no-drag',
    h('button.icon-btn.dark', { title: '뒤로', onclick: back }, svg('back')),
    h('button.icon-btn.dark', { title: '앞으로', onclick: forward }, svg('forward')));
  topbar.appendChild(navBtns);
  const slot = h('div.topbar-slot.no-drag', { style: { display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0 } });
  topbar.appendChild(slot);
  shell.topbarSlot = slot;
  const right = h('div.no-drag', { style: { display: 'flex', alignItems: 'center', gap: '8px' } });
  if (state.isElectron) right.appendChild(h('button.btn.white.sm', { onclick: () => openConnectDialog() }, svg('external'), '다른 Mac에 연결'));
  const u = state.user;
  right.appendChild(h('button.user-pill', { title: u.username, onclick: (e) => userMenu(e.currentTarget) }, avatar(u.displayName || u.username), h('span.name', u.displayName || u.username)));
  topbar.appendChild(right);
}
function userMenu(anchor) {
  import('./ui.js').then(({ contextMenu }) => {
    const u = state.user;
    contextMenu([
      { head: `${u.displayName} (${u.isHost ? '호스트 콘솔' : u.isAdmin ? '관리자' : '사용자'})` },
      { label: '설정', icon: 'settings', onClick: () => navigate('/settings') },
      !u.isHost ? { label: '비밀번호 변경', icon: 'lock', onClick: () => Settings.openChangePassword() } : null,
      '-',
      { label: '로그아웃', icon: 'logout', onClick: async () => { try { await api.logout(); } catch (_) {} setBearer(null); if (state.viewer) state.viewer.stop('logout'); location.href = '/'; } },
    ], { anchor });
  });
}
async function openConnectDialog() {
  const recent = JSON.parse(localStorage.getItem('ms.recentHosts') || '[]');
  const input = h('input.input', { placeholder: '예: 192.168.0.10:7777 또는 macmini.local:7777', value: recent[0] || '' });
  const dlg = modal({ title: '다른 Mac의 macserver에 연결', body: [
    h('p.desc', '연결할 Mac에서 macserver가 실행 중이어야 해요. 주소는 그 Mac의 설정 > 접속 주소에서 확인할 수 있어요.'),
    h('div.field', h('label', '주소'), input),
    recent.length ? h('div.field', h('span.label', '최근'), h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } }, ...recent.map((r) => h('button.chip', { onclick: () => { input.value = r; } }, r)))) : null,
  ], footer: [h('button.btn.ghost', { onclick: () => dlg.close() }, '취소'), h('button.btn.primary', { onclick: () => go() }, '연결')] });
  function go() {
    let v = input.value.trim(); if (!v) return;
    if (!/^https?:\/\//.test(v)) v = 'http://' + v;
    if (!/:\d+/.test(v.replace(/^https?:\/\//, ''))) v = v.replace(/\/?$/, '') + ':7777';
    const next = [v, ...recent.filter((x) => x !== v)].slice(0, 6); localStorage.setItem('ms.recentHosts', JSON.stringify(next));
    dlg.close();
    if (window.macserver && window.macserver.openRemote) window.macserver.openRemote(v); else window.open(v, '_blank');
  }
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
}

// ---------- 라우팅 ----------
function registerRoutes() {
  const mount = (View) => (ctx) => mountView(View, ctx);
  route('/', mount(Home));
  route('/home', mount(Home));
  route('/screen', mount(Screen));
  route('/files/:share', mount(Files));
  route('/files/:share/*', mount(Files));
  route('/files', (ctx) => { if (state.shares[0]) navigate('/files/' + state.shares[0].id, { replace: true }); else mountView(Home, ctx); });
  route('/accounts', mount(Accounts));
  route('/accounts/:id', mount(Accounts));
  route('/settings', mount(Settings));
  route('/settings/:section', mount(Settings));
  route('/search', mount(Search));
  route('/activity', mount(Activity));
  route('*', mount(Home));
  onRoute(() => { renderNav(); renderLibrary(); });
}
function mountView(View, ctx) {
  if (!shell) return;
  if (currentView && currentView.cleanup) { try { currentView.cleanup(); } catch (e) { console.error(e); } }
  clear(shell.content); clear(shell.topbarSlot);
  shell.content.className = 'content';
  shell.mainScroll.scrollTop = 0;
  const vctx = { ...ctx, container: shell.content, topbarSlot: shell.topbarSlot, navigate, refreshShares, statusBar, setFullscreenLayout: (on) => root.classList.toggle('fullscreen-viewer', on) };
  try { currentView = View.render(vctx) || {}; } catch (e) { console.error(e); shell.content.appendChild(h('div.empty', h('h3', '화면을 표시할 수 없어요'), h('p', String(e.message)))); currentView = {}; }
}

// ---------- 전역 이벤트 ----------
on('change', (patch) => { if (!shell) return; if ('agentOnline' in patch || 'shares' in patch || 'viewer' in patch) { renderLibrary(); renderNav(); } });
on('status', (st) => statusBar && statusBar.setStatus(st));
on('notice', (m) => { if (m.kind === 'screen-start') toast(`${m.displayName || m.user}님이 화면 ${m.control ? '제어' : '보기'}를 시작했어요`); });
on('agent:error', (m) => toast('에이전트 오류: ' + m.error, 'error', 5000));
on('auth:lost', () => { toast('세션이 종료되었습니다. 다시 로그인하세요.', 'warn'); setTimeout(() => location.reload(), 1200); });
on('approval', (m) => {
  const dlg = modal({ title: '원격 접속 요청', closable: false, body: [
    h('div.approval', avatar(m.displayName || m.user, 'lg'), h('div', h('div', { style: { fontWeight: 700 } }, `${m.displayName || m.user} (${m.user})`), h('div', { style: { color: 'var(--text-subdued)', fontSize: '12px' } }, `${m.ip} 에서 화면 ${m.control ? '제어' : '보기'}를 요청했어요.`))),
    h('p.desc', '허용하면 상대방이 이 Mac의 화면을 보게 됩니다. 제어를 허용하면 마우스와 키보드도 조작할 수 있어요.'),
  ], footer: [
    h('button.btn.ghost', { onclick: () => { wsSend({ type: 'approval:response', sessionId: m.sessionId, allow: false }); dlg.close(); } }, '거절'),
    m.control ? h('button.btn.secondary', { onclick: () => { wsSend({ type: 'approval:response', sessionId: m.sessionId, allow: true, control: false }); dlg.close(); } }, '보기만 허용') : null,
    h('button.btn.primary', { onclick: () => { wsSend({ type: 'approval:response', sessionId: m.sessionId, allow: true }); dlg.close(); } }, m.control ? '제어 허용' : '허용'),
  ] });
  setTimeout(() => dlg.close(), 44000);
});
window.addEventListener('keydown', (e) => {
  // 전역 단축키 (뷰어가 키보드를 잡고 있지 않을 때만)
  if (state.viewer && state.viewer.capturingKeys) return;
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); navigate('/search'); }
});

boot();
export { navigate };
