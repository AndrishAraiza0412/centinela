import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { merge, unmerge, settingsPath, OBSERVED_EVENTS } from '../src/server/install-hooks.js';

const TOKEN = 'h'.repeat(64);
const userHook = { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo mine' }] };
const userSettings = () => ({
  permissions: { defaultMode: 'auto' },
  hooks: { PreToolUse: [structuredClone(userHook)] },
  sandbox: { enabled: true },
});
const ours = (s, event) => s.hooks[event].filter((g) => g.hooks.some((h) => h.url?.endsWith('/hooks/event')));

test('merge keeps user hooks and adds one observation hook per event', () => {
  const s = merge(userSettings(), TOKEN, 4317);
  assert.deepEqual(s.hooks.PreToolUse[0], userHook);
  for (const event of OBSERVED_EVENTS) {
    const [group] = ours(s, event);
    assert.deepEqual(group, {
      matcher: '*',
      hooks: [{ type: 'http', url: 'http://127.0.0.1:4317/hooks/event', timeout: 2, headers: { Authorization: `Bearer ${TOKEN}` } }],
    });
  }
  assert.ok(!OBSERVED_EVENTS.includes('PermissionRequest'));
  assert.equal(s.hooks.PermissionRequest, undefined);
});

test('merge does not mutate its input', () => {
  const s = userSettings();
  merge(s, TOKEN, 4317);
  assert.deepEqual(s, userSettings());
});

test('merge is idempotent and refreshes token and port', () => {
  const once = merge(userSettings(), TOKEN, 4317);
  assert.deepEqual(merge(once, TOKEN, 4317), once);
  const moved = merge(once, 'n'.repeat(64), 4400);
  assert.equal(ours(moved, 'Stop').length, 1);
  assert.equal(ours(moved, 'Stop')[0].hooks[0].url, 'http://127.0.0.1:4400/hooks/event');
});

test('merge opens only Centinela\'s port through the sandbox, only when the sandbox is on', () => {
  assert.deepEqual(merge(userSettings(), TOKEN, 4317).sandbox.network.allowedDomains, ['127.0.0.1:4317']);
  const off = merge({ sandbox: { enabled: false } }, TOKEN, 4317);
  assert.equal(off.sandbox.network, undefined);
  const present = { sandbox: { enabled: true, network: { allowedDomains: ['example.com', '127.0.0.1:4317'] } } };
  assert.deepEqual(merge(present, TOKEN, 4317).sandbox.network.allowedDomains, ['example.com', '127.0.0.1:4317']);
  const moved = merge(merge(userSettings(), TOKEN, 4317), TOKEN, 4400);
  assert.deepEqual(moved.sandbox.network.allowedDomains, ['127.0.0.1:4317', '127.0.0.1:4400']);
});

test('unmerge restores original', () => {
  const s = userSettings();
  assert.deepEqual(unmerge(merge(s, TOKEN, 4317), { removeDomain: true }), s);
  assert.deepEqual(unmerge(merge({}, TOKEN, 4317)), {});
});

test('unmerge keeps the sandbox domain unless told it was ours', () => {
  const s = unmerge(merge(userSettings(), TOKEN, 4317));
  assert.deepEqual(s.sandbox.network.allowedDomains, ['127.0.0.1:4317']);
});

test('unmerge never removes a user entry for the whole loopback', () => {
  const s = { sandbox: { enabled: true, network: { allowedDomains: ['127.0.0.1'] } } };
  assert.deepEqual(unmerge(merge(s, TOKEN, 4317), { removeDomain: true }), s);
});

test('settingsPath honours CLAUDE_CONFIG_DIR', () => {
  const prev = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = '/x/cfg';
  try {
    assert.equal(settingsPath(), '/x/cfg/settings.json');
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = prev;
  }
});

function cli(dir, ...args) {
  return spawnSync(process.execPath, ['bin/centinela-hooks.js', ...args], {
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_CONFIG_DIR: dir, CENTINELA_HOME: join(dir, 'centinela') },
  });
}

test('invalid JSON aborts without writing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'centinela-hooks-'));
  writeFileSync(join(dir, 'settings.json'), '{');
  const r = cli(dir, 'install', '--yes');
  assert.equal(r.status, 1);
  assert.equal(readFileSync(join(dir, 'settings.json'), 'utf8'), '{');
  assert.deepEqual(readdirSync(dir).filter((f) => f.includes('backup')), []);
});

test('install then uninstall round-trips the user settings with a backup', () => {
  const dir = mkdtempSync(join(tmpdir(), 'centinela-hooks-'));
  const original = JSON.stringify(userSettings(), null, 2) + '\n';
  writeFileSync(join(dir, 'settings.json'), original);

  const install = cli(dir, 'install', '--yes');
  assert.equal(install.status, 0, install.stderr);
  const installed = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'));
  assert.equal(ours(installed, 'PreToolUse').length, 1);
  const backups = readdirSync(dir).filter((f) => f.startsWith('settings.json.centinela-backup-'));
  assert.equal(backups.length, 1);
  assert.equal(readFileSync(join(dir, backups[0]), 'utf8'), original);

  assert.match(cli(dir, 'install', '--yes').stdout, /Sin cambios/);

  assert.equal(cli(dir, 'uninstall', '--yes').status, 0);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')), userSettings());
});

test('install without --yes and without a terminal does not write', () => {
  const dir = mkdtempSync(join(tmpdir(), 'centinela-hooks-'));
  writeFileSync(join(dir, 'settings.json'), '{}\n');
  const r = cli(dir, 'install');
  assert.notEqual(r.status, 0);
  assert.equal(readFileSync(join(dir, 'settings.json'), 'utf8'), '{}\n');
});
