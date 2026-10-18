// 계정 관리 (관리자) — 목록 + 생성/편집 모달 (공유별 권한 지정)
import { api } from '../api.js';
import { h, svg, clear, avatar, fmtDate, fmtDateTime, toast, modal, confirmDialog, contextMenu, segment, toggle, copyText, gradientFor } from '../ui.js';
import { icon } from '../icons.js';
import { state, on, isAdmin } from '../state.js';

export function render({ params, container, navigate }) {
  if (!isAdmin()) { container.appendChild(h('div.empty', svg('lock'), h('h3', '관리자만 볼 수 있어요'))); return {}; }
  let accounts = [], shares = [];
  const unsubs = [];
  const hero = h('div.hero', { style: { '--hero-color': '#8d67ab', minHeight: '240px' } },
    h('div.art.round', { style: { background: 'linear-gradient(135deg, #8d67ab, #1e3264)' } }, svg('usersFill')),
    h('div.meta', h('div.kicker', '관리'), h('h1.compact', '계정'), h('div.facts', { id: 'acc-facts' })));
  container.appendChild(hero);
  const actionbar = h('div.actionbar',
    h('button.play-btn', { title: '계정 만들기', onclick: () => openAccountDialog(null, shares).then((ok) => ok && load()) }, svg('plus')),
    h('button.btn.secondary.sm', { onclick: () => navigate('/activity') }, svg('activity'), '접속 기록'),
    h('div.right', h('span', { style: { color: 'var(--text-subdued)', fontSize: '12px' } }, '계정마다 볼 수 있는 폴더와 화면 권한을 따로 정할 수 있어요.')));
  container.appendChild(actionbar);
  const listWrap = h('div.section', { style: { marginTop: 0 } });
  container.appendChild(listWrap);

  async function load() {
    try { [accounts, shares] = await Promise.all([api.admin.accounts().then((r) => r.accounts), api.admin.shares().then((r) => r.shares)]); draw(); }
    catch (e) { listWrap.innerHTML = ''; listWrap.appendChild(h('div.empty', h('p', e.message))); }
  }
  function draw() {
    clear(listWrap);
    const facts = container.querySelector('#acc-facts'); clear(facts);
    facts.append(h('b', `${accounts.length}개 계정`), h('span.sep-dot'), h('span', `관리자 ${accounts.filter((a) => a.role === 'admin').length}명`), h('span.sep-dot'), h('span', `공유 폴더 ${shares.length}개`));
    const table = h('div.table', h('div.thead.accounts-cols', h('span.num', '#'), h('span', '계정'), h('span', '역할'), h('span', '권한'), h('span', '마지막 로그인'), h('span', '')));
    const online = new Set(((state.status && state.status.clients) || []).map((c) => c.user));
    accounts.forEach((a, i) => {
      const shareNames = a.shares.map((s) => { const sh = shares.find((x) => x.id === s.shareId); return sh ? `${sh.name}(${s.access === 'rw' ? 'RW' : 'R'})` : null; }).filter(Boolean);
      const row = h('div.row.accounts-cols', { class: params.id === a.id ? 'selected' : '', onclick: () => openAccountDialog(a, shares).then((ok) => ok && load()), oncontextmenu: (e) => { e.preventDefault(); menu(a, { x: e.clientX, y: e.clientY }); } },
        h('span.num', h('span.idx', String(i + 1)), h('span.act', svg('edit'))),
        h('span.name', h('span', { style: { position: 'relative' } }, avatar(a.displayName, 'lg'), online.has(a.username) ? h('span.dot.on', { style: { position: 'absolute', right: 0, bottom: 0 } }) : null), h('span.nm', h('span.t', a.displayName, !a.enabled ? h('span.badge.gray', { style: { marginLeft: '8px' } }, '비활성') : null), h('span.s', '@' + a.username))),
        h('span.cell', h('span.badge', { class: a.role === 'admin' ? 'green' : 'outline' }, a.role === 'admin' ? '관리자' : '사용자')),
        h('span.cell', { title: shareNames.join(', ') }, a.role === 'admin' ? '모든 폴더 · 화면 제어' : [a.permissions.screenControl ? '화면 제어' : a.permissions.screenView ? '화면 보기' : '화면 ×', shareNames.length ? `폴더 ${shareNames.length}개` : '폴더 ×'].join(' · ')),
        h('span.cell', a.lastLoginAt ? fmtDate(a.lastLoginAt) : '—'),
        h('span.more', h('button.icon-btn.ghost', { onclick: (e) => { e.stopPropagation(); menu(a, { anchor: e.currentTarget }); } }, svg('more'))));
      table.appendChild(row);
    });
    listWrap.appendChild(table);
    if (params.id) { const a = accounts.find((x) => x.id === params.id); if (a) { openAccountDialog(a, shares).then((ok) => ok && load()); navigate('/accounts', { replace: true }); } }
  }
  function menu(a, pos) {
    const me = state.user;
    contextMenu([
      { label: '편집', icon: 'edit', onClick: () => openAccountDialog(a, shares).then((ok) => ok && load()) },
      { label: a.enabled ? '비활성화' : '활성화', icon: a.enabled ? 'eyeOff' : 'eye', disabled: a.id === me.id, onClick: async () => { try { await api.admin.updateAccount(a.id, { enabled: !a.enabled }); load(); } catch (e) { toast(e.message, 'error'); } } },
      { label: '접속 안내 복사', icon: 'link', onClick: () => copyInvite(a) },
      '-',
      { label: '삭제', icon: 'trash', danger: true, disabled: a.id === me.id, onClick: async () => { if (await confirmDialog({ title: `'${a.displayName}' 계정 삭제`, message: '이 계정으로는 더 이상 접속할 수 없게 돼요.', okText: '삭제', danger: true })) { try { await api.admin.deleteAccount(a.id); toast('삭제했어요'); load(); } catch (e) { toast(e.message, 'error'); } } } },
    ], pos);
  }
  async function copyInvite(a) {
    const sys = state.sysInfo || (await api.systemInfo().catch(() => null));
    const url = sys && sys.lan && sys.lan[0] ? `${sys.https ? 'https' : 'http'}://${sys.lan[0].address}:${sys.port}` : location.origin;
    await copyText(`macserver 접속 안내\n주소: ${url}\n아이디: ${a.username}\n(비밀번호는 별도로 전달하세요)`);
    toast('접속 안내를 복사했어요');
  }
  unsubs.push(on('status', () => { if (accounts.length) draw(); }));
  load();
  return { cleanup: () => unsubs.forEach((u) => u()) };
}

