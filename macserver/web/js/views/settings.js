// 설정 — 접속 주소 / 공유 폴더 / 화면 공유 / macOS 권한 / 보안 / 서버 / 외부 접속 / 정보
import { api } from '../api.js';
import { h, svg, clear, toast, modal, confirmDialog, toggle, copyText, gradientFor, fmtDate } from '../ui.js';
import { icon } from '../icons.js';
import { state, set, on, isAdmin, isHost } from '../state.js';

export function render({ params, container, navigate, refreshShares }) {
  const unsubs = [];
  const admin = isAdmin();
  container.appendChild(h('div.hero', { style: { '--hero-color': '#535353', minHeight: '180px' } }, h('div.meta', h('div.kicker', admin ? '관리자' : '내 계정'), h('h1.compact', '설정'))));
  const wrap = h('div.settings-wrap.hero-shade'); container.appendChild(wrap);

  // ---- 사용자(비관리자) 섹션 ----
  if (!admin) {
    wrap.appendChild(section('내 계정', [
      row('표시 이름', state.user.displayName, h('span.badge.outline', state.user.role === 'admin' ? '관리자' : '사용자')),
      row('비밀번호', '정기적으로 바꾸는 것이 안전해요.', h('button.btn.secondary.sm', { onclick: () => openChangePassword() }, '비밀번호 변경')),
      row('화면 권한', `보기 ${state.user.permissions.screenView ? '허용' : '차단'} · 제어 ${state.user.permissions.screenControl ? '허용' : '차단'}`, null),
    ]));
    wrap.appendChild(section('정보', [row('macserver', `버전 ${state.info ? state.info.version : ''} · 호스트 ${state.hostName}`, null)]));
    return {};
  }

  let settings = null, sys = null, shares = [];
  const sections = {};
  const order = ['access', 'shares', 'screen', 'permissions', 'security', 'server', 'external', 'about'];
  for (const k of order) { sections[k] = h('div.settings-section'); wrap.appendChild(sections[k]); }

  async function load() {
    try {
      const [s, sy, sh] = await Promise.all([api.admin.settings(), api.admin.system(), api.admin.shares()]);
      settings = s.settings; settings._dataDir = s.dataDir; sys = sy; shares = sh.shares;
      set({ sysInfo: { lan: sy.lan, port: settings.port, https: settings.https.enabled } });
      drawAll();
      if (params.section && sections[params.section]) setTimeout(() => sections[params.section].scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    } catch (e) { wrap.appendChild(h('div.callout.warn', e.message)); }
  }
  function drawAll() { drawAccess(); drawShares(); drawScreen(); drawPermissions(); drawSecurity(); drawServer(); drawExternal(); drawAbout(); }
  async function patch(p, { silent = false } = {}) {
    try { const r = await api.admin.updateSettings(p); settings = { ...settings, ...r.settings }; if (!silent) toast('저장했어요', 'success'); if (r.needsRestart) offerRestart(); return true; }
    catch (e) { toast(e.message, 'error'); return false; }
  }
  function offerRestart() {
    confirmDialog({ title: '서버 재시작 필요', message: '포트/HTTPS 설정은 서버를 재시작해야 적용돼요. 지금 재시작할까요? (연결된 세션이 잠시 끊겨요)', okText: '재시작' }).then(async (ok) => {
      if (!ok) return;
      try { await api.admin.restart(); } catch (_) {}
      toast('서버를 재시작하는 중…', 'warn', 4000);
      const proto = settings.https.enabled ? 'https' : 'http';
      const target = state.isElectron ? null : `${proto}://${location.hostname}:${settings.port}/settings/server`;
      setTimeout(() => { if (target) location.href = target; else location.reload(); }, 2500);
    });
  }

  // ---- 접속 주소 ----
  function drawAccess() {
    const el = sections.access; clear(el);
    const proto = settings.https.enabled ? 'https' : 'http';
    el.append(h('h2', '접속 주소'), h('p.intro', '같은 네트워크(Wi‑Fi/유선)의 다른 Mac이나 브라우저에서 아래 주소로 접속하세요.'));
    const list = h('div.addr-list');
    const addrs = [{ tag: 'LAN', u: null }];
    for (const a of sys.lan) list.appendChild(addr('LAN', `${proto}://${a.address}:${settings.port}`, a.iface));
    list.appendChild(addr('Bonjour', `${proto}://${sys.hostname.replace(/\.local$/, '')}.local:${settings.port}`, 'Mac 간 접속에 편리'));
    list.appendChild(addr('로컬', `${proto}://127.0.0.1:${settings.port}`, '이 Mac에서만'));
    el.appendChild(list);
    el.appendChild(h('div.callout', { style: { marginTop: '12px' } }, h('b', '다른 Mac에서 쓰는 법: '), '브라우저(Safari/Chrome)로 위 주소를 열거나, macserver 앱을 설치했다면 상단의 "다른 Mac에 연결" 버튼에 주소를 넣으세요. 계정 아이디/비밀번호로 로그인하면 허용된 폴더와 화면만 보입니다.'));
  }
  function addr(tag, url, note) { return h('div.addr', h('span.tag', tag), h('span.u', url), note ? h('span', { style: { color: 'var(--text-muted)', fontFamily: 'var(--font)', fontSize: '12px' } }, note) : null, h('button.icon-btn.ghost', { title: '복사', onclick: () => copyText(url).then(() => toast('복사했어요')) }, svg('copy')), h('a.icon-btn.ghost', { href: url, target: '_blank', title: '열기' }, svg('external'))); }

  // ---- 공유 폴더 ----
  function drawShares() {
    const el = sections.shares; clear(el);
    el.append(h('div', { style: { display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' } }, h('div', h('h2', '공유 폴더'), h('p.intro', 'Mac mini의 폴더를 골라 외부에서 서버처럼 쓸 수 있게 해요. 계정별 접근 권한은 계정 페이지에서 정합니다.')), h('button.btn.primary.sm', { onclick: () => openAddShare().then((ok) => { if (ok) { load(); refreshShares(); } }) }, svg('plus'), '폴더 추가')));
    if (!shares.length) el.appendChild(h('div.callout', '아직 공유 폴더가 없어요. "폴더 추가"로 시작하세요.'));
    const list = h('div.share-access', { style: { marginTop: '12px' } });
    for (const s of shares) list.appendChild(h('div.item', h('span.art', { style: { background: gradientFor(s.color) } }, svg('folderFill')), h('span.nm', s.name, h('small', s.path)), h('span', { style: { color: 'var(--text-muted)', fontSize: '12px' } }, fmtDate(s.createdAt)),
      h('button.icon-btn.ghost', { title: '열기', onclick: () => navigate('/files/' + s.id) }, svg('folderOpen')),
      h('button.icon-btn.ghost', { title: '편집', onclick: () => openEditShare(s).then((ok) => { if (ok) { load(); refreshShares(); } }) }, svg('edit')),
      h('button.icon-btn.ghost', { title: '공유 해제', onclick: async () => { if (await confirmDialog({ title: `'${s.name}' 공유 해제`, message: '폴더 자체는 삭제되지 않아요. 이 공유를 쓰던 계정의 권한만 사라져요.', okText: '공유 해제', danger: true })) { await api.admin.deleteShare(s.id); toast('공유를 해제했어요'); load(); refreshShares(); } } }, svg('trash'))));
    el.appendChild(list);
    el.appendChild(h('div.callout', { style: { marginTop: '12px' } }, h('b', 'Finder에서 쓰기: '), '브라우저 파일 페이지에서 업로드/다운로드/미리보기/이름 변경/삭제가 가능해요. 대용량 전송은 폴더 ZIP 다운로드와 폴더 업로드(끌어다 놓기)를 지원합니다.'));
  }

  // ---- 화면 공유 ----
  function drawScreen() {
    const el = sections.screen; clear(el);
    el.append(h('h2', '화면 공유'), h('p.intro', '호스트(Mac mini) 입장에서 화면 공유/제어를 어떻게 허용할지 정해요.'));
    const displays = sys.displays || [];
    const dispSel = h('select.input', h('option', { value: '' }, '주 디스플레이'), ...displays.map((d) => h('option', { value: String(d.id), selected: String(settings.displayId) === String(d.id) }, `${d.label || '디스플레이'} ${d.bounds ? `(${d.bounds.width}×${d.bounds.height}${d.primary ? ', 주' : ''})` : ''}`)));
    dispSel.addEventListener('change', () => patch({ displayId: dispSel.value || null }));
    el.append(
      row('공유 일시정지', '켜면 아무도 화면을 볼 수 없어요. 진행 중인 세션은 끊겨요.', toggle(settings.sharingPaused, (v) => patch({ sharingPaused: v }))),
      row('원격 제어 허용', '끄면 모든 계정이 보기 전용이 돼요.', toggle(settings.allowControl, (v) => patch({ allowControl: v }))),
      row('접속 승인 방식', settings.approvalPolicy === 'ask' ? '누군가 접속할 때마다 호스트 콘솔에서 허용/거절을 눌러야 해요.' : '권한이 있는 계정은 승인 없이 바로 연결돼요.', selectCtl([['auto', '자동 허용'], ['ask', '매번 묻기']], settings.approvalPolicy, (v) => patch({ approvalPolicy: v }).then(() => drawScreen()))),
      row('캡처할 디스플레이', displays.length ? `${displays.length}개 감지됨` : 'Electron 앱에서만 선택할 수 있어요.', dispSel),
      row('캡처 프레임레이트', '높을수록 부드럽지만 대역폭을 더 써요.', selectCtl([['15', '15 fps'], ['30', '30 fps'], ['60', '60 fps']], String(settings.captureFps), (v) => patch({ captureFps: Number(v) }))),
      row('스크롤 방향 반전', '원격 스크롤이 반대로 움직이면 켜세요.', toggle(settings.invertScroll, (v) => patch({ invertScroll: v }))),
    );
    const agent = state.status;
    el.appendChild(h('div.callout', { class: state.agentOnline ? 'good' : 'warn', style: { marginTop: '12px' } }, h('b', state.agentOnline ? '화면 에이전트 온라인' : '화면 에이전트 오프라인 — '), state.agentOnline ? ' 이 Mac의 화면을 전송할 준비가 됐어요.' : 'Mac mini에서 macserver 앱(Electron)이 실행 중이어야 화면을 볼 수 있어요. 서버 전용 모드(npm run server)라면 브라우저에서 /agent 페이지를 열어 에이전트로 쓸 수도 있어요.'));
  }

  // ---- macOS 권한 ----
  function drawPermissions() {
    const el = sections.permissions; clear(el);
    el.append(h('h2', 'macOS 권한'), h('p.intro', '화면 전송과 원격 제어를 위해 macOS 시스템 설정에서 두 가지 권한을 허용해야 해요. 권한은 앱(개발 실행 시 "Electron", 빌드 시 "macserver")에 부여돼요.'));
    const p = sys.permissions;
    const native = sys.native || {};
    const status = (v) => v === true ? ['ok', 'check', '허용됨'] : v === false ? ['bad', 'close', '허용 필요'] : ['unk', 'info', '확인 불가'];
    const permRow = (title, desc, v, action) => { const [cls, ic, lbl] = status(v); return h('div.perm-row', h('span.ic', { class: cls }, svg(ic)), h('div.tx', h('div.t', title, ' ', h('span.badge', { class: cls === 'ok' ? 'green' : cls === 'bad' ? 'red' : 'gray' }, lbl)), h('div.s', desc)), action); };
    const openBtn = (kind, label) => h('button.btn.secondary.sm', { disabled: !sys.electron, onclick: () => api.admin.systemAction('open-privacy', { kind }).catch((e) => toast(e.message, 'error')) }, label);
    el.append(h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
      permRow('화면 기록 (Screen Recording)', '시스템 설정 > 개인정보 보호 및 보안 > 화면 및 시스템 오디오 기록 에서 허용. 허용 후 앱을 다시 실행해야 적용돼요.', p ? p.screen : null, h('div', { style: { display: 'flex', gap: '8px' } }, openBtn('screen', '설정 열기'), sys.electron ? h('button.btn.ghost.sm', { onclick: () => api.admin.systemAction('relaunch') }, '앱 재실행') : null)),
      permRow('손쉬운 사용 (Accessibility)', '시스템 설정 > 개인정보 보호 및 보안 > 손쉬운 사용 에서 허용. 원격 마우스/키보드 입력에 필요해요.', p ? p.accessibility : null, h('div', { style: { display: 'flex', gap: '8px' } }, openBtn('accessibility', '설정 열기'), sys.electron ? h('button.btn.ghost.sm', { onclick: () => api.admin.systemAction('prompt-accessibility').then(() => load()) }, '권한 요청') : null)),
      permRow('입력 브리지 (Swift 헬퍼)', native.available ? `준비됨 · ${native.path || ''}` : `사용 불가 — ${native.reason || 'Electron 앱에서만 동작'}. Xcode Command Line Tools(xcode-select --install) 설치 후 npm run build:native 또는 앱 재실행.`, native.available ? true : (sys.electron ? false : null), sys.electron ? h('button.btn.secondary.sm', { onclick: () => api.admin.systemAction('build-native').then((r) => { toast(r.result && r.result.ok ? '빌드 완료' : '빌드 실패: ' + (r.result && r.result.error), r.result && r.result.ok ? 'success' : 'error', 5000); load(); }).catch((e) => toast(e.message, 'error')) }, '다시 빌드') : null),
    ));
    if (!sys.electron) el.appendChild(h('div.callout', { style: { marginTop: '12px' } }, '지금은 서버 전용 모드로 실행 중이라 권한 상태를 읽을 수 없어요. Mac mini에서 ', h('code', 'npm start'), ' 로 앱을 실행하면 여기서 권한을 확인하고 바로 설정 창을 열 수 있어요.'));
  }

  // ---- 보안 ----
  function drawSecurity() {
    const el = sections.security; clear(el);
    el.append(h('h2', '보안'), h('p.intro', '비밀번호는 bcrypt로 저장되고, 로그인 실패가 반복되면 계정과 IP가 잠깐 잠겨요.'));
    el.append(
      row('로그인 세션 유지', '마지막 로그인 후 이 시간이 지나면 다시 로그인해야 해요.', selectCtl([['24', '1일'], ['168', '7일'], ['336', '14일'], ['720', '30일']], String(settings.sessionTtlHours), (v) => patch({ sessionTtlHours: Number(v) }))),
      row('로그인 시도 제한', `${settings.maxLoginAttempts}회 실패 시 ${settings.lockoutMinutes}분 잠금`, h('div', { style: { display: 'flex', gap: '8px' } }, numberCtl(settings.maxLoginAttempts, 3, 100, (v) => patch({ maxLoginAttempts: v })), numberCtl(settings.lockoutMinutes, 1, 1440, (v) => patch({ lockoutMinutes: v })))),
      row('삭제 시 휴지통 사용', 'Electron 앱에서 파일 삭제 시 macOS 휴지통으로 보내요. 끄면 즉시 삭제돼요.', toggle(settings.allowDeleteToTrash, (v) => patch({ allowDeleteToTrash: v }))),
      row('업로드 용량 제한', '파일 하나의 최대 크기 (MB)', numberCtl(settings.maxUploadMB, 1, 1024 * 1024, (v) => patch({ maxUploadMB: v }))),
      row('모든 세션 로그아웃', '다른 기기의 로그인을 모두 끊어요 (내 세션 포함).', h('button.btn.secondary.sm', { onclick: async () => { if (await confirmDialog({ title: '모든 세션 로그아웃', message: '모든 기기에서 다시 로그인해야 해요.', okText: '모두 로그아웃', danger: true })) { const r = await api.admin.sessions(); for (const s of r.sessions) await api.admin.revokeSession(s.id); location.reload(); } } }, '모두 로그아웃')),
    );
  }

  // ---- 서버 ----
  function drawServer() {
    const el = sections.server; clear(el);
    el.append(h('h2', '서버'), h('p.intro', '포트와 HTTPS를 바꾸면 서버를 재시작해야 해요.'));
    const port = h('input.input', { type: 'number', value: settings.port, min: 1, max: 65535, style: { width: '120px' } });
    const hostName = h('input.input', { value: settings.hostName, style: { width: '220px' } });
    el.append(
      row('호스트 이름', 'UI와 접속 안내에 표시되는 이름', h('div', { style: { display: 'flex', gap: '8px' } }, hostName, h('button.btn.secondary.sm', { onclick: () => patch({ hostName: hostName.value }).then(() => { set({ hostName: hostName.value }); }) }, '저장'))),
      row('포트', '기본 7777. 외부 공개 시 다른 포트를 쓰는 것도 좋아요.', h('div', { style: { display: 'flex', gap: '8px' } }, port, h('button.btn.secondary.sm', { onclick: () => patch({ port: Number(port.value) }) }, '적용'))),
      row('HTTPS (자체 서명 인증서)', settings.https.enabled ? '켜짐 — 브라우저에서 인증서 경고가 뜨면 "계속"을 선택하세요.' : '꺼짐 — 같은 네트워크에서는 HTTP로도 충분하지만, 외부 공개 시에는 HTTPS 또는 Tailscale을 권장해요.', toggle(settings.https.enabled, (v) => patch({ https: { ...settings.https, enabled: v } }))),
      row('바인드 주소', '0.0.0.0 = 모든 네트워크에서 접속 허용, 127.0.0.1 = 이 Mac에서만', selectCtl([['0.0.0.0', '모든 인터페이스 (0.0.0.0)'], ['127.0.0.1', '로컬 전용 (127.0.0.1)']], settings.bindAddress, (v) => patch({ bindAddress: v }))),
      row('데이터 위치', settings._dataDir || '', h('button.btn.ghost.sm', { onclick: () => copyText(settings._dataDir).then(() => toast('복사했어요')) }, '복사')),
      row('서버 재시작', '설정을 적용하거나 문제가 있을 때', h('button.btn.secondary.sm', { onclick: () => offerRestart() }, '재시작')),
    );
  }

  // ---- 외부 접속 ----
  function drawExternal() {
    const el = sections.external; clear(el);
    el.append(h('h2', '외부(인터넷)에서 접속하기'), h('p.intro', '집 밖에서 Mac mini에 접속하려면 셋 중 하나가 필요해요. 가장 쉽고 안전한 건 Tailscale이에요.'));
    el.append(h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '12px' } },
      h('div.callout.good', h('b', '1. Tailscale (추천)'), h('ol', h('li', 'Mac mini와 접속할 기기에 Tailscale 설치, 같은 계정으로 로그인'), h('li', 'Mac mini의 Tailscale IP(100.x.x.x) 확인'), h('li', h('code', `http://100.x.x.x:${settings.port}`), ' 로 접속')), h('p', { style: { marginTop: '8px' } }, '포트 포워딩 없이, 암호화된 터널로 연결돼요. WebRTC 화면 공유도 그대로 동작해요.')),
      h('div.callout', h('b', '2. 공유기 포트 포워딩'), h('ol', h('li', `공유기 관리 페이지에서 외부 포트 → Mac mini IP:${settings.port} 전달 규칙 추가`), h('li', 'Mac mini IP를 고정(DHCP 예약)'), h('li', 'HTTPS를 켜고, 강한 비밀번호 사용'), h('li', '화면 공유용 STUN은 기본 포함, 대칭 NAT 환경이면 TURN 서버 설정')), h('p', { style: { marginTop: '8px' } }, '공인 IP는 ', h('a', { href: 'https://ifconfig.me', target: '_blank' }, 'ifconfig.me'), ' 등에서 확인하세요. 변동 IP라면 DDNS를 함께 쓰세요.')),
      h('div.callout', h('b', '3. Cloudflare Tunnel'), h('ol', h('li', h('code', 'brew install cloudflared')), h('li', h('code', `cloudflared tunnel --url http://localhost:${settings.port}`)), h('li', '출력된 trycloudflare.com 주소로 접속')), h('p', { style: { marginTop: '8px' } }, '파일 서버 용도에 적합해요. WebRTC 화면 공유는 TURN 서버가 함께 필요할 수 있어요.')),
    ));
    const turnUrls = h('input.input.mono', { value: settings.turn.urls, placeholder: 'turn:turn.example.com:3478' });
    const turnUser = h('input.input', { value: settings.turn.username, placeholder: '사용자' });
    const turnPass = h('input.input', { value: settings.turn.credential, placeholder: '비밀번호', type: 'password' });
    el.appendChild(h('div.form-row', { style: { marginTop: '8px' } }, h('div', h('div.lbl', 'TURN 서버 (선택)'), h('div.sub', '외부에서 화면이 연결되지 않을 때(대칭 NAT) 필요해요. coturn 등을 직접 운영하거나 서비스를 쓰세요.')), h('div.ctl', { style: { flexDirection: 'column', alignItems: 'stretch', gap: '8px', width: '320px' } }, turnUrls, h('div', { style: { display: 'flex', gap: '8px' } }, turnUser, turnPass), h('button.btn.secondary.sm', { onclick: () => patch({ turn: { urls: turnUrls.value.trim(), username: turnUser.value, credential: turnPass.value } }) }, '저장'))));
  }

  // ---- 정보 ----
  function drawAbout() {
    const el = sections.about; clear(el);
    el.append(h('h2', '정보'));
    el.append(
      row('macserver', `버전 ${sys.version} · ${sys.electron ? 'Electron ' + sys.electron : '서버 전용 모드'} · Node ${sys.node}`, null),
      row('호스트', `${sys.hostname} · ${sys.platform}/${sys.arch} · 가동 ${Math.round(sys.uptime / 60)}분`, null),
      row('감사 로그', '로그인, 파일 작업, 화면 세션 기록을 확인해요.', h('button.btn.secondary.sm', { onclick: () => navigate('/activity') }, '활동 보기')),
    );
  }

  unsubs.push(on('status', () => { if (settings) { const s = state.status; if (s && (s.sharingPaused !== settings.sharingPaused || s.allowControl !== settings.allowControl)) { settings.sharingPaused = s.sharingPaused; settings.allowControl = s.allowControl; drawScreen(); } } }));
  unsubs.push(on('change', (p) => { if ('agentOnline' in p && settings) drawScreen(); }));
  load();
  return { cleanup: () => unsubs.forEach((u) => u()) };
}

function section(title, rows) { return h('div.settings-section', h('h2', title), ...rows); }
function row(label, sub, ctl) { return h('div.form-row', h('div', h('div.lbl', label), sub ? h('div.sub', sub) : null), ctl ? h('div.ctl', ctl) : null); }
function selectCtl(opts, value, onChange) { const s = h('select.input', ...opts.map(([v, l]) => h('option', { value: v, selected: v === value }, l))); s.addEventListener('change', () => onChange(s.value)); return s; }
function numberCtl(value, min, max, onChange) { const i = h('input.input', { type: 'number', value, min, max, style: { width: '100px' } }); i.addEventListener('change', () => { const v = Math.max(min, Math.min(max, Number(i.value) || min)); i.value = v; onChange(v); }); return i; }

/** 폴더 선택기 (Electron: 네이티브 다이얼로그, 그 외: 서버 디렉터리 브라우저) */
export async function pickDirectory(startPath, { useSetupToken } = {}) {
  if (window.macserver && window.macserver.pickFolder) { const p = await window.macserver.pickFolder(startPath); return p || null; }
  return new Promise((resolve) => {
    let cur = startPath || '';
    const fav = h('div.fav'); const list = h('div.list'); const pathInput = h('input.input.sm.mono', { value: cur, placeholder: '/Users/you/Documents' });
    const dlg = modal({ title: '폴더 선택', size: 'lg', body: [h('div', { style: { display: 'flex', gap: '8px' } }, pathInput, h('button.btn.secondary.sm', { onclick: () => show(pathInput.value) }, '이동')), h('div.dir-picker', fav, list)], onClose: (r) => resolve(r || null),
      footer: [h('button.btn.ghost', { onclick: () => dlg.close(null) }, '취소'), h('button.btn.primary', { onclick: () => dlg.close(cur) }, '이 폴더 선택')] });
    pathInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') show(pathInput.value); });
    async function show(p) {
      clear(list); list.appendChild(h('div.none', '불러오는 중…'));
      try {
        const q = p ? '?path=' + encodeURIComponent(p) : '';
        const r = useSetupToken ? await fetch('/api/setup/dirs' + q + (q ? '&' : '?') + 'setupToken=' + encodeURIComponent(useSetupToken), { headers: { 'X-MacServer': '1' } }).then((x) => x.ok ? x.json() : x.json().then((d) => { throw new Error(d.error); })) : await api.admin.dirs(p);
        cur = r.path; pathInput.value = r.path;
        clear(fav);
        fav.appendChild(h('div.hd', '즐겨찾기')); fav.appendChild(h('button', { onclick: () => show(r.home) }, svg('home'), '홈'));
        for (const f of r.favorites) fav.appendChild(h('button', { onclick: () => show(f.path) }, svg('folder'), f.name));
        if (r.volumes.length) { fav.appendChild(h('div.hd', '볼륨')); for (const v of r.volumes) fav.appendChild(h('button', { onclick: () => show(v.path) }, svg('hdd'), v.name)); }
        clear(list);
        if (r.parent) list.appendChild(h('button', { onclick: () => show(r.parent) }, svg('back'), '상위 폴더'));
        if (!r.dirs.length) list.appendChild(h('div.none', '하위 폴더가 없어요'));
        for (const d of r.dirs) list.appendChild(h('button', { onclick: () => show(d.path) }, svg('folderFill'), d.name));
      } catch (e) { clear(list); list.appendChild(h('div.none', e.message)); }
    }
    show(cur);
  });
}

/** 공유 추가 모달 */
export function openAddShare() { return shareDialog(null); }
export function openEditShare(share) { return shareDialog(share); }
function shareDialog(share) {
  return new Promise((resolve) => {
    const path = h('input.input.mono', { value: share ? share.path : '', placeholder: '/Users/you/Shared' });
    const name = h('input.input', { value: share ? share.name : '', placeholder: '예: Projects' });
    const desc = h('input.input', { value: share ? share.description || '' : '', placeholder: '설명 (선택)' });
    const err = h('div.error', { style: { color: 'var(--negative)', fontSize: '12px', minHeight: '18px' } });
    const COLORS = ['#1db954', '#e8115b', '#8d67ab', '#1e3264', '#ba5d07', '#148a08', '#e91429', '#0d73ec', '#f59b23', '#477d95', '#509bf5', '#dc148c'];
    let color = share ? share.color : COLORS[Math.floor(Math.random() * COLORS.length)];
    const sw = h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } });
    const drawSw = () => { clear(sw); for (const c of COLORS) sw.appendChild(h('button', { style: { width: '28px', height: '28px', borderRadius: '50%', background: c, outline: c === color ? '2px solid #fff' : 'none', outlineOffset: '2px' }, onclick: () => { color = c; drawSw(); } })); }; drawSw();
    const body = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '16px' } },
      h('div.field', h('label', '폴더 경로'), h('div', { style: { display: 'flex', gap: '8px' } }, path, h('button.btn.secondary.sm', { style: { height: '48px' }, onclick: async () => { const p = await pickDirectory(path.value || undefined); if (p) { path.value = p; if (!name.value) name.value = p.split('/').filter(Boolean).pop() || ''; } } }, svg('folder'), '찾아보기')), h('span.hint', '~ 로 시작하면 홈 폴더 기준이에요. 루트(/) 전체는 공유할 수 없어요.')),
      h('div.form-grid', h('div.field', h('label', '공유 이름'), name), h('div.field', h('label', '설명'), desc)),
      h('div.field', h('label', '색상'), sw), err);
    const save = h('button.btn.primary', { onclick: submit }, share ? '저장' : '공유 추가');
    const dlg = modal({ title: share ? '공유 편집' : '폴더 공유', body, onClose: (r) => resolve(!!r), footer: [h('button.btn.ghost', { onclick: () => dlg.close(false) }, '취소'), save] });
    async function submit() {
      err.textContent = ''; save.disabled = true;
      try {
        const payload = { name: name.value.trim(), path: path.value.trim(), description: desc.value.trim(), color };
        if (share) await api.admin.updateShare(share.id, payload); else await api.admin.createShare(payload);
        toast(share ? '저장했어요' : '폴더를 공유했어요', 'success'); dlg.close(true);
      } catch (e) { err.textContent = e.message; save.disabled = false; }
    }
  });
}

