// 검색 — 공유 폴더 전체에서 이름 검색
import { api } from '../api.js';
import { h, svg, clear, fmtSize, fmtDate, fileKind, kindIcon, kindLabel, debounce } from '../ui.js';
import { state } from '../state.js';

export function render({ container, topbarSlot, navigate, query }) {
  const input = h('input.input.pill', { placeholder: '무엇을 찾고 있나요?', value: query.q || '', autofocus: true });
  topbarSlot.appendChild(h('div.search-wrap', h('div.search-box', svg('search'), input)));
  const results = h('div.section', { style: { marginTop: '16px' } });
  container.appendChild(h('div', { style: { height: '8px' } }));
  container.appendChild(results);
  let seq = 0;
  const run = debounce(async () => {
    const q = input.value.trim(); const my = ++seq;
    history.replaceState(null, '', '/search' + (q ? '?q=' + encodeURIComponent(q) : ''));
    clear(results);
    if (!q) { drawBrowse(); return; }
    results.appendChild(h('div.empty', h('p', '검색 중…')));
    try {
      const r = await api.files.search(q);
      if (my !== seq) return;
      clear(results);
      if (!r.results.length) { results.appendChild(h('div.empty', svg('search'), h('h3', `'${q}'에 대한 결과가 없어요`), h('p', '다른 단어로 다시 시도해 보세요.'))); return; }
      results.appendChild(h('div.section-head', h('h2', `결과 ${r.results.length}개`)));
      const table = h('div.table', h('div.thead.files-cols', h('span.num', '#'), h('span', '이름'), h('span', '공유'), h('span', '수정일'), h('span', '크기'), h('span', '')));
      r.results.forEach((e, i) => {
        const kind = fileKind(e);
        const open = () => navigate(`/files/${e.share.id}${e.type === 'dir' ? '/' + e.path.split('/').map(encodeURIComponent).join('/') : (e.path.includes('/') ? '/' + e.path.split('/').slice(0, -1).map(encodeURIComponent).join('/') : '')}`);
        table.appendChild(h('div.row.files-cols', { ondblclick: open, onclick: open },
          h('span.num', h('span.idx', String(i + 1)), h('span.act', svg('folderOpen'))),
          h('span.name', h('span.ficon', { class: kind }, svg(kindIcon[kind])), h('span.nm', h('span.t', e.name), h('span.s', e.path))),
          h('span.cell', h('span.chip', { style: { background: e.share.color, color: '#000', fontSize: '11px', padding: '2px 8px' } }, e.share.name)),
          h('span.cell', fmtDate(e.mtime)), h('span.cell', e.type === 'dir' ? '—' : fmtSize(e.size)),
          h('span.more', h('a.icon-btn.ghost', { href: api.files.downloadUrl(e.share.id, e.path), download: e.name, onclick: (ev) => ev.stopPropagation() }, svg('download')))));
      });
      results.appendChild(table);
    } catch (e) { clear(results); results.appendChild(h('div.empty', h('p', e.message))); }
  }, 250);
  function drawBrowse() {
    results.appendChild(h('div.section-head', h('h2', '모두 둘러보기')));
    const grid = h('div.grid', { style: { gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' } });
    grid.appendChild(h('button.card', { style: { background: 'linear-gradient(135deg,#1db954,#0d73ec)', aspectRatio: '1.6', padding: '20px' }, onclick: () => navigate('/screen') }, h('div.t', { style: { fontSize: '24px', whiteSpace: 'normal' } }, `${state.hostName} 화면`)));
    for (const s of state.shares) grid.appendChild(h('button.card', { style: { background: `linear-gradient(135deg, ${s.color}, #121212)`, aspectRatio: '1.6', padding: '20px' }, onclick: () => navigate('/files/' + s.id) }, h('div.t', { style: { fontSize: '24px', whiteSpace: 'normal' } }, s.name)));
    results.appendChild(grid);
  }
  input.addEventListener('input', run);
  if (query.q) run(); else drawBrowse();
  setTimeout(() => input.focus(), 50);
  return {};
}
