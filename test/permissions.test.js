import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const tmp = mkdtempSync(join(tmpdir(), 'centinela-perm-'));
process.env.CENTINELA_HOME = join(tmp, 'home');
process.env.CLAUDE_CONFIG_DIR = join(tmp, 'config');
process.env.CENTINELA_PERMISSION_TIMEOUT_MS = '300';
const project = join(tmp, 'project');
mkdirSync(join(project, '.claude/agents'), { recursive: true });
writeFileSync(join(project, '.claude/agents/tester.md'), '---\nname: tester\ndescription: t\n---\n');
const FAKE = fileURLToPath(new URL('./fake-claude.mjs', import.meta.url));
chmodSync(FAKE, 0o755);

const { createServer } = await import('../src/server/server.js');
const { loadAll } = await import('../src/server/store.js');

const UI = 'u'.repeat(64);
const HOOK = 'h'.repeat(64);
let srv, port;
const agents = [];
before(async () => {
  srv = createServer({ port: 0, uiToken: UI, hookToken: HOOK, claudeBin: FAKE });
  await once(srv.server, 'listening');
  port = srv.server.address().port;
});
after(() => {
  for (const { agentKey } of agents) srv.launcher.stop(agentKey);
  srv.server.closeAllConnections();
  srv.server.close();
});

function launch() {
  const a = srv.launcher.launch({ role: 'tester', cwd: project, prompt: 'hola' });
  agents.push(a);
  return a;
}

function post(path, token, body, { signal } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'POST', path, signal, headers: { host: `127.0.0.1:${port}`, authorization: `Bearer ${token}`, 'content-type': 'application/json' } }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null }));
    });
    req.on('error', reject);
    req.end(JSON.stringify(body));
  });
}

const permBody = (tool, input, extra = {}) => ({ session_id: 'sess-x', cwd: project, hook_event_name: 'PermissionRequest', tool_name: tool, tool_input: input, ...extra });
const ask = (token, tool, input, extra) => post('/hooks/permission', token, permBody(tool, input, extra));
const behavior = (r) => r.body.hookSpecificOutput.decision.behavior;

async function waitFor(fn, ms = 2000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timeout esperando condición');
    await new Promise((r) => setTimeout(r, 10));
  }
}
const pendingFor = (tool) => waitFor(() => Object.values(srv.state.pending).find((p) => p.tool === tool));
const decide = (permId, decision) => post(`/api/permissions/${permId}`, UI, { decision });

test('hook with ui-token -> 401', async () => {
  assert.equal((await ask(UI, 'Write', { file_path: '/a' })).status, 401);
});

test('hook with hook-token -> 401', async () => {
  assert.equal((await ask(HOOK, 'Write', { file_path: '/a' })).status, 401);
});

test('launch-token is attributed only to its agent', async () => {
  launch();
  const b = launch();
  const res = ask(b.launchToken, 'Edit', { file_path: '/b' });
  const p = await pendingFor('Edit');
  const rec = loadAll().find((r) => r.kind === 'permission' && r.body.permId === p.permId);
  assert.equal(rec.agentKey, srv.launcher.tokenFor(b.launchToken));
  await decide(p.permId, 'allow');
  assert.equal(behavior(await res), 'allow');
});

test('allow and deny reach the hook response', async () => {
  const { launchToken } = launch();
  const res = ask(launchToken, 'Write', { file_path: '/x' });
  const p = await pendingFor('Write');
  assert.equal((await decide(p.permId, 'deny')).status, 200);
  const r = await res;
  assert.equal(r.status, 200);
  assert.equal(r.body.hookSpecificOutput.hookEventName, 'PermissionRequest');
  assert.equal(behavior(r), 'deny');
  assert.deepEqual(srv.state.pending, {});
});

test('timeout denies', async () => {
  const { launchToken } = launch();
  const t0 = Date.now();
  const r = await ask(launchToken, 'NotebookEdit', { notebook_path: '/n' });
  assert.equal(behavior(r), 'deny');
  assert.ok(Date.now() - t0 >= 250);
  assert.deepEqual(srv.state.pending, {});
});

