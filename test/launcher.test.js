import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
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
  const launcher = createLauncher({ claudeBin: FAKE, port: () => 4317, hookToken: 'h'.repeat(64), broadcast: (r) => recs.push(r) });
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
  const inlined = JSON.parse(argv[argv.indexOf('--agents') + 1]);
  assert.equal(inlined.qa.description, 'Mi QA', 'user settings are not loaded, so user roles travel inline and win over a built-in');
  assert.ok(!agents.includes('auditor') && !agents.includes('tester'), 'neither a conflicting role nor a project role');
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

const initOf = (recs, agentKey) => waitFor(() => recs.find((r) => r.agentKey === agentKey && r.kind === 'stream' && r.body.subtype === 'init'));

test('only Centinela decides: user hooks are not loaded and the safe user settings are carried over', async () => {
  const file = join(tmp, 'config/settings.json');
  writeFileSync(file, JSON.stringify({
    model: 'sonnet',
    env: { CENTINELA_TEST_USER_ENV: 'de-usuario', CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1', ROTA: 5 },
    hooks: { PermissionRequest: [{ hooks: [{ type: 'command', command: 'aprueba-todo' }] }] },
    enabledPlugins: { x: true },
    permissions: { defaultMode: 'auto', allow: ['Write'], ask: ['Bash(git *)'], deny: ['Read(.env)'] },
    sandbox: { enabled: true, autoAllowBashIfSandboxed: true, network: { allowedDomains: ['example.com'] } },
  }));
  try {
    const { recs, launcher } = harness();
    const { agentKey } = launcher.launch({ role: 'tester', cwd: project, prompt: 'hola' });
    const { body: init } = await initOf(recs, agentKey);
    assert.equal(init.argv[init.argv.indexOf('--setting-sources') + 1], 'project,local');
    assert.equal(init.userEnv, 'de-usuario');
    assert.equal(init.agentTeams, undefined, 'teammates are separate processes the panel may not gate');
    const settings = JSON.parse(init.argv[init.argv.indexOf('--settings') + 1]);
    assert.deepEqual(settings.hooks.PermissionRequest.flatMap((g) => g.hooks.map((h) => h.url)), ['http://127.0.0.1:4317/hooks/permission']);
    assert.equal(settings.hooks.PostToolUse[0].hooks[0].url, 'http://127.0.0.1:4317/hooks/event', 'actions are observed without installing anything');
    assert.equal(settings.model, 'sonnet');
    assert.deepEqual(settings.permissions, { ask: ['Agent', 'Bash(git *)'], deny: ['Read(.env)'] }, 'neither allow rules nor another mode skip the panel');
    assert.equal(settings.sandbox.enabled, true);
    assert.equal(settings.sandbox.autoAllowBashIfSandboxed, false);
    assert.deepEqual(settings.sandbox.network.allowedDomains, ['example.com', '127.0.0.1:4317']);
    assert.equal(settings.enabledPlugins, undefined);
    launcher.stop(agentKey);
  } finally {
    rmSync(file);
  }
});

for (const [name, front, expected] of [
  ['inline', 'tools: Read, Grep\nmodel: haiku # rápido', { tools: ['Read', 'Grep'], model: 'haiku' }],
  ['a quoted list', 'tools: ["Read", \'Grep\']', { tools: ['Read', 'Grep'] }],
  ['a block list', 'tools:\n  - Read\n  - Grep\nmodel: haiku', { tools: ['Read', 'Grep'], model: 'haiku' }],
  ['disallowedTools', 'disallowedTools: Write, Edit', { disallowedTools: ['Write', 'Edit'] }],
]) {
  test(`a user role travels inline with its restrictions: ${name}`, async () => {
    const file = join(tmp, 'config/agents/lector.md');
    writeFileSync(file, `---\nname: lector\ndescription: Lee\n${front}\n---\nEres un lector.\n`);
    try {
      const { recs, launcher } = harness();
      const { agentKey } = launcher.launch({ role: 'lector', cwd: project, prompt: 'hola' });
      const { body: init } = await initOf(recs, agentKey);
      assert.deepEqual(JSON.parse(init.argv[init.argv.indexOf('--agents') + 1]), {
        lector: { description: 'Lee', prompt: 'Eres un lector.', ...expected },
      });
      assert.ok(listRoles(project).every((r) => r.tools === undefined && r.model === undefined), 'the role list stays name and description');
      launcher.stop(agentKey);
    } finally {
      rmSync(file);
    }
  });
}

test('a block description is read whole', () => {
  const file = join(tmp, 'config/agents/largo.md');
  writeFileSync(file, '---\nname: largo\ndescription: >\n  Primera línea\n  segunda línea\nmodel: haiku\n---\nx\n');
  try {
    assert.equal(listRoles(project).find((r) => r.name === 'largo').description, 'Primera línea segunda línea');
  } finally {
    rmSync(file);
  }
});

for (const [name, text] of [
  ['unreadable JSON', '{ no es json'],
  ['a value that is not an object', '[]'],
]) {
  test(`user settings with ${name} refuse the launch instead of dropping deny rules`, async () => {
    const file = join(tmp, 'config/settings.json');
    writeFileSync(file, text);
    try {
      const r = await api('POST', '/api/agents', { role: 'tester', cwd: project, prompt: 'hola' });
      assert.equal(r.status, 400);
      assert.match(r.body.error, /deny/);
    } finally {
      rmSync(file);
    }
  });
}

test('malformed user settings values are ignored, never a crash', async () => {
  const file = join(tmp, 'config/settings.json');
  writeFileSync(file, JSON.stringify({ model: 5, env: 'x', permissions: { ask: 'Bash', deny: 7 }, sandbox: { network: { allowedDomains: 7 } } }));
  try {
    const { recs, launcher } = harness();
    const { agentKey } = launcher.launch({ role: 'tester', cwd: project, prompt: 'hola' });
    const { body: init } = await initOf(recs, agentKey);
    const settings = JSON.parse(init.argv[init.argv.indexOf('--settings') + 1]);
    assert.deepEqual(settings.permissions, { ask: ['Agent'] });
    assert.deepEqual(settings.sandbox.network.allowedDomains, ['127.0.0.1:4317']);
    assert.equal(settings.model, undefined);
    launcher.stop(agentKey);
  } finally {
    rmSync(file);
  }
});

for (const settingsFile of ['settings.json', 'settings.local.json']) {
  for (const [name, text] of [
    ['PermissionRequest hook', JSON.stringify({ hooks: { PermissionRequest: [{ hooks: [{ type: 'command', command: 'x' }] }] } })],
    ['PreToolUse hook', JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'x' }] }] } })],
    ['unreadable settings', '{ no es json'],
  ]) {
    test(`a project with ${name} in ${settingsFile} is refused even when trusted`, async () => {
      const dir = mkdtempSync(join(tmp, 'rival-'));
      mkdirSync(join(dir, '.claude'));
      writeFileSync(join(dir, '.claude', settingsFile), text);
      const r = await api('POST', '/api/agents', { role: 'legal', cwd: dir, prompt: 'hola', trustProject: true });
      assert.equal(r.status, 400);
      assert.ok(r.body.error.includes(settingsFile));
      assert.notEqual(r.body.code, 'untrusted', 'trust cannot override this');
    });
  }
}

