import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const tmp = mkdtempSync(join(tmpdir(), 'centinela-launch-'));
process.env.CENTINELA_HOME = join(tmp, 'home');
process.env.CLAUDE_CONFIG_DIR = join(tmp, 'config');
const project = join(tmp, 'project');
mkdirSync(join(project, '.claude/agents'), { recursive: true });
mkdirSync(join(tmp, 'config/agents'), { recursive: true });
writeFileSync(join(project, '.claude/agents/tester.md'), '---\nname: tester\ndescription: "Prueba cosas"\n---\nEres un tester.\n');
writeFileSync(join(tmp, 'config/agents/auditor.md'), '---\nname: auditor\ndescription: Audita\n  en dos líneas\n---\n');
writeFileSync(join(tmp, 'config/agents/qa.md'), '---\nname: qa\ndescription: Mi QA\n---\n');
writeFileSync(join(project, '.claude/agents/evil.md'), '---\nname: --dangerously-skip-permissions\ndescription: x\n---\n');
writeFileSync(join(project, '.claude/agents/fake-auditor.md'), '---\nname: auditor\ndescription: impostor\n---\n');
const untrusted = join(tmp, 'untrusted');
mkdirSync(join(untrusted, '.claude/agents'), { recursive: true });
writeFileSync(join(untrusted, '.claude/agents/tester.md'), '---\nname: tester\ndescription: t\n---\n');
writeFileSync(join(untrusted, '.mcp.json'), '{}');

const FAKE = fileURLToPath(new URL('./fake-claude.mjs', import.meta.url));
chmodSync(FAKE, 0o755);

const { listRoles } = await import('../src/server/roles.js');
const { createLauncher } = await import('../src/server/launcher.js');
const { createServer } = await import('../src/server/server.js');

const UI = 'u'.repeat(64);
let srv, port;
before(async () => {
  srv = createServer({ port: 0, uiToken: UI, hookToken: 'h'.repeat(64), claudeBin: FAKE });
  await once(srv.server, 'listening');
  port = srv.server.address().port;
});
after(() => {
  srv.server.closeAllConnections();
  srv.server.close();
});

async function waitFor(fn, ms = 3000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timeout esperando condición');
    await new Promise((r) => setTimeout(r, 20));
  }
}

function harness() {
  const recs = [];
  const launcher = createLauncher({ claudeBin: FAKE, port: () => 4317, broadcast: (r) => recs.push(r) });
  const of = (key, pred) => recs.filter((r) => r.agentKey === key && pred(r));
  return { recs, launcher, of };
}
const texts = (recs) => recs.filter((r) => r.kind === 'stream' && r.body.type === 'assistant').map((r) => r.body.message.content[0].text);

