// 하단 상태바 — Spotify "Now playing" 바를 화면 세션/서버 상태 표시로 재해석
import { h, svg, clear, fmtBitrate, fmtDuration, copyText, toast } from '../ui.js';
import { icon } from '../icons.js';
import { state, on, isAdmin } from '../state.js';

export class StatusBar {
  constructor({ onNavigate, wsSend }) {
    this.navigate = onNavigate; this.wsSend = wsSend;
    this.el = h('footer.statusbar');
    this.status = null; this.session = null; this.stats = null;
    this.left = h('div.left'); this.center = h('div.center'); this.right = h('div.right');
    this.el.append(this.left, this.center, this.right);
    this.thumbVideo = null;
    on('viewer', (s) => this.bind(s));
    on('viewer:stats', (st) => { this.stats = st; this.renderCenter(); });
    on('change', (p) => { if ('agentOnline' in p || 'hostName' in p || 'sysInfo' in p) this.render(); });
    this.timer = setInterval(() => { if (this.session && this.session.state === 'connected') this.renderCenter(); }, 1000);
    this.render();
  }
  setStatus(st) { this.status = st; this.render(); }
  bind(session) {
    this.session = session; this.stats = null;
    if (session) {
      session.on('state', () => this.render());
      session.on('control', () => this.render());
    }
    this.render();
  }
  render() { this.renderLeft(); this.renderCenter(); this.renderRight(); }
  renderLeft() {
    clear(this.left);
    const s = this.session;
    if (s && s.state !== 'idle' && s.state !== 'ended') {
      const thumb = h('div.thumb');
      if (s.stream) { const v = h('video', { autoplay: true, muted: true, playsinline: true }); v.srcObject = s.stream; thumb.appendChild(v); }
      else thumb.appendChild(svg('monitorFill'));
      thumb.appendChild(h('span.dot', { class: s.state === 'connected' ? 'on' : 'warn' }));
      this.left.append(thumb, h('div.info',
        h('div.t', { onclick: () => this.navigate('/screen') }, `${state.hostName} 화면`),
        h('div.s', s.state === 'connected' ? (s.control ? [svg('mouse'), '제어 중'] : [svg('eye'), '보기 전용']) : s.state === 'pending' ? '승인 대기 중…' : '연결 중…')));
    } else {
      const online = state.agentOnline;
      this.left.append(
        h('div.thumb', svg('server'), h('span.dot', { class: online ? 'on' : (state.user && state.user.isHost ? 'warn' : 'off') })),
        h('div.info', h('div.t', { onclick: () => this.navigate('/settings') }, `macserver · ${state.hostName}`),
          h('div.s', online ? '화면 에이전트 온라인' : '화면 에이전트 오프라인', this.status && isAdmin() ? ` · 접속 ${(this.status.clients || []).filter((c) => c.role !== 'agent').length}명` : '')));
    }
  }
  renderCenter() {
    clear(this.center);
    const s = this.session;
    if (s && s.state !== 'idle' && s.state !== 'ended') {
      const connected = s.state === 'connected';
      this.center.appendChild(h('div.controls',
        h('button.icon-btn', { title: s.control ? '보기 전용으로 전환' : '제어 켜기', class: s.control ? 'active' : '', disabled: !s.canControl, onclick: () => s.toggleControl() }, svg('mouse')),
        h('button.icon-btn.main', { title: s.paused ? '재개' : '일시정지', onclick: () => s.togglePause() }, svg(s.paused ? 'play' : 'pause')),
        h('button.icon-btn', { title: '연결 끊기', onclick: () => s.stop('user') }, svg('stop')),
        h('button.icon-btn', { title: '전체 화면', onclick: () => { this.navigate('/screen'); setTimeout(() => s.requestFullscreen && s.requestFullscreen(), 50); } }, svg('fullscreen')),
      ));
      const st = this.stats || {};
      const dur = connected && s.connectedAt ? fmtDuration((Date.now() - s.connectedAt) / 1000) : '0:00';
      const pct = Math.min(100, ((st.bitrate || 0) / 8e6) * 100);
      this.center.appendChild(h('div.meter', h('span', dur), h('div.track', h('i', { style: { '--pct': pct + '%' } })), h('span', st.width ? `${st.width}×${st.height} · ${st.fps || 0}fps · ${fmtBitrate(st.bitrate)}${st.rtt != null ? ' · ' + Math.round(st.rtt * 1000) + 'ms' : ''}` : connected ? '통계 수집 중' : '—')));
    } else {
      const st = this.status;
      const sessions = st && Array.isArray(st.sessions) ? st.sessions : [];
      if (isAdmin() && st) {
        this.center.appendChild(h('div.controls',
          h('button.icon-btn', { title: st.sharingPaused ? '화면 공유 재개' : '화면 공유 일시정지', class: st.sharingPaused ? 'active' : '', onclick: () => this.wsSend({ type: 'host:toggle', sharingPaused: !st.sharingPaused }) }, svg(st.sharingPaused ? 'play' : 'pause')),
          h('button.icon-btn', { title: st.allowControl ? '원격 제어 허용됨 (끄기)' : '원격 제어 차단됨 (켜기)', class: st.allowControl ? 'active' : '', onclick: () => this.wsSend({ type: 'host:toggle', allowControl: !st.allowControl }) }, svg(st.allowControl ? 'unlock' : 'lock')),
          h('button.icon-btn', { title: '활동 로그', onclick: () => this.navigate('/activity') }, svg('activity')),
        ));
        this.center.appendChild(h('div.meter', h('span', sessions.length ? `${sessions.length}개 세션` : '세션 없음'), h('div.track', h('i', { style: { '--pct': (sessions.length ? 100 : 0) + '%' } })), h('span', st.sharingPaused ? '공유 일시정지' : st.allowControl ? '제어 허용' : '보기만 허용')));
      } else {
        this.center.appendChild(h('div.meter', h('span', { style: { color: 'var(--text-muted)' } }, state.agentOnline ? '화면 보기를 시작하려면 ▶ 를 누르세요' : '호스트 앱이 꺼져 있어요')));
      }
    }
  }
  renderRight() {
    clear(this.right);
    const s = this.session;
    if (s && s.state === 'connected') {
      const q = s.quality || 'auto';
      const slider = h('input.slider', { type: 'range', min: 0, max: 3, step: 1, value: ['low', 'auto', 'smooth', 'high'].indexOf(q), title: '화질', oninput: (e) => { s.setQuality(['low', 'auto', 'smooth', 'high'][Number(e.target.value)]); updatePct(); } });
      const updatePct = () => slider.style.setProperty('--pct', (Number(slider.value) / 3 * 100) + '%'); updatePct();
      this.right.append(
        h('button.icon-btn', { title: '텍스트 보내기', onclick: () => s.openSendText && s.openSendText() }, svg('text')),
        h('button.icon-btn', { title: '화면 패널', onclick: () => this.navigate('/screen') }, svg('monitor')),
        h('div.vol', svg('sliders'), slider),
      );
    } else {
      const sys = state.sysInfo;
      if (sys && sys.lan && sys.lan.length) {
        const addr = `${sys.https ? 'https' : 'http'}://${sys.lan[0].address}:${sys.port}`;
        this.right.appendChild(h('button.btn.ghost.sm', { title: '접속 주소 복사', onclick: () => copyText(addr).then(() => toast('접속 주소를 복사했어요')) }, svg('wifi'), h('span.mono', { style: { fontSize: '12px' } }, addr)));
      }
      this.right.appendChild(h('button.icon-btn', { title: '설정', onclick: () => this.navigate('/settings') }, svg('settings')));
    }
  }
}
