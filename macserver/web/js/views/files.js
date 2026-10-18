// 파일 브라우저 — Spotify 플레이리스트 레이아웃 (헤더 + 트랙 리스트)
import { api, uploadFile, ApiError } from '../api.js';
import { h, svg, clear, fmtSize, fmtDate, fmtDateTime, fileKind, kindIcon, kindLabel, isTextExt, toast, modal, confirmDialog, promptDialog, contextMenu, copyText, debounce, gradientFor } from '../ui.js';
import { icon } from '../icons.js';
import { state, on, isAdmin } from '../state.js';

let viewMode = localStorage.getItem('ms.filesView') || 'list';
let showHidden = false;

export function render({ params, container, topbarSlot, navigate, refreshShares }) {
  const shareId = params.share;
  let relPath = params.rest ? decodeURIComponent(params.rest).replace(/^\/+|\/+$/g, '') : '';
  const share = state.shares.find((s) => s.id === shareId);
  if (!share) { container.appendChild(h('div.empty', svg('folder'), h('h3', '공유를 찾을 수 없어요'), h('p', '접근 권한이 없거나 삭제된 공유예요.'), h('button.btn.primary', { onclick: () => navigate('/') }, '홈으로'))); return {}; }
  const canWrite = share.access === 'rw';
  let entries = []; let selected = new Set(); let lastIndex = -1; let sort = { key: 'name', dir: 1 }; let summary = null;
  const unsubs = [];

  // ---------- 헤더 ----------
  const hero = h('div.hero', { style: { '--hero-color': share.color } });
  const art = h('div.art', { style: { background: gradientFor(share.color) } }, svg('folderFill'));
  const title = h('h1', share.name);
  const facts = h('div.facts');
  hero.append(art, h('div.meta', h('div.kicker', '공유 폴더'), title, share.description ? h('div.desc', share.description) : null, facts));
  container.appendChild(hero);

  // ---------- 액션 바 ----------
  const uploadInput = h('input', { type: 'file', multiple: true, style: { display: 'none' }, onchange: () => { queueUploads([...uploadInput.files].map((f) => ({ file: f, rel: f.name }))); uploadInput.value = ''; } });
  const folderInput = h('input', { type: 'file', webkitdirectory: true, style: { display: 'none' }, onchange: () => { queueUploads([...folderInput.files].map((f) => ({ file: f, rel: f.webkitRelativePath || f.name }))); folderInput.value = ''; } });
  const searchInput = h('input.input.sm.pill', { placeholder: '이 폴더에서 검색', style: { width: '220px' }, oninput: debounce(() => draw(), 120) });
  const actionbar = h('div.actionbar',
    h('button.play-btn', { title: canWrite ? '파일 업로드' : '전체 다운로드 (ZIP)', onclick: () => canWrite ? uploadInput.click() : downloadEntry({ path: relPath, type: 'dir', name: share.name }) }, svg(canWrite ? 'upload' : 'download')),
    canWrite ? h('button.icon-btn.lg.ghost', { title: '새 폴더', onclick: () => newFolder() }, svg('newFolder')) : null,
    canWrite ? h('button.icon-btn.lg.ghost', { title: '폴더 업로드', onclick: () => folderInput.click() }, svg('folderOpen')) : null,
    h('button.icon-btn.lg.ghost', { title: '현재 폴더 ZIP 다운로드', onclick: () => downloadEntry({ path: relPath, type: 'dir', name: relPath ? relPath.split('/').pop() : share.name }) }, svg('download')),
    h('button.icon-btn.lg.ghost', { title: '더 보기', onclick: (e) => moreMenu(e.currentTarget) }, svg('more')),
    h('div.right', h('div.search-box', svg('search'), searchInput), h('div.segment', h('button', { class: viewMode === 'list' ? 'active' : '', title: '목록', onclick: () => setView('list') }, svg('list')), h('button', { class: viewMode === 'grid' ? 'active' : '', title: '격자', onclick: () => setView('grid') }, svg('grid')))),
    uploadInput, folderInput,
  );
  container.appendChild(actionbar);
  const crumbs = h('div.crumbs');
  container.appendChild(h('div.section', { style: { marginTop: 0, marginBottom: '8px' } }, crumbs));
  const listWrap = h('div.section', { style: { marginTop: 0 } });
  container.appendChild(listWrap);

  // 탑바 슬롯: 현재 폴더명
  topbarSlot.appendChild(h('div', { style: { fontWeight: 700, fontSize: '1.25rem', opacity: 0, transition: 'opacity .2s' }, id: 'tb-title' }, share.name));
  const sc = container.parentElement; const onScroll = () => { const t = topbarSlot.querySelector('#tb-title'); if (t) t.style.opacity = sc.scrollTop > 200 ? 1 : 0; };
  sc.addEventListener('scroll', onScroll); unsubs.push(() => sc.removeEventListener('scroll', onScroll));

  // ---------- 로드 ----------
  async function load() {
    listWrap.innerHTML = ''; listWrap.appendChild(h('div.empty', h('p', '불러오는 중…')));
    try {
      const r = await api.files.list(shareId, relPath, showHidden);
      entries = r.entries; selected.clear(); draw(); drawCrumbs();
      api.files.stat(shareId, relPath).then((st) => { summary = st.summary; drawFacts(); }).catch(() => {});
    } catch (e) {
      listWrap.innerHTML = ''; listWrap.appendChild(h('div.empty', svg('alert'), h('h3', '폴더를 열 수 없어요'), h('p', e.message), h('button.btn.secondary', { onclick: () => go('') }, '루트로')));
    }
  }
  function drawFacts() {
    clear(facts);
    facts.append(h('b', state.hostName), h('span.sep-dot'), h('span', `${entries.length}개 항목`));
    if (summary) facts.append(h('span.sep-dot'), h('span', `${summary.files}개 파일${summary.truncated ? '+' : ''}, ${fmtSize(summary.bytes)}`));
    facts.append(h('span.sep-dot'), h('span.badge', { class: canWrite ? 'green' : 'blue' }, canWrite ? '읽기+쓰기' : '읽기 전용'));
  }
  function drawCrumbs() {
    clear(crumbs);
    const parts = relPath ? relPath.split('/') : [];
    crumbs.appendChild(h('button', { class: parts.length ? '' : 'cur', onclick: () => go(''), ondragover: dragOverCrumb, ondrop: (e) => dropOnCrumb(e, '') }, svg('folderFill'), ' ', share.name));
    let acc = '';
    parts.forEach((p, i) => { acc = acc ? acc + '/' + p : p; const target = acc; crumbs.append(h('span.sep', svg('chevronRight')), h('button', { class: i === parts.length - 1 ? 'cur' : '', onclick: () => go(target), ondragover: dragOverCrumb, ondrop: (e) => dropOnCrumb(e, target) }, p)); });
  }
  function go(p) { relPath = p; navigate(`/files/${shareId}${p ? '/' + p.split('/').map(encodeURIComponent).join('/') : ''}`); }
  function setView(v) { viewMode = v; localStorage.setItem('ms.filesView', v); actionbar.querySelectorAll('.segment button').forEach((b, i) => b.classList.toggle('active', (i === 0) === (v === 'list'))); draw(); }

  // ---------- 그리기 ----------
  function visible() {
    const q = searchInput.value.trim().toLowerCase();
    let list = q ? entries.filter((e) => e.name.toLowerCase().includes(q)) : entries.slice();
    list.sort((a, b) => { if ((a.type === 'dir') !== (b.type === 'dir')) return a.type === 'dir' ? -1 : 1; let v = 0; if (sort.key === 'name') v = a.name.localeCompare(b.name, 'ko', { numeric: true }); else if (sort.key === 'mtime') v = a.mtime - b.mtime; else if (sort.key === 'size') v = (a.size || 0) - (b.size || 0); else if (sort.key === 'kind') v = fileKind(a).localeCompare(fileKind(b)); return v * sort.dir; });
    return list;
  }
  function draw() {
    const list = visible();
    clear(listWrap); drawFacts();
    if (!list.length) { listWrap.appendChild(h('div.empty', svg('folderOpen'), h('h3', searchInput.value ? '검색 결과가 없어요' : '폴더가 비어 있어요'), h('p', canWrite ? '파일을 여기로 끌어다 놓거나 업로드 버튼을 누르세요.' : '아직 아무것도 없어요.'), canWrite ? h('button.btn.primary', { onclick: () => uploadInput.click() }, '업로드') : null)); return; }
    if (viewMode === 'grid') { drawGrid(list); return; }
    const head = h('div.thead.files-cols',
      h('span.num', '#'),
      sortable('이름', 'name'), sortable('종류', 'kind', 'hide-sm'), sortable('수정일', 'mtime', 'hide-sm'), sortable('크기', 'size'), h('span', ''));
    const table = h('div.table', head);
    list.forEach((e, i) => table.appendChild(row(e, i)));
    listWrap.appendChild(table);
    table.addEventListener('click', (ev) => { if (ev.target === table) { selected.clear(); refreshSelection(); } });
  }
  function sortable(label, key, cls = '') { return h('span.sortable', { class: cls, onclick: () => { if (sort.key === key) sort.dir *= -1; else sort = { key, dir: 1 }; draw(); } }, label, sort.key === key ? (sort.dir > 0 ? ' ↑' : ' ↓') : ''); }
  function row(e, i) {
    const kind = fileKind(e);
    const r = h('div.row.files-cols', { class: selected.has(e.path) ? 'selected' : '', draggable: canWrite, dataset: { path: e.path, type: e.type } },
      h('span.num', h('span.idx', String(i + 1)), h('span.act', svg(e.type === 'dir' ? 'folderOpen' : 'play'))),
      h('span.name', h('span.ficon', { class: kind }, thumbOrIcon(e, kind)), h('span.nm', h('span.t', e.name), h('span.s', e.type === 'dir' ? '폴더' : (e.ext ? e.ext.toUpperCase() + ' · ' : '') + fmtSize(e.size)))),
      h('span.cell.hide-sm', e.type === 'dir' ? '폴더' : kindLabel[kind] + (e.ext ? ` (${e.ext})` : '')),
      h('span.cell.hide-sm', { title: fmtDateTime(e.mtime) }, fmtDate(e.mtime)),
      h('span.cell', e.type === 'dir' ? '—' : fmtSize(e.size)),
      h('span.more', h('button.icon-btn.ghost', { title: '다운로드', onclick: (ev) => { ev.stopPropagation(); downloadEntry(e); } }, svg('download')), h('button.icon-btn.ghost', { title: '더 보기', onclick: (ev) => { ev.stopPropagation(); entryMenu(e, { anchor: ev.currentTarget }); } }, svg('more'))),
    );
    r.addEventListener('click', (ev) => select(e, i, ev));
    r.addEventListener('dblclick', () => open(e));
    r.addEventListener('contextmenu', (ev) => { ev.preventDefault(); if (!selected.has(e.path)) { selected.clear(); selected.add(e.path); refreshSelection(); } entryMenu(e, { x: ev.clientX, y: ev.clientY }); });
    if (canWrite) {
      r.addEventListener('dragstart', (ev) => { if (!selected.has(e.path)) { selected.clear(); selected.add(e.path); refreshSelection(); } ev.dataTransfer.setData('application/x-macserver-paths', JSON.stringify([...selected])); ev.dataTransfer.effectAllowed = 'move'; });
      if (e.type === 'dir') { r.addEventListener('dragover', (ev) => { if (ev.dataTransfer.types.includes('application/x-macserver-paths') || ev.dataTransfer.types.includes('Files')) { ev.preventDefault(); r.classList.add('drop-target'); ev.stopPropagation(); } }); r.addEventListener('dragleave', () => r.classList.remove('drop-target')); r.addEventListener('drop', (ev) => { r.classList.remove('drop-target'); handleDrop(ev, e.path); }); }
    }
    return r;
  }
  function thumbOrIcon(e, kind) {
    if (kind === 'img' && e.size < 15 * 1024 * 1024 && ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'avif', 'bmp'].includes(e.ext)) return h('img', { src: api.files.downloadUrl(shareId, e.path, true), loading: 'lazy', alt: '' });
    return svg(kindIcon[kind]);
  }
  function drawGrid(list) {
    const grid = h('div.grid', { style: { gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' } });
    for (const e of list) {
      const kind = fileKind(e);
      const card = h('button.card', { class: selected.has(e.path) ? 'selected' : '', dataset: { path: e.path }, onclick: (ev) => select(e, list.indexOf(e), ev), ondblclick: () => open(e), oncontextmenu: (ev) => { ev.preventDefault(); entryMenu(e, { x: ev.clientX, y: ev.clientY }); } },
        h('div.art', { style: { background: e.type === 'dir' ? gradientFor(share.color) : 'var(--bg-tinted)' } }, kind === 'img' ? h('img', { src: api.files.downloadUrl(shareId, e.path, true), loading: 'lazy', alt: '', style: { width: '100%', height: '100%', objectFit: 'cover' } }) : svg(kindIcon[kind]), h('span.play', { html: icon(e.type === 'dir' ? 'folderOpen' : 'play'), onclick: (ev) => { ev.stopPropagation(); open(e); } })),
        h('div.t', e.name), h('div.s', e.type === 'dir' ? '폴더' : `${kindLabel[kind]} · ${fmtSize(e.size)}`));
      grid.appendChild(card);
    }
    listWrap.appendChild(grid);
  }
  function select(e, i, ev) {
    if (ev.shiftKey && lastIndex >= 0) { const list = visible(); const [a, b] = [Math.min(lastIndex, i), Math.max(lastIndex, i)]; for (let k = a; k <= b; k++) selected.add(list[k].path); }
    else if (ev.metaKey || ev.ctrlKey) { if (selected.has(e.path)) selected.delete(e.path); else selected.add(e.path); }
    else { selected.clear(); selected.add(e.path); }
    lastIndex = i; refreshSelection();
  }
  function refreshSelection() { listWrap.querySelectorAll('[data-path]').forEach((el) => el.classList.toggle('selected', selected.has(el.dataset.path))); }
  function selectedEntries() { return entries.filter((e) => selected.has(e.path)); }

  // ---------- 동작 ----------
  function open(e) { if (e.type === 'dir') go(e.path); else preview(e); }
  function downloadEntry(e) { const a = h('a', { href: api.files.downloadUrl(shareId, e.path), download: e.name }); document.body.appendChild(a); a.click(); a.remove(); }
  function preview(e) {
    const kind = fileKind(e); const url = api.files.downloadUrl(shareId, e.path, true);
    let body;
    if (kind === 'img') body = h('div.preview', h('img', { src: url, alt: e.name }));
    else if (kind === 'vid') body = h('div.preview', h('video', { src: url, controls: true, autoplay: true }));
    else if (kind === 'aud') body = h('div.preview', { style: { minHeight: '120px' } }, h('audio', { src: url, controls: true, autoplay: true }));
    else if (e.ext === 'pdf') body = h('div.preview', h('iframe', { src: url, title: e.name }));
    else if (isTextExt(e.ext) && e.size < 1024 * 1024) { body = h('div.preview', h('pre', '불러오는 중…')); api.files.text(shareId, e.path).then((r) => { body.firstChild.textContent = r.text + (r.truncated ? '\n\n… (1MB 까지만 표시)' : ''); }).catch((err) => { body.firstChild.textContent = err.message; }); }
    else { downloadEntry(e); return; }
    const dlg = modal({ title: e.name, size: 'lg', body, footer: [h('span', { style: { marginRight: 'auto', color: 'var(--text-subdued)', fontSize: '12px', alignSelf: 'center' } }, `${kindLabel[kind]} · ${fmtSize(e.size)} · ${fmtDateTime(e.mtime)}`), h('button.btn.secondary.sm', { onclick: () => downloadEntry(e) }, svg('download'), '다운로드'), h('button.btn.primary.sm', { onclick: () => dlg.close() }, '닫기')] });
  }
  async function newFolder() {
    const name = await promptDialog({ title: '새 폴더', label: '폴더 이름', placeholder: '제목 없는 폴더', validate: (v) => !v ? '이름을 입력하세요.' : /[\/\\:]/.test(v) ? '/ \\ : 는 사용할 수 없어요.' : null });
    if (!name) return;
    try { await api.files.mkdir(shareId, relPath, name); toast('폴더를 만들었어요', 'success'); load(); } catch (e) { toast(e.message, 'error'); }
  }
  async function renameEntry(e) {
    const name = await promptDialog({ title: '이름 바꾸기', label: '새 이름', value: e.name, validate: (v) => !v ? '이름을 입력하세요.' : /[\/\\:]/.test(v) ? '/ \\ : 는 사용할 수 없어요.' : null });
    if (!name || name === e.name) return;
    try { await api.files.rename(shareId, e.path, name); load(); } catch (err) { toast(err.message, 'error'); }
  }
  async function deleteEntries(list) {
    const ok = await confirmDialog({ title: list.length === 1 ? `'${list[0].name}' 삭제` : `${list.length}개 항목 삭제`, message: state.isElectron || true ? '선택한 항목을 삭제할까요? Mac mini에서는 휴지통으로 이동하며(설정에 따라), 폴더는 안의 내용까지 함께 삭제돼요.' : '', okText: '삭제', danger: true });
    if (!ok) return;
    try { const r = await api.files.delete(shareId, list.map((e) => e.path)); toast(r.results.some((x) => x.trashed) ? '휴지통으로 옮겼어요' : '삭제했어요', 'success'); load(); } catch (e) { toast(e.message, 'error'); load(); }
  }
  async function moveEntries(paths, dest) {
    if (paths.some((p) => dest === p || dest.startsWith(p + '/'))) return toast('폴더를 자기 자신 안으로 옮길 수 없어요', 'warn');
    try { await api.files.move(shareId, paths, dest); toast(`${paths.length}개 항목을 옮겼어요`, 'success'); load(); } catch (e) { toast(e.message, 'error'); }
  }
  function entryMenu(e, pos) {
    const sel = selectedEntries(); const multi = sel.length > 1 && sel.some((x) => x.path === e.path);
    contextMenu([
      !multi ? { label: e.type === 'dir' ? '열기' : '미리보기', icon: e.type === 'dir' ? 'folderOpen' : 'eye', onClick: () => open(e) } : null,
      { label: multi ? `${sel.length}개 다운로드` : (e.type === 'dir' ? 'ZIP으로 다운로드' : '다운로드'), icon: 'download', onClick: () => (multi ? sel : [e]).forEach((x, i) => setTimeout(() => downloadEntry(x), i * 300)) },
      { label: '링크 복사', icon: 'link', onClick: () => copyText(location.origin + api.files.downloadUrl(shareId, e.path)).then(() => toast('링크를 복사했어요 (로그인 필요)')) },
      '-',
      canWrite && !multi ? { label: '이름 바꾸기', icon: 'edit', onClick: () => renameEntry(e) } : null,
      canWrite ? { label: '이동…', icon: 'move', onClick: () => pickMoveTarget(multi ? sel.map((x) => x.path) : [e.path]) } : null,
      canWrite ? { label: multi ? `${sel.length}개 삭제` : '삭제', icon: 'trash', danger: true, onClick: () => deleteEntries(multi ? sel : [e]) } : null,
      '-',
      { label: '정보', icon: 'info', onClick: () => infoDialog(e) },
    ], pos);
  }
  function moreMenu(anchor) {
    contextMenu([
      { label: '새로 고침', icon: 'refresh', onClick: () => load() },
      { label: showHidden ? '숨김 파일 감추기' : '숨김 파일 보기', icon: showHidden ? 'eyeOff' : 'eye', onClick: () => { showHidden = !showHidden; load(); } },
      { label: '폴더 정보', icon: 'info', onClick: () => infoDialog({ name: relPath ? relPath.split('/').pop() : share.name, path: relPath, type: 'dir' }) },
      isAdmin() ? '-' : null,
      isAdmin() ? { label: '공유 설정…', icon: 'settings', onClick: () => import('./settings.js').then((S) => S.openEditShare(share).then((ok) => ok && refreshShares())) } : null,
      isAdmin() && share.path ? { label: '경로 복사', icon: 'copy', onClick: () => copyText(share.path).then(() => toast('경로를 복사했어요')) } : null,
    ], { anchor });
  }
  async function infoDialog(e) {
    const body = h('div.kv', { style: { display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 16px', fontSize: '14px' } });
    const dlg = modal({ title: e.name, body });
    try {
      const st = await api.files.stat(shareId, e.path);
      const rows = [['종류', st.type === 'dir' ? '폴더' : kindLabel[fileKind(st)]], ['경로', share.name + '/' + (st.path || '')], ['크기', st.type === 'dir' ? (st.summary ? `${fmtSize(st.summary.bytes)}${st.summary.truncated ? '+' : ''} (${st.summary.files}개 파일, ${st.summary.dirs}개 폴더)` : '—') : fmtSize(st.size)], ['수정일', new Date(st.mtime).toLocaleString()], ['생성일', new Date(st.ctime).toLocaleString()]];
      for (const [k, v] of rows) body.append(h('span', { style: { color: 'var(--text-subdued)' } }, k), h('span', { style: { userSelect: 'text', wordBreak: 'break-all' } }, v));
    } catch (err) { body.appendChild(h('span', err.message)); }
  }
  async function pickMoveTarget(paths) {
    let cur = ''; const list = h('div.dir-picker', { style: { gridTemplateColumns: '1fr', height: '320px' } }); const crumb = h('div.crumbs');
    const dlg = modal({ title: `${paths.length}개 항목 이동`, body: [crumb, list], footer: [h('button.btn.ghost', { onclick: () => dlg.close() }, '취소'), h('button.btn.primary', { onclick: () => { dlg.close(); moveEntries(paths, cur); } }, '여기로 이동')] });
    async function show(p) {
      cur = p; clear(crumb); clear(list);
      const parts = p ? p.split('/') : []; crumb.appendChild(h('button', { onclick: () => show('') }, share.name)); let acc = '';
      for (const q of parts) { acc = acc ? acc + '/' + q : q; const tgt = acc; crumb.append(h('span.sep', svg('chevronRight')), h('button', { onclick: () => show(tgt) }, q)); }
      const inner = h('div.list'); list.appendChild(inner);
      try { const r = await api.files.list(shareId, p); const dirs = r.entries.filter((e) => e.type === 'dir' && !paths.includes(e.path)); if (!dirs.length) inner.appendChild(h('div.none', '하위 폴더 없음')); for (const d of dirs) inner.appendChild(h('button', { onclick: () => show(d.path) }, svg('folderFill'), d.name)); } catch (e) { inner.appendChild(h('div.none', e.message)); }
    }
    show(relPath);
  }

  // ---------- 드래그 앤 드롭 ----------
  const overlay = h('div.drop-overlay.hidden', '여기에 놓아 업로드');
  const main = container.closest('.main'); main.appendChild(overlay);
  let dragDepth = 0;
  const onDragEnter = (e) => { if (!canWrite || !e.dataTransfer.types.includes('Files')) return; e.preventDefault(); dragDepth++; overlay.classList.remove('hidden'); };
  const onDragOver = (e) => { if (!canWrite) return; if (e.dataTransfer.types.includes('Files') || e.dataTransfer.types.includes('application/x-macserver-paths')) { e.preventDefault(); e.dataTransfer.dropEffect = e.dataTransfer.types.includes('Files') ? 'copy' : 'move'; } };
  const onDragLeave = (e) => { if (!canWrite) return; dragDepth = Math.max(0, dragDepth - 1); if (dragDepth === 0) overlay.classList.add('hidden'); };
  const onDrop = (e) => { dragDepth = 0; overlay.classList.add('hidden'); if (!canWrite) return; handleDrop(e, relPath); };
  main.addEventListener('dragenter', onDragEnter); main.addEventListener('dragover', onDragOver); main.addEventListener('dragleave', onDragLeave); main.addEventListener('drop', onDrop);
  unsubs.push(() => { main.removeEventListener('dragenter', onDragEnter); main.removeEventListener('dragover', onDragOver); main.removeEventListener('dragleave', onDragLeave); main.removeEventListener('drop', onDrop); overlay.remove(); });
  function dragOverCrumb(ev) { if (canWrite && ev.dataTransfer.types.includes('application/x-macserver-paths')) { ev.preventDefault(); } }
  function dropOnCrumb(ev, target) { ev.preventDefault(); const raw = ev.dataTransfer.getData('application/x-macserver-paths'); if (raw) moveEntries(JSON.parse(raw), target); }
  async function handleDrop(ev, targetDir) {
    ev.preventDefault(); ev.stopPropagation();
    const raw = ev.dataTransfer.getData('application/x-macserver-paths');
    if (raw) { const paths = JSON.parse(raw); if (paths.every((p) => p.split('/').slice(0, -1).join('/') === targetDir)) return; moveEntries(paths, targetDir); return; }
    const items = ev.dataTransfer.items ? [...ev.dataTransfer.items] : [];
    const files = [];
    const entriesApi = items.map((it) => it.webkitGetAsEntry && it.webkitGetAsEntry()).filter(Boolean);
    if (entriesApi.length) { for (const en of entriesApi) await walkEntry(en, '', files); }
    else for (const f of ev.dataTransfer.files) files.push({ file: f, rel: f.name });
    queueUploads(files, targetDir);
  }
  function walkEntry(entry, prefix, out) {
    return new Promise((resolve) => {
      if (entry.isFile) entry.file((f) => { out.push({ file: f, rel: prefix + f.name }); resolve(); }, () => resolve());
      else if (entry.isDirectory) { const reader = entry.createReader(); const all = []; const readMore = () => reader.readEntries(async (ents) => { if (!ents.length) { for (const e of all) await walkEntry(e, prefix + entry.name + '/', out); resolve(); return; } all.push(...ents); readMore(); }, () => resolve()); readMore(); }
      else resolve();
    });
  }

  // ---------- 업로드 큐 ----------
  function queueUploads(items, targetDir = relPath) {
    if (!items.length) return;
    const panel = getUploadPanel();
    let done = 0, failed = 0;
    const run = async (it) => {
      const name = it.rel.split('/').pop();
      const row = h('div.upload-item', h('span.nm', { title: it.rel }, it.rel), h('span.bar', h('i')), h('span.st', '0%'));
      panel.items.prepend(row);
      const bar = row.querySelector('i'); const st = row.querySelector('.st');
      const target = (targetDir ? targetDir + '/' : '') + it.rel;
      try {
        await uploadFile({ share: shareId, path: target, file: it.file, onProgress: (p) => { bar.style.setProperty('--pct', Math.round(p * 100) + '%'); st.textContent = Math.round(p * 100) + '%'; } });
        st.textContent = '완료'; bar.style.setProperty('--pct', '100%'); done++;
      } catch (e) {
        if (e.code === 'EXISTS') {
          const ok = await confirmDialog({ title: '같은 이름의 파일이 있어요', message: `'${name}'을(를) 덮어쓸까요?`, okText: '덮어쓰기', danger: true });
          if (ok) { try { await uploadFile({ share: shareId, path: target, file: it.file, overwrite: true, onProgress: (p) => bar.style.setProperty('--pct', Math.round(p * 100) + '%') }); st.textContent = '완료'; done++; return; } catch (e2) { e = e2; } }
          else { st.textContent = '건너뜀'; row.classList.add('err'); return; }
        }
        st.textContent = e.message; row.classList.add('err'); failed++;
      }
    };
    (async () => {
      const queue = items.slice(); const workers = Array.from({ length: Math.min(3, queue.length) }, async () => { while (queue.length) await run(queue.shift()); });
      await Promise.all(workers);
      panel.title.textContent = failed ? `업로드 완료 (${done}개 성공, ${failed}개 실패)` : `업로드 완료 (${done}개)`;
      if (targetDir === relPath) load(); else load();
      setTimeout(() => { if (panel.el.isConnected && !panel.el.matches(':hover')) panel.el.remove(); }, failed ? 15000 : 4000);
    })();
    panel.title.textContent = `업로드 중… (${items.length}개)`;
  }
  let uploadPanel = null;
  function getUploadPanel() {
    if (uploadPanel && uploadPanel.el.isConnected) return uploadPanel;
    const title = h('span', '업로드'); const items = h('div.items');
    const el = h('div.upload-panel', h('div.hd', title, h('button.icon-btn.ghost', { onclick: () => el.remove() }, svg('close'))), items);
    document.body.appendChild(el); uploadPanel = { el, title, items }; return uploadPanel;
  }

  // 키보드
  const onKey = (e) => {
    if (e.target.matches('input, textarea')) return;
    if (document.querySelector('.backdrop')) return;
    if ((e.metaKey || e.ctrlKey) && e.key === 'a') { e.preventDefault(); visible().forEach((x) => selected.add(x.path)); refreshSelection(); }
    else if (e.key === 'Backspace' && canWrite && selected.size && (e.metaKey || e.ctrlKey)) { e.preventDefault(); deleteEntries(selectedEntries()); }
    else if (e.key === 'Enter' && selected.size === 1) { const en = selectedEntries()[0]; if (en) open(en); }
    else if (e.key === 'Escape') { selected.clear(); refreshSelection(); }
    else if (e.key === ' ' && selected.size === 1) { e.preventDefault(); const en = selectedEntries()[0]; if (en && en.type !== 'dir') preview(en); }
  };
  window.addEventListener('keydown', onKey); unsubs.push(() => window.removeEventListener('keydown', onKey));

  load();
  return { cleanup: () => unsubs.forEach((u) => u()) };
}

export function shareContextMenu(share, ev) {
  import('../app.js').then(({ navigate, refreshShares }) => {
    contextMenu([
      { label: '열기', icon: 'folderOpen', onClick: () => navigate('/files/' + share.id) },
      { label: 'ZIP 다운로드', icon: 'download', onClick: () => { const a = h('a', { href: api.files.downloadUrl(share.id, ''), download: share.name + '.zip' }); document.body.appendChild(a); a.click(); a.remove(); } },
      isAdmin() ? '-' : null,
      isAdmin() ? { label: '공유 설정…', icon: 'settings', onClick: () => import('./settings.js').then((S) => S.openEditShare(share).then((ok) => ok && refreshShares())) } : null,
      isAdmin() ? { label: '공유 해제', icon: 'trash', danger: true, onClick: async () => { if (await confirmDialog({ title: `'${share.name}' 공유 해제`, message: '폴더 자체는 삭제되지 않고, 공유 목록에서만 제거돼요.', okText: '공유 해제', danger: true })) { await api.admin.deleteShare(share.id); refreshShares(); navigate('/'); } } } : null,
    ], { x: ev.clientX, y: ev.clientY });
  });
}