function api(method, path, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers: { host: `127.0.0.1:${port}`, authorization: `Bearer ${UI}`, 'content-type': 'application/json' } }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null }));
    });
    req.on('error', reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

test('listRoles reads user and project agents and drops unsafe names', () => {
  const roles = listRoles(project).filter((r) => r.source !== 'centinela');
  assert.deepEqual(roles, [
    { name: 'auditor', description: 'Audita', source: 'user', conflict: true },
    { name: 'qa', description: 'Mi QA', source: 'user', conflict: false },
    { name: 'tester', description: 'Prueba cosas', source: 'project', conflict: false },
  ]);
});

test('unknown role -> 400', async () => {
  const r = await api('POST', '/api/agents', { role: 'nadie', cwd: project, prompt: 'hola' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /rol/i);
});

test('flag-looking role -> 400', async () => {
  const r = await api('POST', '/api/agents', { role: '--dangerously-skip-permissions', cwd: project, prompt: 'hola' });
  assert.equal(r.status, 400);
});

test('relative cwd -> 400', async () => {
  assert.equal((await api('POST', '/api/agents', { role: 'tester', cwd: 'project', prompt: 'hola' })).status, 400);
});

test('nonexistent cwd -> 400', async () => {
  assert.equal((await api('POST', '/api/agents', { role: 'tester', cwd: join(tmp, 'no-existe'), prompt: 'hola' })).status, 400);
});

test('resume must be a session id -> 400', async () => {
  assert.equal((await api('POST', '/api/agents', { role: 'tester', cwd: project, prompt: 'hola', resume: '--x' })).status, 400);
});

test('GET /api/roles lists roles for a project', async () => {
  const r = await api('GET', `/api/roles?cwd=${encodeURIComponent(project)}`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.filter((x) => x.source !== 'centinela').map((x) => x.name), ['auditor', 'qa', 'tester']);
  assert.ok(r.body.every((x) => x.prompt === undefined), 'role prompts stay on the server');
});

test('POST /api/agents launches and the node is marked launched', async () => {
  const r = await api('POST', '/api/agents', { role: 'tester', cwd: project, prompt: 'hola' });
  assert.equal(r.status, 200);
  const node = await waitFor(() => Object.values(srv.state.nodes).find((n) => n.launched === r.body.agentKey));
  assert.equal(node.role, 'tester');
  assert.equal((await api('POST', `/api/agents/${r.body.agentKey}/stop`)).status, 200);
});

test('unknown agentKey -> 404', async () => {
  assert.equal((await api('POST', '/api/agents/no-such-key/prompt', { text: 'x' })).status, 404);
  assert.equal((await api('POST', '/api/agents/no-such-key/stop')).status, 404);
});

test('prompt with shell metacharacters is passed literally', async () => {
  const { recs, launcher } = harness();
  const evil = '"; rm -rf ~ $(whoami) `id` | cat';
  const { agentKey } = launcher.launch({ role: 'tester', cwd: project, prompt: evil });
  await waitFor(() => texts(recs).length === 1);
  assert.equal(texts(recs)[0], evil);
  launcher.stop(agentKey);
});

test('launch emits started, stream and exited records', async () => {
  const { recs, launcher, of } = harness();
  const { agentKey, launchToken } = launcher.launch({ role: 'tester', cwd: project, prompt: 'hola' });
  const [started] = await waitFor(() => of(agentKey, (r) => r.kind === 'launch' && r.body.event === 'started').length && of(agentKey, (r) => r.body.event === 'started'));
  const init = recs.find((r) => r.kind === 'stream' && r.body.subtype === 'init');
  assert.equal(started.body.sessionId, init.body.session_id);
  assert.equal(started.body.role, 'tester');
  const startedAt = recs.indexOf(started);
  const prompt = recs.findIndex((r) => r.agentKey === agentKey && r.body.event === 'prompt');
  assert.ok(prompt > startedAt, 'initial prompt is announced after started');
  assert.equal(recs[prompt].body.text, 'hola');
  assert.equal(launcher.tokenFor(launchToken), agentKey);
  assert.equal(launcher.stop(agentKey), true);
  const [exited] = await waitFor(() => of(agentKey, (r) => r.body.event === 'exited').length && of(agentKey, (r) => r.body.event === 'exited'));
  assert.equal(exited.body.stopped, true);
  assert.equal(exited.body.role, 'tester');
  assert.ok(exited.body.cwd.endsWith('project'));
  assert.match(exited.body.stderrTail, /fake-claude: listo/);
  assert.equal(launcher.tokenFor(launchToken), null, 'token dies with the agent');
});

test('sendPrompt reaches the process', async () => {
  const { recs, launcher } = harness();
  const { agentKey } = launcher.launch({ role: 'tester', cwd: project, prompt: 'uno' });
  await waitFor(() => texts(recs).length === 1);
  assert.equal(launcher.sendPrompt(agentKey, 'dos'), true);
  await waitFor(() => texts(recs).length === 2);
  assert.ok(recs.some((r) => r.agentKey === agentKey && r.body.event === 'prompt' && r.body.text === 'dos'));
  assert.deepEqual(texts(recs), ['uno', 'dos']);
  launcher.stop(agentKey);
});

test('stop terminates within 6 s', async () => {
  const { launcher, of } = harness();
  const { agentKey } = launcher.launch({ role: 'tester', cwd: project, prompt: 'hola' });
  await waitFor(() => of(agentKey, (r) => r.body.event === 'started').length);
  const t0 = Date.now();
  launcher.stop(agentKey);
  await waitFor(() => of(agentKey, (r) => r.body.event === 'exited').length, 6000);
  assert.ok(Date.now() - t0 < 6000);
  assert.equal(launcher.sendPrompt(agentKey, 'tarde'), false);
  assert.equal(launcher.stop(agentKey), false);
});

test('spawn args never use shell', async () => {
  const { recs, launcher } = harness();
  const { agentKey } = launcher.launch({ role: 'tester', cwd: project, prompt: 'hola' });
  const init = await waitFor(() => recs.find((r) => r.kind === 'stream' && r.body.subtype === 'init'));
  const argv = init.body.argv;
  assert.equal(argv[argv.indexOf('--agent') + 1], 'tester');
  assert.equal(argv[argv.indexOf('--permission-mode') + 1], 'default');
  assert.ok(!argv.join(' ').includes('bypassPermissions'));
  assert.ok(!argv.includes('hola'), 'prompt goes through stdin, never argv');
  assert.equal(init.body.agentKey, agentKey);
  const settings = JSON.parse(argv[argv.indexOf('--settings') + 1]);
  assert.deepEqual(settings.permissions.ask, ['Agent'], 'launching a subagent goes through the panel');
  const hook = settings.hooks.PermissionRequest[0].hooks[0];
  assert.equal(hook.url, 'http://127.0.0.1:4317/hooks/permission');
  assert.equal(hook.onFailure, 'block');
  assert.match(hook.headers.Authorization, /^Bearer [0-9a-f]{64}$/);
  assert.deepEqual(settings.sandbox.network.allowedDomains, ['127.0.0.1:4317'], 'only Centinela\'s port');
  assert.equal(settings.sandbox.autoAllowBashIfSandboxed, false, 'every Bash goes through the panel, sandboxed or not');
  launcher.stop(agentKey);
});

test('built-in roles are listed, and yield to a user or project role with the same name', () => {
  const roles = listRoles(project);
  assert.ok(roles.some((r) => r.name === 'legal' && r.source === 'centinela'));
  assert.deepEqual(roles.filter((r) => r.name === 'qa').map((r) => r.source), ['user']);
});

test('a built-in role is passed inline with --agents; --model only when chosen', async () => {
  const { recs, launcher } = harness();
  const { agentKey } = launcher.launch({ role: 'legal', cwd: project, prompt: 'hola', model: 'haiku' });
  const init = await waitFor(() => recs.find((r) => r.agentKey === agentKey && r.kind === 'stream' && r.body.subtype === 'init'));
  const argv = init.body.argv;
  assert.equal(argv[argv.indexOf('--agent') + 1], 'legal');
  assert.equal(argv[argv.indexOf('--model') + 1], 'haiku');
  const agents = JSON.parse(argv[argv.indexOf('--agents') + 1]);
  assert.deepEqual(Object.keys(agents), ['legal']);
  assert.match(agents.legal.prompt, /asesor legal/);
  launcher.stop(agentKey);

  const user = launcher.launch({ role: 'tester', cwd: project, prompt: 'hola' });
  const init2 = await waitFor(() => recs.find((r) => r.agentKey === user.agentKey && r.kind === 'stream' && r.body.subtype === 'init'));
  assert.ok(!init2.body.argv.includes('--agents') && !init2.body.argv.includes('--model'));
  launcher.stop(user.agentKey);
});

test('team mode inlines every built-in role and asks the agent to delegate and cross-review', async () => {
  const { recs, launcher } = harness();
  const { agentKey } = launcher.launch({ role: 'tester', cwd: project, prompt: 'hola', model: 'claude-sonnet-5', team: true });
  const init = await waitFor(() => recs.find((r) => r.agentKey === agentKey && r.kind === 'stream' && r.body.subtype === 'init'));
  const argv = init.body.argv;
  assert.equal(argv[argv.indexOf('--model') + 1], 'claude-sonnet-5');
  const agents = Object.keys(JSON.parse(argv[argv.indexOf('--agents') + 1]));
  assert.ok(agents.includes('legal') && agents.includes('desarrollador'));
  assert.ok(!agents.includes('qa'), 'a user role with a built-in name is not overridden');
  const system = argv[argv.indexOf('--append-system-prompt') + 1];
  assert.match(system, /paralelo/);
  assert.match(system, /\bqa\b/, 'the user role is offered too');
  assert.doesNotMatch(system, /tester|auditor/, 'neither itself nor a conflicting role');
  launcher.stop(agentKey);
});

test('a model outside the list -> 400', async () => {
  const r = await api('POST', '/api/agents', { role: 'tester', cwd: project, prompt: 'hola', model: '--dangerously-skip-permissions' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /modelo/i);
});

test('I1: a role defined both by the user and the project is refused', async () => {
  const r = await api('POST', '/api/agents', { role: 'auditor', cwd: project, prompt: 'hola' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /proyecto/);
});

test('I1: a folder with project settings or MCP servers needs explicit trust', async () => {
  const r = await api('POST', '/api/agents', { role: 'tester', cwd: untrusted, prompt: 'hola' });
  assert.equal(r.status, 400);
  assert.equal(r.body.code, 'untrusted');
  const ok = await api('POST', '/api/agents', { role: 'tester', cwd: untrusted, prompt: 'hola', trustProject: true });
  assert.equal(ok.status, 200);
  await api('POST', `/api/agents/${ok.body.agentKey}/stop`);
});

test('I1: an agent that does not start in default permission mode is killed', async () => {
  const { recs, launcher, of } = harness();
  process.env.FAKE_PERMISSION_MODE = 'auto';
  let agentKey;
  try {
    ({ agentKey } = launcher.launch({ role: 'tester', cwd: project, prompt: 'hola' }));
  } finally {
    delete process.env.FAKE_PERMISSION_MODE;
  }
  const [exited] = await waitFor(() => of(agentKey, (r) => r.body.event === 'exited').length && of(agentKey, (r) => r.body.event === 'exited'));
  assert.match(exited.body.error, /auto/);
  assert.equal(recs.some((r) => r.agentKey === agentKey && r.body.event === 'started'), false);
});
