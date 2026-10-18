// 홈 — 인사 + 퀵 타일 + 상태 카드 + 최근 활동
import { api } from '../api.js';
import { h, svg, fmtDate, fmtDateTime, avatar, greeting, toast } from '../ui.js';
import { icon } from '../icons.js';
import { t } from '../i18n.js';
import { state, on, isAdmin, set } from '../state.js';

const AUDIT_LABEL = {
  'auth.login': '로그인', 'auth.fail': '로그인 실패', 'auth.logout': '로그아웃', 'auth.locked': '계정 잠김',
  'file.upload': '업로드', 'file.download': '다운로드', 'file.mkdir': '폴더 생성', 'file.rename': '이름 변경', 'file.move': '이동', 'file.delete': '삭제',
  'screen.start': '화면 세션 시작', 'screen.connected': '화면 연결됨', 'screen.end': '화면 세션 종료', 'screen.approved': '접속 승인', 'screen.rejected': '접속 거절',
  'account.create': '계정 생성', 'account.update': '계정 수정', 'account.delete': '계정 삭제', 'account.password': '비밀번호 변경',
  'share.create': '공유 추가', 'share.update': '공유 수정', 'share.delete': '공유 삭제', 'settings.update': '설정 변경', 'server.start': '서버 시작', 'setup.complete': '초기 설정 완료',
  'agent.connected': '에이전트 연결', 'agent.disconnected': '에이전트 끊김', 'agent.error': '에이전트 오류',
};
export function auditLabel(type) { return AUDIT_LABEL[type] || type; }
export function auditDetail(e) {
  const parts = [];
  if (e.share) parts.push(e.share + (e.path ? '/' + e.path : ''));
  if (e.from && e.to) parts.push(`${e.from} → ${e.to}`);
  if (e.count) parts.push(`${e.count}개`);
  if (e.reason && e.type !== 'auth.fail') parts.push(e.reason);
  if (e.durationSec != null) parts.push(`${Math.round(e.durationSec / 60)}분`);
  if (e.ip) parts.push(e.ip);
  if (e.control != null) parts.push(e.control ? '제어' : '보기');
  if (e.error) parts.push(e.error);
  return parts.join(' · ');
}

