import { api, setBearer } from '../api.js';
import { h, svg, toast } from '../ui.js';
import { icon } from '../icons.js';

export function render(root, { info, onDone }) {
  const user = h('input.input', { placeholder: '아이디', autocomplete: 'username', autofocus: true });
  const pass = h('input.input', { type: 'password', placeholder: '비밀번호', autocomplete: 'current-password' });
  const err = h('div.error', { style: { minHeight: '18px', color: 'var(--negative)', fontSize: '12px' } });
  const btn = h('button.btn.primary.block', { onclick: submit }, '로그인');
  async function submit() {
    err.textContent = ''; btn.disabled = true;
    try {
      const r = await api.login(user.value.trim(), pass.value);
      setBearer(r.token);
      await onDone();
    } catch (e) { err.textContent = e.message; btn.disabled = false; pass.focus(); pass.select(); }
  }
  const onKey = (e) => { if (e.key === 'Enter') submit(); };
  user.addEventListener('keydown', onKey); pass.addEventListener('keydown', onKey);
  root.appendChild(h('div.auth-page', h('div.auth-card',
    h('div.brand', h('span.logo', { html: icon('logo') }), h('span', 'macserver')),
    h('h1', `${info.hostName}에 로그인`),
    h('div.form', h('div.field', h('label', '아이디'), user), h('div.field', h('label', '비밀번호'), pass), err, btn),
    h('div.divider'),
    h('p.foot', '계정이 없나요? ', h('b', 'Mac mini 관리자'), '에게 계정을 요청하세요.'),
    info.isLocal ? h('p.foot', { style: { fontSize: '12px' } }, '이 Mac에서 macserver 앱을 실행하면 자동으로 로그인됩니다.') : null,
  )));
}