/** 계정 생성/편집 모달. resolve(true) 면 변경됨 */
export function openAccountDialog(acc, shares) {
  return new Promise((resolve) => {
    const isNew = !acc; const me = state.user;
    const f = {
      username: h('input.input', { value: acc ? acc.username : '', placeholder: '영문/숫자 2~32자', disabled: !isNew, autocomplete: 'off' }),
      displayName: h('input.input', { value: acc ? acc.displayName : '', placeholder: '표시 이름' }),
      password: h('input.input', { type: 'password', placeholder: isNew ? '8자 이상' : '변경할 때만 입력', autocomplete: 'new-password' }),
      role: h('select.input', h('option', { value: 'user' }, '사용자 — 지정한 폴더/권한만'), h('option', { value: 'admin' }, '관리자 — 모든 권한')),
    };
    f.role.value = acc ? acc.role : 'user';
    const perm = { screenView: acc ? !!acc.permissions.screenView : true, screenControl: acc ? !!acc.permissions.screenControl : false };
    const enabled = acc ? acc.enabled : true;
    const access = new Map((acc ? acc.shares : []).map((s) => [s.shareId, s.access]));
    const err = h('div.error', { style: { color: 'var(--negative)', fontSize: '12px', minHeight: '18px' } });

    const viewT = toggle(perm.screenView, (v) => { perm.screenView = v; if (!v) { perm.screenControl = false; ctrlT.set(false); } });
    const ctrlT = toggle(perm.screenControl, (v) => { perm.screenControl = v; if (v) { perm.screenView = true; viewT.set(true); } });
    const enabledT = toggle(enabled, () => {});
    const permBlock = h('div',
      h('div.form-row', h('div', h('div.lbl', '화면 보기'), h('div.sub', 'Mac mini 화면을 실시간으로 볼 수 있어요.')), h('div.ctl', viewT)),
      h('div.form-row', h('div', h('div.lbl', '화면 제어'), h('div.sub', '마우스·키보드로 원격 조작할 수 있어요. 호스트 설정에서 전역 차단 가능.')), h('div.ctl', ctrlT)),
      h('div.form-row', h('div', h('div.lbl', '계정 활성'), h('div.sub', '끄면 로그인이 즉시 차단돼요.')), h('div.ctl', enabledT)));
    const shareList = h('div.share-access');
    const drawShares = () => {
      clear(shareList);
      if (!shares.length) shareList.appendChild(h('div.callout', '아직 공유 폴더가 없어요. 설정 > 공유 폴더에서 먼저 추가하세요.'));
      for (const s of shares) {
        const seg = segment([{ value: 'none', label: '없음' }, { value: 'ro', label: '읽기' }, { value: 'rw', label: '읽기+쓰기' }], access.get(s.id) || 'none', (v) => { if (v === 'none') access.delete(s.id); else access.set(s.id, v); });
        shareList.appendChild(h('div.item', h('span.art', { style: { background: gradientFor(s.color) } }, svg('folderFill')), h('span.nm', s.name, h('small', s.path)), seg));
      }
    };
    drawShares();
    const adminNote = h('div.callout.good', { class: f.role.value === 'admin' ? '' : 'hidden' }, '관리자는 모든 공유 폴더에 읽기+쓰기, 화면 보기/제어 권한을 자동으로 가져요.');
    f.role.addEventListener('change', () => { const a = f.role.value === 'admin'; adminNote.classList.toggle('hidden', !a); permBlock.classList.toggle('hidden', a); shareList.classList.toggle('hidden', a); });
    if (f.role.value === 'admin') { permBlock.classList.add('hidden'); shareList.classList.add('hidden'); }

    const body = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '20px' } },
      h('div.form-grid',
        h('div.field', h('label', '아이디'), f.username),
        h('div.field', h('label', '표시 이름'), f.displayName),
        h('div.field', h('label', isNew ? '비밀번호' : '새 비밀번호'), f.password),
        h('div.field', h('label', '역할'), f.role)),
      adminNote,
      h('div', h('h3', { style: { fontSize: '16px', marginBottom: '4px' } }, '화면'), permBlock),
      h('div', h('h3', { style: { fontSize: '16px', marginBottom: '8px' } }, '접근 가능한 폴더'), shareList),
      err);
    const save = h('button.btn.primary', { onclick: submit }, isNew ? '계정 만들기' : '저장');
    const dlg = modal({ title: isNew ? '새 계정' : `${acc.displayName} 편집`, size: 'lg', body, onClose: (r) => resolve(!!r), footer: [h('button.btn.ghost', { onclick: () => dlg.close(false) }, '취소'), save] });
    async function submit() {
      err.textContent = ''; save.disabled = true;
      const payload = { displayName: f.displayName.value.trim(), role: f.role.value, permissions: perm, shares: [...access].map(([shareId, a]) => ({ shareId, access: a })), enabled: enabledT.classList.contains('on') };
      if (isNew) { payload.username = f.username.value.trim(); payload.password = f.password.value; }
      else if (f.password.value) payload.password = f.password.value;
      try {
        if (isNew) await api.admin.createAccount(payload); else await api.admin.updateAccount(acc.id, payload);
        toast(isNew ? '계정을 만들었어요' : '저장했어요', 'success');
        if (!isNew && acc.id === me.id && payload.password) toast('비밀번호를 바꿨어요. 다른 기기에서는 다시 로그인해야 해요.', 'warn', 4000);
        dlg.close(true);
      } catch (e) { err.textContent = e.message; save.disabled = false; }
    }
  });
}