test('the first prompt is announced once although init repeats every turn', async () => {
  const { recs, launcher, of } = harness();
  const { agentKey } = launcher.launch({ role: 'tester', cwd: project, prompt: 'uno' });
  await waitFor(() => texts(recs).length === 1);
  launcher.sendPrompt(agentKey, 'dos');
  await waitFor(() => texts(recs).length === 2);
  assert.equal(of(agentKey, (r) => r.kind === 'stream' && r.body.subtype === 'init').length, 2);
  assert.equal(of(agentKey, (r) => r.body.event === 'started').length, 1);
  assert.deepEqual(of(agentKey, (r) => r.body.event === 'prompt').map((r) => r.body.text), ['uno', 'dos']);
  launcher.stop(agentKey);
});

test('a permission request with a malformed body -> 400 and no card', async () => {
  const { launchToken, agentKey } = srv.launcher.launch({ role: 'tester', cwd: project, prompt: 'hola' });
  const send = (body) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/hooks/permission', headers: { host: `127.0.0.1:${port}`, authorization: `Bearer ${launchToken}`, 'content-type': 'application/json' } }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('error', reject);
    req.end(JSON.stringify(body));
  });
  for (const body of [null, [], {}, { session_id: '__proto__', tool_name: 'Bash' }]) assert.equal(await send(body), 400, JSON.stringify(body));
  assert.equal(Object.keys(srv.state.pending).length, 0);
  srv.launcher.stop(agentKey);
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
