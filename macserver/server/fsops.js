'use strict';
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { HttpError, sanitizeName } = require('./util');

/**
 * 공유 루트 안에서만 동작하는 안전한 파일 시스템 연산.
 * - 모든 상대 경로를 정규화하고 realpath 가 공유 루트 안에 있는지 검증 (심볼릭 링크 탈출 방지)
 */

function normalizeRel(rel) {
  let r = String(rel || '').replace(/\\/g, '/').normalize('NFC');
  const parts = [];
  for (const seg of r.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') throw new HttpError(400, '잘못된 경로입니다.');
    if (/[\0]/.test(seg)) throw new HttpError(400, '잘못된 경로입니다.');
    parts.push(seg);
  }
  return parts.join('/');
}

function insideRoot(root, abs) {
  const r = root.endsWith(path.sep) ? root : root + path.sep;
  return abs === root || abs.startsWith(r);
}

/**
 * 공유 루트 + 상대 경로 → 절대 경로 (존재해야 함, realpath 검증)
 */
async function resolveExisting(root, rel) {
  const r = normalizeRel(rel);
  const abs = path.join(root, r);
  if (!insideRoot(root, abs)) throw new HttpError(400, '잘못된 경로입니다.');
  let real;
  try { real = await fsp.realpath(abs); } catch (e) { if (e.code === 'ENOENT') throw new HttpError(404, '파일 또는 폴더가 없습니다.'); throw e; }
  if (!insideRoot(root, real)) throw new HttpError(403, '공유 폴더 밖의 경로는 접근할 수 없습니다.');
  return { rel: r, abs: real };
}

/**
 * 생성용: 부모는 존재해야 하고 (realpath 검증), 대상은 없어도 됨
 */
async function resolveForCreate(root, rel) {
  const r = normalizeRel(rel);
  if (!r) throw new HttpError(400, '이름이 필요합니다.');
  const parentRel = path.posix.dirname(r);
  const name = sanitizeName(path.posix.basename(r));
  if (!name) throw new HttpError(400, '잘못된 이름입니다.');
  const parent = await resolveExisting(root, parentRel === '.' ? '' : parentRel);
  const st = await fsp.stat(parent.abs);
  if (!st.isDirectory()) throw new HttpError(400, '상위 경로가 폴더가 아닙니다.');
  return { rel: r, abs: path.join(parent.abs, name), name, parentAbs: parent.abs };
}

function entryFromStat(name, st, rel) {
  return {
    name,
    path: rel,
    type: st.isDirectory() ? 'dir' : st.isSymbolicLink() ? 'link' : 'file',
    size: st.isDirectory() ? null : st.size,
    mtime: st.mtimeMs,
    ctime: st.birthtimeMs || st.ctimeMs,
    ext: st.isDirectory() ? '' : path.extname(name).slice(1).toLowerCase(),
  };
}

async function list(root, rel, { showHidden = false } = {}) {
  const { rel: r, abs } = await resolveExisting(root, rel);
  const st = await fsp.stat(abs);
  if (!st.isDirectory()) throw new HttpError(400, '폴더가 아닙니다.');
  const names = await fsp.readdir(abs);
  const entries = [];
  await Promise.all(names.map(async (name) => {
    if (!showHidden && (name.startsWith('.') || name === 'Icon\r')) return;
    try {
      const s = await fsp.stat(path.join(abs, name));
      entries.push(entryFromStat(name, s, r ? r + '/' + name : name));
    } catch (_) { /* 깨진 링크 등 무시 */ }
  }));
  entries.sort((a, b) => (a.type === 'dir') === (b.type === 'dir') ? a.name.localeCompare(b.name, 'ko', { numeric: true, sensitivity: 'base' }) : a.type === 'dir' ? -1 : 1);
  return { path: r, entries };
}

async function stat(root, rel) {
  const { rel: r, abs } = await resolveExisting(root, rel);
  const st = await fsp.stat(abs);
  return { ...entryFromStat(path.basename(abs) || path.basename(root), st, r), abs };
}

async function mkdir(root, rel) {
  const t = await resolveForCreate(root, rel);
  try { await fsp.mkdir(t.abs); } catch (e) { if (e.code === 'EEXIST') throw new HttpError(409, '이미 존재합니다.'); throw e; }
  return t;
}