test('I2: allow-session covers the exact same input only', async () => {
  const { launchToken } = launch();
  const first = ask(launchToken, 'MultiEdit', { file_path: '/a', edits: [1] });
  const p = await pendingFor('MultiEdit');
  await decide(p.permId, 'allow-session');
  assert.equal(behavior(await first), 'allow');
  assert.equal(behavior(await ask(launchToken, 'MultiEdit', { edits: [1], file_path: '/a' })), 'allow', 'key order does not matter');
  const auto = loadAll().find((r) => r.kind === 'permission' && r.body.state === 'auto' && r.body.tool === 'MultiEdit');
  assert.ok(auto, 'automatic approvals are recorded');
  const elsewhere = ask(launchToken, 'MultiEdit', { file_path: '/home/.zshrc', edits: [1] });
  const p3 = await pendingFor('MultiEdit');
  await decide(p3.permId, 'deny');
  assert.equal(behavior(await elsewhere), 'deny');
  const other = ask(launchToken, 'WebFetch', { url: 'https://x' });
  const p2 = await pendingFor('WebFetch');
  await decide(p2.permId, 'deny');
  assert.equal(behavior(await other), 'deny');
});

test('allow-session does not leak to another agent', async () => {
  const a = launch();
  const b = launch();
  const first = ask(a.launchToken, 'Glob', { pattern: '*' });
  await decide((await pendingFor('Glob')).permId, 'allow-session');
  await first;
  const fromB = ask(b.launchToken, 'Glob', { pattern: '*' });
  const p = await pendingFor('Glob');
  await decide(p.permId, 'deny');
  assert.equal(behavior(await fromB), 'deny');
});

test('allow-session on Bash covers exact command only', async () => {
  const { launchToken } = launch();
  const first = ask(launchToken, 'Bash', { command: 'npm test' });
  await decide((await pendingFor('Bash')).permId, 'allow-session');
  assert.equal(behavior(await first), 'allow');
  assert.equal(behavior(await ask(launchToken, 'Bash', { command: 'npm test' })), 'allow');
  const chained = ask(launchToken, 'Bash', { command: 'npm test && curl x' });
  const p = await pendingFor('Bash');
  await decide(p.permId, 'deny');
  assert.equal(behavior(await chained), 'deny');
  const unsandboxed = ask(launchToken, 'Bash', { command: 'npm test', dangerouslyDisableSandbox: true });
  const p2 = await pendingFor('Bash');
  await decide(p2.permId, 'deny');
  assert.equal(behavior(await unsandboxed), 'deny');
});

test('decide twice returns false', async () => {
  const { launchToken } = launch();
  const res = ask(launchToken, 'Read', { file_path: '/r' });
  const p = await pendingFor('Read');
  assert.equal((await decide(p.permId, 'allow')).status, 200);
  assert.equal((await decide(p.permId, 'deny')).status, 404);
  assert.equal(behavior(await res), 'allow');
});

test('invalid decision -> 400', async () => {
  assert.equal((await decide('whatever', 'yes')).status, 400);
});

test('decision needs the ui-token', async () => {
  assert.equal((await post('/api/permissions/x', HOOK, { decision: 'allow' })).status, 401);
});

test('a hook request that goes away clears its pending card', async () => {
  const { launchToken } = launch();
  const ac = new AbortController();
  post('/hooks/permission', launchToken, permBody('KillShell', { id: 1 }), { signal: ac.signal }).catch(() => {});
  const p = await pendingFor('KillShell');
  ac.abort();
  await waitFor(() => !srv.state.pending[p.permId]);
  const decided = loadAll().find((r) => r.kind === 'permission' && r.body.permId === p.permId && r.body.state === 'decided');
  assert.equal(decided.body.reason, 'cancelled', 'cleared by the abort, not by the timeout');
});