export function openChangePassword() {
  const cur = h('input.input', { type: 'password', placeholder: '현재 비밀번호', autocomplete: 'current-password' });
  const nw = h('input.input', { type: 'password', placeholder: '새 비밀번호 (8자 이상)', autocomplete: 'new-password' });
  const nw2 = h('input.input', { type: 'password', placeholder: '새 비밀번호 확인', autocomplete: 'new-password' });
  const err = h('div.error', { style: { color: 'var(--negative)', fontSize: '12px', minHeight: '18px' } });
  const dlg = modal({ title: '비밀번호 변경', body: [h('div.field', h('label', '현재 비밀번호'), cur), h('div.field', h('label', '새 비밀번호'), nw), h('div.field', h('label', '확인'), nw2), err], footer: [h('button.btn.ghost', { onclick: () => dlg.close() }, '취소'), h('button.btn.primary', { onclick: async () => { if (nw.value.length < 8) return err.textContent = '8자 이상이어야 해요.'; if (nw.value !== nw2.value) return err.textContent = '새 비밀번호가 서로 달라요.'; try { await api.post('/api/auth/password', { currentPassword: cur.value, newPassword: nw.value }); toast('비밀번호를 바꿨어요', 'success'); dlg.close(); } catch (e) { err.textContent = e.message; } } }, '변경')] });
}
