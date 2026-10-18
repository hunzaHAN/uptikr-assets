'use strict';
const express = require('express');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const mime = require('mime-types');
const archiver = require('archiver');
const fsops = require('./fsops');
const { HttpError, sanitizeName } = require('./util');

/**
 * 파일 서버 API (/api/files)
 *  GET  /shares                      접근 가능한 공유 목록
 *  GET  /list?share&path             폴더 목록
 *  GET  /stat?share&path             항목 정보
 *  GET  /download?share&path[&inline=1]   파일 다운로드 / 미리보기 (폴더면 zip)
 *  GET  /text?share&path             텍스트 미리보기 (최대 1MB)
 *  GET  /search?q[&share]            이름 검색
 *  PUT  /upload?share&path[&overwrite=1]  업로드 (raw body)
 *  POST /mkdir {share,path}
 *  POST /rename {share,path,name}
 *  POST /move {share,path,dest}
 *  POST /delete {share,paths:[]}
 */
function filesRouter(ctx) {
  const { auth, shares, accounts, audit, settings, hooks } = ctx;
  const r = express.Router();
  r.use(auth.required());

  function getShare(req, needWrite = false) {
    const sid = String(req.query.share || req.body?.share || '');
    const share = shares.byId(sid);
    if (!share) throw new HttpError(404, '공유를 찾을 수 없습니다.');
    const access = accounts.accessFor(req.account, share.id);
    if (access === 'none') throw new HttpError(403, '이 공유에 접근할 권한이 없습니다.');
    if (needWrite && access !== 'rw') throw new HttpError(403, '읽기 전용 공유입니다.');
    return { share, access };
  }
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  r.get('/shares', (req, res) => {
    res.json({ shares: shares.forAccount(req.account) });
  });

  r.get('/list', wrap(async (req, res) => {
    const { share, access } = getShare(req);
    const result = await fsops.list(share.path, req.query.path || '', { showHidden: req.query.hidden === '1' });
    res.json({ share: { id: share.id, name: share.name, access }, ...result });
  }));

  r.get('/stat', wrap(async (req, res) => {
    const { share } = getShare(req);
    const st = await fsops.stat(share.path, req.query.path || '');
    let summary;
    if (st.type === 'dir') summary = await fsops.dirSummary(st.abs);
    delete st.abs;
    res.json({ ...st, summary });
  }));

  r.get('/download', wrap(async (req, res) => {
    const { share } = getShare(req);
    const { abs, rel } = await fsops.resolveExisting(share.path, req.query.path || '');
    const st = await fsp.stat(abs);
    const name = path.basename(abs) || share.name;
    if (st.isDirectory()) {
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', contentDisposition(name + '.zip'));
      const archive = archiver('zip', { zlib: { level: 1 } });
      archive.on('error', (e) => { try { res.destroy(e); } catch (_) {} });
      archive.pipe(res);
      archive.directory(abs, name);
      audit.log('file.download', { user: req.account.username, share: share.name, path: rel || '/', zip: true });
      await archive.finalize();
      return;
    }
    const type = mime.lookup(name) || 'application/octet-stream';
    const inline = req.query.inline === '1';
    res.setHeader('Content-Disposition', contentDisposition(name, inline ? 'inline' : 'attachment'));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (!inline) audit.log('file.download', { user: req.account.username, share: share.name, path: rel, size: st.size });
    res.sendFile(abs, { headers: { 'Content-Type': type }, dotfiles: 'allow', acceptRanges: true, cacheControl: false, lastModified: true });
  }));

  r.get('/text', wrap(async (req, res) => {
    const { share } = getShare(req);
    const { abs } = await fsops.resolveExisting(share.path, req.query.path || '');
    const st = await fsp.stat(abs);
    if (!st.isFile()) throw new HttpError(400, '파일이 아닙니다.');
    const max = 1024 * 1024;
    const fh = await fsp.open(abs, 'r');
    try {
      const buf = Buffer.alloc(Math.min(max, st.size));
      await fh.read(buf, 0, buf.length, 0);
      res.json({ text: buf.toString('utf8'), truncated: st.size > max, size: st.size });
    } finally { await fh.close(); }
  }));

  r.get('/search', wrap(async (req, res) => {
    const q = String(req.query.q || '').trim();
    if (q.length < 1) return res.json({ results: [] });
    const list = req.query.share ? [getShare(req).share] : shares.forAccount(req.account).map((s) => shares.byId(s.id));
    const results = [];
    for (const share of list) {
      const items = await fsops.search(share.path, q, { maxResults: 150, deadlineMs: 2500 });
      for (const it of items) results.push({ ...it, share: { id: share.id, name: share.name, color: share.color } });
      if (results.length > 400) break;
    }
    res.json({ results });
  }));

  // 업로드: raw body 스트리밍 → 임시파일 → rename
  r.put('/upload', wrap(async (req, res) => {
    const { share } = getShare(req, true);
    const relPath = String(req.query.path || '');
    const parts = relPath.split('/').filter(Boolean);
    if (!parts.length) throw new HttpError(400, '파일 이름이 필요합니다.');
    const fileName = sanitizeName(parts.pop());
    if (!fileName) throw new HttpError(400, '잘못된 파일 이름입니다.');
    // 하위 폴더 자동 생성 (폴더 업로드)
    let dirRel = '';
    for (const seg of parts) {
      const safe = sanitizeName(seg); if (!safe) throw new HttpError(400, '잘못된 경로입니다.');
      dirRel = dirRel ? dirRel + '/' + safe : safe;
      try { await fsops.mkdir(share.path, dirRel); } catch (e) { if (e.status !== 409) throw e; }
    }
    const target = await fsops.resolveForCreate(share.path, dirRel ? dirRel + '/' + fileName : fileName);
    const overwrite = req.query.overwrite === '1';
    if (fs.existsSync(target.abs) && !overwrite) throw new HttpError(409, '같은 이름의 파일이 이미 있습니다.', { code: 'EXISTS' });
    const maxBytes = (settings().maxUploadMB || 20480) * 1024 * 1024;
    const len = Number(req.headers['content-length'] || 0);
    if (len > maxBytes) throw new HttpError(413, '업로드 용량 제한을 초과했습니다.');
    const tmp = path.join(target.parentAbs, `.${fileName}.uploading-${process.pid}-${Date.now()}`);
    let received = 0;
    await new Promise((resolve, reject) => {
      const ws = fs.createWriteStream(tmp, { flags: 'wx' });
      req.on('data', (chunk) => { received += chunk.length; if (received > maxBytes) { req.destroy(new HttpError(413, '업로드 용량 제한을 초과했습니다.')); } });
      req.on('error', reject);
      req.on('aborted', () => reject(new HttpError(400, '업로드가 중단되었습니다.')));
      ws.on('error', reject);
      ws.on('finish', resolve);
      req.pipe(ws);
    }).catch(async (e) => { try { await fsp.rm(tmp, { force: true }); } catch (_) {} throw e; });
    await fsp.rename(tmp, target.abs);
    if (req.query.mtime) { const m = Number(req.query.mtime); if (m > 0) { try { await fsp.utimes(target.abs, new Date(), new Date(m)); } catch (_) {} } }
    const st = await fsp.stat(target.abs);
    audit.log('file.upload', { user: req.account.username, share: share.name, path: target.rel, size: st.size });
    res.json({ ok: true, entry: fsops.entryFromStat(fileName, st, target.rel) });
  }));

  r.post('/mkdir', wrap(async (req, res) => {
    const { share } = getShare(req, true);
    const base = fsops.normalizeRel(req.body.path || '');
    const name = sanitizeName(req.body.name);
    if (!name) throw new HttpError(400, '폴더 이름이 올바르지 않습니다.');
    const t = await fsops.mkdir(share.path, base ? base + '/' + name : name);
    audit.log('file.mkdir', { user: req.account.username, share: share.name, path: t.rel });
    res.json({ ok: true, path: t.rel });
  }));

  r.post('/rename', wrap(async (req, res) => {
    const { share } = getShare(req, true);
    const out = await fsops.rename(share.path, req.body.path, req.body.name);
    audit.log('file.rename', { user: req.account.username, share: share.name, from: req.body.path, to: out.rel });
    res.json({ ok: true, path: out.rel });
  }));

  r.post('/move', wrap(async (req, res) => {
    const { share } = getShare(req, true);
    const paths = Array.isArray(req.body.paths) ? req.body.paths : [req.body.path];
    const moved = [];
    for (const p of paths) { const out = await fsops.move(share.path, p, req.body.dest || ''); moved.push(out.rel); }
    audit.log('file.move', { user: req.account.username, share: share.name, count: moved.length, dest: req.body.dest || '/' });
    res.json({ ok: true, moved });
  }));

  r.post('/delete', wrap(async (req, res) => {
    const { share } = getShare(req, true);
    const paths = Array.isArray(req.body.paths) ? req.body.paths : [req.body.path];
    const results = [];
    const useTrash = settings().allowDeleteToTrash && hooks && hooks.trash;
    for (const p of paths) {
      const out = await fsops.remove(share.path, p, { trash: useTrash ? hooks.trash : null });
      results.push({ path: p, ...out });
    }
    audit.log('file.delete', { user: req.account.username, share: share.name, count: results.length, paths: paths.slice(0, 5) });
    res.json({ ok: true, results });
  }));

  return r;
}

function contentDisposition(filename, type = 'attachment') {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, "'");
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename).replace(/['()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())}`;
}

module.exports = { filesRouter, contentDisposition };