export function render({ container, navigate }) {
  const unsubs = [];
  const hero = h('div.hero', { style: { '--hero-color': heroColor(), minHeight: '220px' } });
  hero.appendChild(h('div.meta', h('div.kicker', state.user.isHost ? '호스트 콘솔' : isAdmin() ? '관리자' : '사용자'), h('h1.compact', `${t(greeting())}, ${state.user.displayName}`), h('div.facts', h('span', `${state.hostName}`), h('span.sep-dot'), h('span', { id: 'home-agent' }, state.agentOnline ? '화면 에이전트 온라인' : '화면 에이전트 오프라인'))));
  container.appendChild(hero);

  // 퀵 타일
  const quick = h('div.quick-grid');
  const quickSec = h('section.section.hero-shade', quick);
  container.appendChild(quickSec);
  function drawQuick() {
    quick.innerHTML = '';
    quick.appendChild(h('button.quick', { onclick: () => navigate('/screen') }, h('span.art', { style: { background: 'linear-gradient(135deg, #1db954, #0d73ec)' }, html: icon('monitorFill') }), h('span.txt', `${state.hostName} 화면`, h('small', state.agentOnline ? '보기 · 제어' : '오프라인')), h('span.play', { html: icon('play') })));
    for (const s of state.shares.slice(0, 4)) quick.appendChild(h('button.quick', { onclick: () => navigate('/files/' + s.id) }, h('span.art', { style: { background: `linear-gradient(135deg, ${s.color}, #121212)` }, html: icon('folderFill') }), h('span.txt', s.name, h('small', s.access === 'rw' ? '읽기+쓰기' : '읽기 전용')), h('span.play', { html: icon('play') })));
    if (isAdmin()) quick.appendChild(h('button.quick', { onclick: () => navigate('/accounts') }, h('span.art', { style: { background: 'linear-gradient(135deg, #8d67ab, #1e3264)' }, html: icon('usersFill') }), h('span.txt', '계정 관리', h('small', `${state.status ? state.status.accounts : '…'}개 계정`))));
    quick.appendChild(h('button.quick', { onclick: () => navigate('/settings') }, h('span.art', { style: { background: 'linear-gradient(135deg, #535353, #282828)' }, html: icon('settingsFill') }), h('span.txt', '설정', h('small', '접속 주소 · 권한 · 보안'))));
  }
  drawQuick();

  // 현재 연결 (관리자)
  const liveSec = h('section.section');
  container.appendChild(liveSec);
  function drawLive() {
    liveSec.innerHTML = '';
    if (!isAdmin() || !state.status) return;
    const st = state.status;
    const sessions = st.sessions || [];
    const clients = (st.clients || []).filter((c) => c.role === 'console' || c.role === 'viewer');
    liveSec.appendChild(h('div.section-head', h('h2', { onclick: () => navigate('/activity') }, '지금 연결됨'), h('a.more', { href: '#', onclick: (e) => { e.preventDefault(); navigate('/activity'); } }, '모두 보기')));
    const grid = h('div.grid');
    if (!sessions.length && !clients.length) grid.appendChild(h('div.card', { style: { cursor: 'default' } }, h('div.t', '접속 중인 사용자가 없어요'), h('div.s', '다른 Mac이나 브라우저에서 접속하면 여기에 표시돼요.')));
    for (const s of sessions) grid.appendChild(h('button.card', { onclick: () => navigate('/activity') }, h('div.art', { style: { background: 'linear-gradient(135deg, #1db954, #0d73ec)' } }, svg('monitorFill'), h('span.status-dot.dot', { class: s.state === 'connected' ? 'on' : 'warn' })), h('div.t', `${s.displayName || s.user} · 화면 ${s.control ? '제어' : '보기'}`), h('div.s', `${s.ip} · ${fmtDate(s.startedAt)} 시작 · ${s.state}`)));
    const seen = new Set();
    for (const c of clients) { if (seen.has(c.user + c.ip)) continue; seen.add(c.user + c.ip); grid.appendChild(h('button.card', { onclick: () => navigate(isAdmin() ? '/accounts' : '/') }, h('div.art.round', { style: { background: 'var(--bg-tinted)' } }, avatar(c.displayName || c.user, 'xl')), h('div.t', c.displayName || c.user), h('div.s', `${c.role === 'viewer' ? '화면 뷰어' : '웹 콘솔'} · ${c.ip}`))); }
    liveSec.appendChild(grid);
  }
  drawLive();

  // 공유 폴더 카드
  const shareSec = h('section.section');
  container.appendChild(shareSec);
  function drawShares() {
    shareSec.innerHTML = '';
    shareSec.appendChild(h('div.section-head', h('h2', { onclick: () => navigate('/files') }, '공유 폴더'), isAdmin() ? h('a.more', { href: '#', onclick: async (e) => { e.preventDefault(); const S = await import('./settings.js'); if (await S.openAddShare()) { const { refreshShares } = await import('../app.js'); refreshShares(); } } }, '폴더 추가') : null));
    const grid = h('div.grid');
    if (!state.shares.length) grid.appendChild(h('div.card', { style: { cursor: 'default' } }, h('div.art', { style: { background: 'var(--bg-tinted)' } }, svg('folder')), h('div.t', '공유된 폴더가 없어요'), h('div.s', isAdmin() ? '설정에서 Mac mini의 폴더를 공유해 보세요.' : '관리자에게 폴더 공유를 요청하세요.')));
    for (const s of state.shares) grid.appendChild(h('button.card', { onclick: () => navigate('/files/' + s.id) }, h('div.art', { style: { background: `linear-gradient(135deg, ${s.color}, #121212)` } }, svg('folderFill'), h('span.play', { html: icon('play') })), h('div.t', s.name), h('div.s', s.description || (s.access === 'rw' ? '읽기+쓰기' : '읽기 전용'))));
    shareSec.appendChild(grid);
  }
  drawShares();

  // 최근 활동
  const actSec = h('section.section');
  container.appendChild(actSec);
  async function drawActivity() {
    actSec.innerHTML = '';
    if (!isAdmin()) return;
    actSec.appendChild(h('div.section-head', h('h2', { onclick: () => navigate('/activity') }, '최근 활동'), h('a.more', { href: '#', onclick: (e) => { e.preventDefault(); navigate('/activity'); } }, '모두 보기')));
    const list = h('div');
    actSec.appendChild(list);
    try {
      const r = await api.admin.audit('?limit=8');
      if (!r.entries.length) list.appendChild(h('div.empty', { style: { padding: '24px' } }, h('p', '아직 활동이 없어요.')));
      for (const e of r.entries) list.appendChild(activityRow(e));
    } catch (_) {}
  }
  drawActivity();

  unsubs.push(on('change', (p) => { if ('shares' in p) { drawQuick(); drawShares(); } if ('agentOnline' in p) { const el = container.querySelector('#home-agent'); if (el) el.textContent = state.agentOnline ? '화면 에이전트 온라인' : '화면 에이전트 오프라인'; drawQuick(); } }));
  unsubs.push(on('status', () => drawLive()));
  unsubs.push(on('audit', (e) => { if (!isAdmin()) return; const list = actSec.querySelector('div:not(.section-head)'); if (list) { list.prepend(activityRow(e)); if (list.children.length > 8) list.lastChild.remove(); } }));
  return { cleanup: () => unsubs.forEach((u) => u()) };
}

export function activityRow(e) {
  return h('div.row.audit-cols', { style: { height: '48px' } },
    h('span.num', h('span.idx', svg(iconFor(e.type)))),
    h('span.name', h('span.nm', h('span.t', auditLabel(e.type)), h('span.s', e.user || e.actor || ''))),
    h('span.cell', auditDetail(e)),
    h('span.cell', fmtDateTime(e.ts)));
}
function iconFor(type) { if (type.startsWith('file')) return 'file'; if (type.startsWith('screen')) return 'monitor'; if (type.startsWith('auth')) return 'lock'; if (type.startsWith('account')) return 'user'; if (type.startsWith('share')) return 'folder'; return 'activity'; }
function heroColor() { const hr = new Date().getHours(); if (hr < 6) return '#1e3264'; if (hr < 12) return '#ba5d07'; if (hr < 18) return '#148a08'; return '#5038a0'; }
