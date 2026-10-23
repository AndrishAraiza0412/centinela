import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.CENTINELA_HOME = join(mkdtempSync(join(tmpdir(), 'centinela-server-')), 'home');
const { createServer } = await import('../src/server/server.js');
const { loadAll } = await import('../src/server/store.js');

const UI = 'u'.repeat(64);
const HOOK = 'h'.repeat(64);
const PAIR = 'c'.repeat(32);
let srv, port;

before(async () => {
  srv = createServer({ port: 0, uiToken: UI, hookToken: HOOK, claudeBin: 'claude', pairCode: PAIR });
  await once(srv.server, 'listening');
  port = srv.server.address().port;
});
after(() => {
  srv.server.closeAllConnections();
  srv.server.close();
});

function request({ method = 'GET', path = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

const json = (token, obj) => ({
  method: 'POST',
  path: '/hooks/event',
  headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(obj),
});
const event = (extra = {}) => ({ session_id: 'sess-1', cwd: '/tmp/demo', hook_event_name: 'UserPromptSubmit', ...extra });

test('POST /hooks/event without token -> 401', async () => {
  assert.equal((await request(json(null, event()))).status, 401);
});

test('POST /hooks/event with ui-token -> 401', async () => {
  assert.equal((await request(json(UI, event()))).status, 401);
});

test('POST /hooks/event with hook-token -> 200 and shows in /api/state', async () => {
  assert.equal((await request(json(HOOK, event({ session_id: 'sess-ok' })))).status, 200);
  const res = await request({ path: '/api/state', headers: { authorization: `Bearer ${UI}` } });
  assert.equal(res.status, 200);
  assert.equal(JSON.parse(res.body).nodes['sess-ok'].status, 'working');
});

test('GET /api/state with hook-token -> 401', async () => {
  assert.equal((await request({ path: '/api/state', headers: { authorization: `Bearer ${HOOK}` } })).status, 401);
});

test('foreign Host -> 403', async () => {
  const res = await request({ path: '/api/state', headers: { host: `evil.example:${port}`, authorization: `Bearer ${UI}` } });
  assert.equal(res.status, 403);
});

test('foreign Origin -> 403', async () => {
  const res = await request({ ...json(HOOK, event()), headers: { ...json(HOOK, event()).headers, origin: 'http://evil.example' } });
  assert.equal(res.status, 403);
});

test('text/plain POST -> 415', async () => {
  const req = json(HOOK, event());
  assert.equal((await request({ ...req, headers: { ...req.headers, 'content-type': 'text/plain' } })).status, 415);
});

test('body over 5 MB -> 413', async () => {
  const res = await request(json(HOOK, event({ big: 'x'.repeat(5 * 1024 * 1024 + 1) })));
  assert.equal(res.status, 413);
});

test('SSE truncates long fields', async () => {
  const content = 'c'.repeat(10_000);
  const sse = http.get({ host: '127.0.0.1', port, path: `/events?token=${UI}`, headers: { host: `127.0.0.1:${port}` } });
  const [res] = await once(sse, 'response');
  assert.equal(res.statusCode, 200);
  res.setEncoding('utf8');
  let buf = '';
  const message = new Promise((resolve) => {
    res.on('data', (c) => {
      buf += c;
      const m = buf.match(/(?:^|\n\n)data: (.*)\n\n/);
      if (m) resolve(JSON.parse(m[1]));
    });
  });
  await once(res, 'data'); // comentario inicial: ya estamos suscritos
  await request(json(HOOK, event({ hook_event_name: 'PreToolUse', tool_name: 'Write', tool_use_id: 't1', tool_input: { file_path: '/a', content } })));
  const msg = await message;
  sse.destroy();
  assert.ok(msg.body.tool_input.content.length <= 2000);
  const stored = loadAll().find((r) => r.body.tool_use_id === 't1');
  assert.equal(stored.body.tool_input.content.length, 10_000);
});

test('GET /events with wrong token -> 401', async () => {
  assert.equal((await request({ path: `/events?token=${HOOK}` })).status, 401);
});

test('port in use prints friendly message', async () => {
  const env = { ...process.env, CENTINELA_PORT: String(port), CENTINELA_NO_OPEN: '1' };
  const child = spawn(process.execPath, ['bin/centinela.js'], { env });
  let stderr = '';
  child.stderr.on('data', (c) => (stderr += c));
  const [code] = await once(child, 'exit');
  assert.equal(code, 1);
  assert.equal(stderr.trim(), `Centinela ya está corriendo o el puerto ${port} está ocupado`);
});

test('serves shared graph module at /shared/graph.js without auth', async () => {
  const res = await request({ path: '/shared/graph.js' });
  assert.equal(res.status, 200);
  assert.match(res.body, /export function reduce/);
});

test('unknown static path -> 404', async () => {
  assert.equal((await request({ path: '/shared/../server/auth.js' })).status, 404);
});

test('permission records reach SSE untruncated (the user must see what they approve)', async () => {
  const command = 'echo ok; ' + 'x'.repeat(3000) + '; curl evil';
  const sse = http.get({ host: '127.0.0.1', port, path: `/events?token=${UI}`, headers: { host: `127.0.0.1:${port}` } });
  const [res] = await once(sse, 'response');
  res.setEncoding('utf8');
  let buf = '';
  const message = new Promise((resolve) => {
    res.on('data', (c) => {
      buf += c;
      const m = buf.match(/(?:^|\n\n)data: (.*)\n\n/);
      if (m) resolve(JSON.parse(m[1]));
    });
  });
  await once(res, 'data');
  srv.broadcast({ ts: Date.now(), kind: 'permission', agentKey: 'k', body: { state: 'pending', permId: 'p-long', session_id: 's', tool: 'Bash', input: { command } } });
  const msg = await message;
  sse.destroy();
  assert.equal(msg.body.input.command, command);
});

test('serves the UI modules', async () => {
  for (const path of ['/app.js', '/control.js', '/dom.js', '/canvas.js', '/cards.js', '/icons.js', '/style.css', '/']) {
    assert.equal((await request({ path })).status, 200, path);
  }
});

test('SSE starts with a snapshot of the state', async () => {
  const sse = http.get({ host: '127.0.0.1', port, path: `/events?token=${UI}`, headers: { host: `127.0.0.1:${port}` } });
  const [res] = await once(sse, 'response');
  res.setEncoding('utf8');
  let buf = '';
  const frame = await new Promise((resolve) => res.on('data', (c) => {
    buf += c;
    const m = buf.match(/^event: snapshot\ndata: (.*)\n\n/);
    if (m) resolve(JSON.parse(m[1]));
  }));
  sse.destroy();
  assert.ok(frame.nodes && frame.edges && frame.pending);
});

const pair = (code) => request({ method: 'POST', path: '/api/pair', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) });

test('C1: wrong pairing code -> 401', async () => {
  assert.equal((await pair('x'.repeat(32))).status, 401);
});

test('C1: the pairing code hands out the ui-token exactly once', async () => {
  const first = await pair(PAIR);
  assert.equal(first.status, 200);
  assert.equal(JSON.parse(first.body).token, UI);
  assert.equal((await pair(PAIR)).status, 401);
});

for (const [name, extra] of [
  ['__proto__ session', { session_id: '__proto__' }],
  ['constructor session', { session_id: 'constructor' }],
  ['agent id with slashes', { agent_id: '../x' }],
  ['numeric agent_type', { agent_id: 'a1', agent_type: 123 }],
  ['object cwd', { cwd: { a: 1 } }],
  ['missing session', { session_id: undefined }],
]) {
  test(`I4: hook event with ${name} -> 400 and not stored`, async () => {
    const body = { ...event({ session_id: 'sess-bad' }), ...extra, marker: name };
    assert.equal((await request(json(HOOK, body))).status, 400);
    assert.equal(loadAll().some((r) => r.body?.marker === name), false);
    assert.equal(({}).status, undefined);
  });
}