async function rename(root, rel, newName) {
  const src = await resolveExisting(root, rel);
  if (src.abs === root) throw new HttpError(400, '공유 루트는 이름을 바꿀 수 없습니다.');
  const name = sanitizeName(newName);
  if (!name) throw new HttpError(400, '잘못된 이름입니다.');
  const dst = path.join(path.dirname(src.abs), name);
  if (!insideRoot(root, dst)) throw new HttpError(400, '잘못된 경로입니다.');
  if (fs.existsSync(dst) && dst !== src.abs) throw new HttpError(409, '같은 이름이 이미 존재합니다.');
  await fsp.rename(src.abs, dst);
  const parentRel = path.posix.dirname(src.rel);
  return { rel: (parentRel === '.' ? '' : parentRel + '/') + name, abs: dst };
}

/** 이동 (같은 공유 내) */
async function move(root, rel, destDirRel) {
  const src = await resolveExisting(root, rel);
  if (src.abs === root) throw new HttpError(400, '공유 루트는 이동할 수 없습니다.');
  const dstDir = await resolveExisting(root, destDirRel);
  const dst = path.join(dstDir.abs, path.basename(src.abs));
  if (dst === src.abs) return { rel: src.rel, abs: src.abs };
  if (insideRoot(src.abs, dst)) throw new HttpError(400, '폴더를 자기 자신 안으로 이동할 수 없습니다.');
  if (fs.existsSync(dst)) throw new HttpError(409, '대상에 같은 이름이 이미 존재합니다.');
  await fsp.rename(src.abs, dst);
  return { rel: (dstDir.rel ? dstDir.rel + '/' : '') + path.basename(dst), abs: dst };
}

async function remove(root, rel, { trash } = {}) {
  const t = await resolveExisting(root, rel);
  if (t.abs === root) throw new HttpError(400, '공유 루트는 삭제할 수 없습니다.');
  if (trash) {
    try { const ok = await trash(t.abs); if (ok !== false) return { trashed: true }; } catch (_) { /* fallthrough */ }
  }
  await fsp.rm(t.abs, { recursive: true, force: false });
  return { trashed: false };
}

/** 디렉터리 전체 크기/개수 (제한 있음) */
async function dirSummary(abs, { maxEntries = 20000, deadlineMs = 3000 } = {}) {
  let files = 0, dirs = 0, bytes = 0, truncated = false;
  const start = Date.now();
  const stack = [abs];
  while (stack.length) {
    if (files + dirs > maxEntries || Date.now() - start > deadlineMs) { truncated = true; break; }
    const d = stack.pop();
    let names; try { names = await fsp.readdir(d, { withFileTypes: true }); } catch (_) { continue; }
    for (const de of names) {
      const p = path.join(d, de.name);
      if (de.isDirectory()) { dirs++; stack.push(p); }
      else if (de.isFile()) { files++; try { bytes += (await fsp.stat(p)).size; } catch (_) {} }
    }
  }
  return { files, dirs, bytes, truncated };
}

/** 이름 검색 (제한 있음) */
async function search(root, query, { maxResults = 300, deadlineMs = 4000, showHidden = false } = {}) {
  const q = String(query || '').normalize('NFC').toLowerCase();
  if (!q) return [];
  const out = [];
  const start = Date.now();
  const stack = [{ abs: root, rel: '' }];
  while (stack.length && out.length < maxResults && Date.now() - start < deadlineMs) {
    const { abs, rel } = stack.pop();
    let names; try { names = await fsp.readdir(abs, { withFileTypes: true }); } catch (_) { continue; }
    for (const de of names) {
      if (!showHidden && de.name.startsWith('.')) continue;
      const r = rel ? rel + '/' + de.name : de.name;
      if (de.name.normalize('NFC').toLowerCase().includes(q)) {
        try { out.push(entryFromStat(de.name, await fsp.stat(path.join(abs, de.name)), r)); } catch (_) {}
        if (out.length >= maxResults) break;
      }
      if (de.isDirectory()) stack.push({ abs: path.join(abs, de.name), rel: r });
    }
  }
  return out;
}

module.exports = { normalizeRel, insideRoot, resolveExisting, resolveForCreate, list, stat, mkdir, rename, move, remove, dirSummary, search, entryFromStat };
