// 첫 실행 마법사: 관리자 계정 → 첫 공유 폴더
import { api, setBearer } from '../api.js';
import { h, svg, toast } from '../ui.js';
import { icon } from '../icons.js';
import { pickDirectory } from './settings.js';

export function render(root, { info, localToken, onDone }) {
  let step = 0;
  const data = { username: '', password: '', displayName: '', sharePath: '', shareName: '' };
  const card = h('div.auth-card');
  root.appendChild(h('div.auth-page', card));

  function steps() { return h('div.steps', ...[0, 1, 2].map((i) => h('i', { class: i <= step ? 'done' : '' }))); }
  function draw() {
    card.innerHTML = '';
    card.appendChild(h('div.brand', h('span.logo', { html: icon('logo') }), h('span', 'macserver')));
    card.appendChild(steps());
    if (!info.isLocal && !localToken) {
      card.appendChild(h('h1', '초기 설정은 호스트에서'));
      card.appendChild(h('p.foot', 'macserver를 처음 설정할 때는 Mac mini에서 직접 앱을 열어 관리자 계정을 만들어야 해요.'));
      return;
    }
    if (step === 0) {
      const u = h('input.input', { placeholder: '예: hunza', value: data.username, autocomplete: 'off' });
      const d = h('input.input', { placeholder: '예: 훈자', value: data.displayName });
      const p = h('input.input', { type: 'password', placeholder: '8자 이상', value: data.password, autocomplete: 'new-password' });
      const p2 = h('input.input', { type: 'password', placeholder: '비밀번호 확인', autocomplete: 'new-password' });
      const err = h('div.error', { style: { minHeight: '18px', color: 'var(--negative)', fontSize: '12px' } });
      card.appendChild(h('h1', '관리자 계정 만들기'));
      card.appendChild(h('p.foot', `${info.hostName}을(를) 관리할 첫 계정이에요. 외부에서 접속할 때 이 아이디로 로그인합니다.`));
      card.appendChild(h('div.form.wizard-wide',
        h('div.field', h('label', '아이디'), u, h('span.hint', '영문/숫자/._- 2~32자')),
        h('div.field', h('label', '표시 이름'), d),
        h('div.field', h('label', '비밀번호'), p),
        h('div.field', h('label', '비밀번호 확인'), p2),
        err,
        h('button.btn.primary.block', { onclick: () => {
          if (!/^[a-z0-9][a-z0-9._-]{1,31}$/i.test(u.value.trim())) return err.textContent = '아이디 형식이 올바르지 않아요.';
          if (p.value.length < 8) return err.textContent = '비밀번호는 8자 이상이어야 해요.';
          if (p.value !== p2.value) return err.textContent = '비밀번호가 서로 달라요.';
          Object.assign(data, { username: u.value.trim(), password: p.value, displayName: d.value.trim() || u.value.trim() }); step = 1; draw();
        } }, '다음'),
      ));
      setTimeout(() => u.focus(), 30);
    } else if (step === 1) {
      const pathInput = h('input.input.mono', { placeholder: '/Users/you/Shared', value: data.sharePath });
      const nameInput = h('input.input', { placeholder: '공유 이름 (예: Projects)', value: data.shareName });
      const pick = h('button.btn.secondary.block', { onclick: async () => {
        const p = await pickDirectory(pathInput.value || undefined, { useSetupToken: localToken });
        if (p) { pathInput.value = p; if (!nameInput.value) nameInput.value = p.split('/').filter(Boolean).pop() || 'Shared'; }
      } }, svg('folder'), '폴더 선택…');
      card.appendChild(h('h1', '첫 공유 폴더'));
      card.appendChild(h('p.foot', '외부에서 서버처럼 쓸 폴더를 하나 고르세요. 나중에 설정에서 얼마든지 추가·삭제할 수 있어요. 건너뛰어도 됩니다.'));
      card.appendChild(h('div.form.wizard-wide',
        h('div.field', h('label', '폴더 경로'), pathInput, pick),
        h('div.field', h('label', '공유 이름'), nameInput),
        h('button.btn.primary.block', { onclick: () => { data.sharePath = pathInput.value.trim(); data.shareName = nameInput.value.trim(); step = 2; draw(); } }, data.sharePath || pathInput.value ? '다음' : '다음'),
        h('button.btn.ghost.block', { onclick: () => { data.sharePath = ''; step = 2; draw(); } }, '건너뛰기'),
      ));
    } else {
      const btn = h('button.btn.primary.block', { onclick: finish }, '설정 완료');
      const err = h('div.error', { style: { minHeight: '18px', color: 'var(--negative)', fontSize: '12px' } });
      card.appendChild(h('h1', '준비 완료'));
      card.appendChild(h('div.form.wizard-wide',
        h('div.callout',
          h('div', h('b', '관리자: '), `${data.displayName} (${data.username})`),
          h('div', { style: { marginTop: '6px' } }, h('b', '공유 폴더: '), data.sharePath ? `${data.shareName || '(폴더 이름)'} → ${data.sharePath}` : '나중에 추가'),
        ),
        h('p.foot', { style: { textAlign: 'left' } }, '완료 후 설정 > macOS 권한에서 화면 기록과 손쉬운 사용 권한을 허용하면 원격 제어를 쓸 수 있어요.'),
        err, btn,
        h('button.btn.ghost.block', { onclick: () => { step = 1; draw(); } }, '이전'),
      ));
      async function finish() {
        btn.disabled = true; err.textContent = '';
        try {
          const r = await api.setup({ username: data.username, password: data.password, displayName: data.displayName, setupToken: localToken || undefined, share: data.sharePath ? { name: data.shareName || undefined, path: data.sharePath } : undefined });
          setBearer(r.token);
          if (r.share && r.share.error) toast('공유 폴더 추가 실패: ' + r.share.error, 'warn', 5000);
          toast('환영해요! macserver 설정이 끝났어요.', 'success');
          await onDone();
        } catch (e) { err.textContent = e.message; btn.disabled = false; }
      }
    }
  }
  draw();
}
