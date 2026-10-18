// 아주 작은 히스토리 라우터
const routes = [];
let current = null;
const listeners = new Set();

export function route(pattern, handler) { routes.push({ pattern, re: toRe(pattern), handler }); }
function toRe(p) { return new RegExp('^' + p.replace(/\//g, '\\/').replace(/:(\w+)/g, '(?<$1>[^/]+)').replace(/\*/g, '(?<rest>.*)') + '$'); }

export function navigate(path, { replace = false, state = null } = {}) {
  if (replace) history.replaceState(state, '', path); else history.pushState(state, '', path);
  dispatch();
}
export function back() { history.back(); }
export function forward() { history.forward(); }
export function currentPath() { return location.pathname + location.search; }
export function onRoute(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function dispatch() {
  const path = location.pathname;
  for (const r of routes) {
    const m = r.re.exec(path);
    if (m) { current = { path, params: decodeParams(m.groups || {}), query: Object.fromEntries(new URLSearchParams(location.search)) }; r.handler(current); for (const l of listeners) l(current); return; }
  }
  if (routes.length) { const fb = routes.find((r) => r.pattern === '*'); if (fb) { current = { path, params: {}, query: {} }; fb.handler(current); for (const l of listeners) l(current); } }
}
function decodeParams(p) { const o = {}; for (const [k, v] of Object.entries(p)) o[k] = v == null ? v : decodeURIComponent(v); return o; }
export function startRouter() { window.addEventListener('popstate', dispatch); dispatch(); }
export function getCurrent() { return current; }
