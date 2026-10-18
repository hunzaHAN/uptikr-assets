// 활동 로그 + 현재 세션 (관리자)
import { api } from '../api.js';
import { h, svg, clear, avatar, fmtDateTime, fmtDate, toast, confirmDialog, contextMenu } from '../ui.js';
import { state, on, isAdmin } from '../state.js';
import { send as wsSend } from '../ws.js';
import { activityRow } from './home.js';

export function render({ container, navigate }) {
  if (!isAdmin()) { container.appendChild(h('div.empty', svg('lock'), h('h3', '관리자만 볼 수 있어요'))); return {}; }
  const unsubs = [];
  container.appendChild(h('div.hero', { style: { '--hero-color': '#477d95', minHeight: '200px' } }, h('div.meta', h('div.kicker', '관리'), h('h1.compact', '활동'), h('div.facts', h('span', '접속 세션, 파일 작업, 로그인 기록')))));
  const liveSec = h('section.section.hero-shade'); container.appendChild(liveSec);
  const sessSec = h('section.section'); container.appendChild(sessSec);
  const logSec = h('section.section'); container.appendChild(logSec);
  let filter = '';

  function drawLive() {
    clear(liveSec);
    const st = state.status; if (!st) return;
    liveSec.appendChild(h('div.section-head', h('h2', '실시간 화면 세션')));
    const sessions = st.sessions || [];
    if (!sessions.length) { liveSec.appendChild(h('div.callout', '진행 중인 화면 세션이 없어요.')); }
    const table = h('div.table', h('div.thead.sessions-cols', h('span.num', '#'), h('span', '사용자'), h('span', '모드'), h('span', '상태'), h('span', '시작'), h('span', '')));
    sessions.forEach((s, i) => table.appendChild(h('div.row.sessions-cols',
      h('span.num', h('span.idx', String(i + 1)), h('span.act', svg('monitor'))),
      h('span.name', avatar(s.displayName || s.user, 'lg'), h('span.nm', h('span.t', s.displayName || s.user), h('span.s', s.ip))),
      h('span.cell', h('span.badge', { class: s.control ? 'green' : 'blue' }, s.control ? '제어' : '보기')),
      h('span.cell', s.state), h('span.cell', fmtDateTime(s.startedAt)),
      h('span.more', h('button.btn.xs.danger', { onclick: () => wsSend({ type: 'host:kick', sessionId: s.id }) }, '종료')))));
    if (sessions.length) liveSec.appendChild(table);
    const clients = (st.clients || []);
    liveSec.appendChild(h('div.section-head', { style: { marginTop: '24px' } }, h('h2', '연결된 클라이언트'), h('span.more', `${clients.length}개`)));
    const g = h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } });
    for (const c of clients) g.appendChild(h('div.chip', { title: c.ua }, `${c.displayName || c.user} · ${c.role === 'viewer' ? '뷰어' : '콘솔'} · ${c.ip}`));
    if (!clients.length) g.appendChild(h('span', { style: { color: 'var(--text-subdued)' } }, '없음'));
    liveSec.appendChild(g);
  }
  async function drawSessions() {
    clear(sessSec);
    sessSec.appendChild(h('div.section-head', h('h2', '로그인 세션'), h('span.more', '토큰 기준 · 강제 로그아웃 가능')));
    try {
      const r = await api.admin.sessions();
      const table = h('div.table', h('div.thead.sessions-cols', h('span.num', '#'), h('span', '사용자'), h('span', '종류'), h('span', '기기'), h('span', '마지막 활동'), h('span', '')));
      r.sessions.sort((a, b) => new Date(b.lastSeenAt || b.createdAt) - new Date(a.lastSeenAt || a.createdAt)).forEach((s, i) => table.appendChild(h('div.row.sessions-cols',
        h('span.num', h('span.idx', String(i + 1)), h('span.act', svg('user'))),
        h('span.name', avatar(s.displayName || s.user, 'lg'), h('span.nm', h('span.t', s.displayName || s.user), h('span.s', s.ip || '—'))),
        h('span.cell', s.kind === 'host' ? '호스트 콘솔' : '웹'),
        h('span.cell', { title: s.ua }, (s.ua || '').replace(/^Mozilla\/5\.0 \(([^)]+)\).*$/, '$1').slice(0, 40)),
        h('span.cell', fmtDate(s.lastSeenAt || s.createdAt)),
        h('span.more', h('button.btn.xs.secondary', { onclick: async () => { await api.admin.revokeSession(s.id); toast('세션을 종료했어요'); drawSessions(); } }, '로그아웃')))));
      sessSec.appendChild(table);
    } catch (e) { sessSec.appendChild(h('p', e.message)); }
  }
  async function drawLog() {
    clear(logSec);
    const sel = h('select.input.sm', { style: { width: '180px' }, onchange: () => { filter = sel.value; drawLog(); } },
      ...[['', '모든 활동'], ['auth', '로그인'], ['file', '파일'], ['screen', '화면'], ['account', '계정'], ['share', '공유'], ['settings', '설정'], ['agent', '에이전트']].map(([v, l]) => h('option', { value: v, selected: v === filter }, l)));
    logSec.appendChild(h('div.section-head', h('h2', '활동 로그'), sel));
    const list = h('div'); logSec.appendChild(list);
    try {
      const r = await api.admin.audit(`?limit=200${filter ? '&type=' + filter : ''}`);
      if (!r.entries.length) list.appendChild(h('div.empty', h('p', '기록이 없어요.')));
      list.appendChild(h('div.thead.audit-cols', h('span.num', ''), h('span', '이벤트'), h('span', '상세'), h('span', '시각')));
      for (const e of r.entries) list.appendChild(activityRow(e));
    } catch (e) { list.appendChild(h('p', e.message)); }
  }
  drawLive(); drawSessions(); drawLog();
  unsubs.push(on('status', drawLive));
  unsubs.push(on('audit', (e) => { if (filter && !e.type.startsWith(filter)) return; const list = logSec.querySelector('.thead'); if (list) list.after(activityRow(e)); }));
  return { cleanup: () => unsubs.forEach((u) => u()) };
}
