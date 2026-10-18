// 전역 상태 + 이벤트 버스
const listeners = new Map();
export const state = {
  info: null,         // /api/info
  user: null,         // 로그인 사용자
  hostName: 'macserver',
  shares: [],         // 접근 가능한 공유
  status: null,       // 허브 status 스냅샷
  agentOnline: false,
  shortcuts: [],
  isElectron: !!(window.macserver && window.macserver.isElectron),
  viewer: null,       // 현재 화면 세션 (ScreenSession 인스턴스)
  sysInfo: null,
};
export function on(evt, fn) { if (!listeners.has(evt)) listeners.set(evt, new Set()); listeners.get(evt).add(fn); return () => listeners.get(evt).delete(fn); }
export function emit(evt, data) { const set = listeners.get(evt); if (set) for (const fn of [...set]) { try { fn(data); } catch (e) { console.error(e); } } }
export function set(patch) { Object.assign(state, patch); emit('change', patch); }
export const isAdmin = () => !!(state.user && state.user.isAdmin);
export const isHost = () => !!(state.user && state.user.isHost);
