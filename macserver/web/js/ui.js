// DOM 헬퍼 + 공용 UI 컴포넌트 (토스트, 모달, 컨텍스트 메뉴, 포맷터)
import { icon } from './icons.js';

/** h('div.cls#id', {attrs}, ...children) */
export function h(tag, props, ...children) {
  if (props && (props instanceof Node || typeof props !== 'object' || Array.isArray(props))) { children.unshift(props); props = null; }
  const m = tag.match(/^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i);
  const el = document.createElement((m && m[1]) || 'div');
  if (m && m[2]) for (const part of m[2].match(/[.#][\w-]+/g) || []) { if (part[0] === '.') el.classList.add(part.slice(1)); else el.id = part.slice(1); }
  if (props) for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class' || k === 'className') { for (const c of String(v).split(/\s+/)) if (c) el.classList.add(c); }
    else if (k === 'style' && typeof v === 'object') { for (const [sk, sv] of Object.entries(v)) { if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv; } }
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k in el && typeof v !== 'string' && k !== 'list') { try { el[k] = v; } catch (_) { el.setAttribute(k, v); } }
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}
function append(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}
export function svg(name, cls) { const s = document.createElement('span'); s.innerHTML = icon(name); const e = s.firstElementChild; if (cls) e.classList.add(cls); return e; }
export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
export const qs = (sel, root = document) => root.querySelector(sel);

// ---------- 포맷 ----------
export function fmtSize(bytes) {
  if (bytes == null) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; let n = Number(bytes);
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return (i === 0 ? n : n.toFixed(n >= 100 ? 0 : 1)) + ' ' + u[i];
}
export function fmtDate(ts, { relative = true } = {}) {
  if (!ts) return '—';
  const d = new Date(ts); const now = Date.now(); const diff = now - d.getTime();
  if (relative) {
    if (diff < 60000) return '방금 전';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}분 전`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}시간 전`;
    if (diff < 7 * 86400000) return `${Math.floor(diff / 86400000)}일 전`;
  }
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
export function fmtDateTime(ts) { if (!ts) return '—'; return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
export function fmtDuration(sec) { sec = Math.max(0, Math.floor(sec)); const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60; return (h ? h + ':' : '') + String(m).padStart(h ? 2 : 1, '0') + ':' + String(s).padStart(2, '0'); }
export function fmtBitrate(bps) { if (!bps) return '0 kbps'; return bps >= 1e6 ? (bps / 1e6).toFixed(1) + ' Mbps' : Math.round(bps / 1e3) + ' kbps'; }

const AVATAR_COLORS = ['#1db954', '#e8115b', '#8d67ab', '#0d73ec', '#ba5d07', '#148a08', '#e91429', '#f59b23', '#509bf5', '#dc148c', '#477d95', '#1e3264'];
export function avatarColor(name) { let hsh = 0; for (const c of String(name || '')) hsh = (hsh * 31 + c.charCodeAt(0)) >>> 0; return AVATAR_COLORS[hsh % AVATAR_COLORS.length]; }
export function initials(name) { const s = String(name || '?').trim(); return s ? s[0].toUpperCase() : '?'; }
export function avatar(name, cls = '') { return h('span.avatar', { class: cls, style: { background: avatarColor(name) } }, initials(name)); }

// 파일 종류
const EXT = {
  img: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'bmp', 'svg', 'tiff', 'tif', 'avif', 'ico', 'raw', 'dng', 'cr2', 'arw'],
  vid: ['mp4', 'mov', 'm4v', 'mkv', 'avi', 'webm', 'wmv', 'flv', 'mpg', 'mpeg', 'ts'],
  aud: ['mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'aiff', 'aif', 'wma', 'opus'],
  doc: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'key', 'pages', 'numbers', 'txt', 'md', 'rtf', 'csv', 'hwp', 'epub'],
  code: ['js', 'ts', 'jsx', 'tsx', 'json', 'html', 'css', 'scss', 'py', 'rb', 'go', 'rs', 'swift', 'java', 'kt', 'c', 'cpp', 'h', 'm', 'sh', 'yml', 'yaml', 'toml', 'xml', 'sql', 'php'],
  arc: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'dmg', 'pkg', 'iso'],
};
export function fileKind(entry) {
  if (entry.type === 'dir') return 'dir';
  const e = (entry.ext || '').toLowerCase();
  for (const [k, list] of Object.entries(EXT)) if (list.includes(e)) return k;
  return 'file';
}
export const kindIcon = { dir: 'folderFill', img: 'image', vid: 'video', aud: 'music', doc: 'doc', code: 'code', arc: 'archive', file: 'file' };
export const kindLabel = { dir: '폴더', img: '이미지', vid: '비디오', aud: '오디오', doc: '문서', code: '코드', arc: '압축 파일', file: '파일' };
export function isTextExt(ext) { return [...EXT.code, 'txt', 'md', 'log', 'csv', 'ini', 'conf', 'env', 'gitignore', 'plist', 'srt'].includes((ext || '').toLowerCase()); }

// ---------- 토스트 ----------
let toastRoot;
export function toast(msg, kind = '', ms = 2800) {
  if (!toastRoot) { toastRoot = h('div.toasts'); document.body.appendChild(toastRoot); }
  const el = h('div.toast', { class: kind }, msg);
  toastRoot.appendChild(el);
  setTimeout(() => { el.style.transition = 'opacity .3s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, ms);
  return el;
}

// ---------- 모달 ----------
export function modal({ title, body, footer, size = '', onClose, closable = true }) {
  const bd = h('div.backdrop');
  const closeBtn = closable ? h('button.icon-btn.ghost', { 'aria-label': '닫기', onclick: () => close() }, svg('close')) : null;
  const m = h('div.modal', { class: size, role: 'dialog', 'aria-modal': 'true' },
    h('div.mh', h('h2', title), closeBtn),
    h('div.mb', body),
    footer ? h('div.mf', footer) : null,
  );
  bd.appendChild(m);
  function close(result) { if (!bd.isConnected) return; bd.remove(); document.removeEventListener('keydown', onKey); if (onClose) onClose(result); }
  function onKey(e) { if (e.key === 'Escape' && closable) { e.stopPropagation(); close(); } }
  bd.addEventListener('mousedown', (e) => { if (e.target === bd && closable) close(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(bd);
  const first = m.querySelector('input, select, textarea, button.primary'); if (first) setTimeout(() => first.focus(), 30);
  return { close, el: m, backdrop: bd };
}
export function confirmDialog({ title, message, okText = '확인', danger = false, cancelText = '취소' }) {
  return new Promise((resolve) => {
    const dlg = modal({
      title, body: h('p.desc', message), onClose: (r) => resolve(!!r),
      footer: [h('button.btn.ghost', { onclick: () => dlg.close(false) }, cancelText), h('button.btn', { class: danger ? 'danger' : 'primary', onclick: () => dlg.close(true) }, okText)],
    });
  });
}
export function promptDialog({ title, label, value = '', placeholder = '', okText = '확인', validate }) {
  return new Promise((resolve) => {
    const input = h('input.input', { value, placeholder, onkeydown: (e) => { if (e.key === 'Enter') submit(); } });
    const err = h('div.error');
    const dlg = modal({ title, body: h('div.field', label ? h('label', label) : null, input, err), onClose: (r) => resolve(r == null ? null : r),
      footer: [h('button.btn.ghost', { onclick: () => dlg.close(null) }, '취소'), h('button.btn.primary', { onclick: () => submit() }, okText)] });
    function submit() { const v = input.value.trim(); const msg = validate ? validate(v) : (v ? null : '값을 입력하세요.'); if (msg) { err.textContent = msg; input.focus(); return; } dlg.close(v); }
    setTimeout(() => { input.focus(); input.select(); }, 30);
  });
}

// ---------- 컨텍스트 메뉴 ----------
let openMenu = null;
export function contextMenu(items, { x, y, anchor } = {}) {
  closeMenu();
  const menu = h('div.menu', { role: 'menu' });
  for (const it of items) {
    if (!it) continue;
    if (it === '-' || it.sep) { menu.appendChild(h('div.sep')); continue; }
    if (it.head) { menu.appendChild(h('div.mi.head', it.head)); continue; }
    const b = h('button', { class: it.danger ? 'danger' : '', disabled: !!it.disabled, onclick: (e) => { e.stopPropagation(); closeMenu(); it.onClick && it.onClick(); } }, it.icon ? svg(it.icon) : null, it.label, it.kbd ? h('span.kbd', it.kbd) : null);
    menu.appendChild(b);
  }
  document.body.appendChild(menu);
  let px = x, py = y;
  if (anchor) { const r = anchor.getBoundingClientRect(); px = r.right - menu.offsetWidth; py = r.bottom + 4; }
  const vw = window.innerWidth, vh = window.innerHeight; const mw = menu.offsetWidth, mh = menu.offsetHeight;
  if (px + mw > vw - 8) px = Math.max(8, vw - mw - 8);
  if (py + mh > vh - 8) py = Math.max(8, (anchor ? anchor.getBoundingClientRect().top - mh - 4 : vh - mh - 8));
  menu.style.left = px + 'px'; menu.style.top = py + 'px';
  openMenu = menu;
  const off = (e) => { if (!menu.contains(e.target)) closeMenu(); };
  setTimeout(() => { document.addEventListener('mousedown', off, { once: true }); document.addEventListener('contextmenu', off, { once: true }); window.addEventListener('blur', closeMenu, { once: true }); window.addEventListener('resize', closeMenu, { once: true }); document.addEventListener('keydown', escClose); }, 0);
  function escClose(e) { if (e.key === 'Escape') closeMenu(); }
  menu._cleanup = () => document.removeEventListener('keydown', escClose);
  return menu;
}
export function closeMenu() { if (openMenu) { openMenu._cleanup && openMenu._cleanup(); openMenu.remove(); openMenu = null; } }

// ---------- 기타 ----------
export function toggle(on, onChange, { large = false, disabled = false } = {}) {
  const b = h('button.toggle', { class: (on ? 'on ' : '') + (large ? 'lg' : ''), role: 'switch', 'aria-checked': String(!!on), disabled, onclick: () => { const next = !b.classList.contains('on'); b.classList.toggle('on', next); b.setAttribute('aria-checked', String(next)); onChange && onChange(next, b); } });
  b.set = (v) => { b.classList.toggle('on', !!v); b.setAttribute('aria-checked', String(!!v)); };
  return b;
}
export function segment(options, value, onChange) {
  const wrap = h('div.segment');
  const render = () => { clear(wrap); for (const o of options) wrap.appendChild(h('button', { class: (o.value === value ? 'active ' : '') + (o.cls || o.value), onclick: () => { value = o.value; render(); onChange && onChange(value); } }, o.label)); };
  render(); wrap.get = () => value; wrap.set = (v) => { value = v; render(); };
  return wrap;
}
export function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text).then(() => true).catch(() => fallbackCopy(text));
  return Promise.resolve(fallbackCopy(text));
}
function fallbackCopy(text) { const ta = h('textarea', { value: text, style: { position: 'fixed', opacity: 0 } }); document.body.appendChild(ta); ta.select(); let ok = false; try { ok = document.execCommand('copy'); } catch (_) {} ta.remove(); return ok; }
export function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
export function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
export function greeting() { const hr = new Date().getHours(); if (hr < 5) return 'greetingNight'; if (hr < 12) return 'greetingMorning'; if (hr < 18) return 'greetingDay'; return 'greetingEvening'; }
export function gradientFor(color) { return `linear-gradient(135deg, ${color} 0%, ${shade(color, -35)} 100%)`; }
export function shade(hex, pct) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '#535353'); if (!m) return hex;
  const f = (v) => Math.max(0, Math.min(255, Math.round(parseInt(v, 16) * (1 + pct / 100))));
  return `rgb(${f(m[1])}, ${f(m[2])}, ${f(m[3])})`;
}
