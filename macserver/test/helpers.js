'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createMacServer } = require('../server/index');

async function startTestServer(extra = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'macserver-test-'));
  const shareDir = fs.mkdtempSync(path.join(os.tmpdir(), 'macserver-share-'));
  fs.writeFileSync(path.join(shareDir, 'hello.txt'), 'hello world');
  fs.mkdirSync(path.join(shareDir, 'sub'));
  fs.writeFileSync(path.join(shareDir, 'sub', 'nested.md'), '# nested');
  const srv = await createMacServer({ dataDir, port: 0, bind: '127.0.0.1', ...extra });
  const base = srv.urls().local;
  const api = makeClient(base);
  return {
    srv, base, dataDir, shareDir, api,
    async stop() { await srv.shutdown(); fs.rmSync(dataDir, { recursive: true, force: true }); fs.rmSync(shareDir, { recursive: true, force: true }); },
  };
}

function makeClient(base) {
  let token = null;
  const call = async (method, url, body, opts = {}) => {
    const headers = { 'X-MacServer': '1', ...(opts.headers || {}) };
    if (token && !opts.noAuth) headers.Authorization = 'Bearer ' + token;
    let payload = body;
    if (body !== undefined && !(body instanceof Buffer) && typeof body !== 'string') { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(base + url, { method, headers, body: payload, redirect: 'manual' });
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('application/json') ? await res.json() : await res.arrayBuffer();
    return { status: res.status, data, headers: res.headers };
  };
  return {
    setToken(t) { token = t; }, get token() { return token; },
    get: (u, o) => call('GET', u, undefined, o), post: (u, b, o) => call('POST', u, b, o), put: (u, b, o) => call('PUT', u, b, o), del: (u, o) => call('DELETE', u, undefined, o),
  };
}

module.exports = { startTestServer, makeClient };
