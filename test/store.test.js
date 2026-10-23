import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.CENTINELA_HOME = join(mkdtempSync(join(tmpdir(), 'centinela-store-')), 'home');
const { home, ensureHome, readOrCreateToken } = await import('../src/server/paths.js');
const { append, loadAll } = await import('../src/server/store.js');

test('files are 0600 and dir 0700', () => {
  ensureHome();
  const token = readOrCreateToken('token');
  assert.match(token, /^[0-9a-f]{64}$/);
  assert.equal(readOrCreateToken('token'), token);
  append({ ts: Date.now(), kind: 'hook', body: { x: 1 } });
  const mode = (p) => statSync(p).mode & 0o777;
  assert.equal(mode(home()), 0o700);
  assert.equal(mode(join(home(), 'token')), 0o600);
  const day = new Date().toLocaleDateString('sv-SE');
  assert.equal(mode(join(home(), `events-${day}.jsonl`)), 0o600);
});

test('store skips corrupt lines', () => {
  ensureHome();
  const before = loadAll().length;
  const good = (n) => JSON.stringify({ ts: n, kind: 'hook', body: { n } });
  const yesterday = new Date(Date.now() - 86_400_000).toLocaleDateString('sv-SE');
  writeFileSync(join(home(), `events-${yesterday}.jsonl`), `${good(1)}\nbasura{\n${good(2)}\n`, { mode: 0o600 });
  const warn = console.warn;
  let warned = 0;
  console.warn = () => warned++;
  try {
    const all = loadAll();
    assert.equal(all.length, before + 2);
    assert.equal(all[0].body.n, 1, 'oldest day first');
    assert.equal(warned, 1);
  } finally {
    console.warn = warn;
  }
});

test('history older than yesterday is not loaded', () => {
  ensureHome();
  const before = loadAll().length;
  writeFileSync(join(home(), 'events-2020-01-01.jsonl'), JSON.stringify({ ts: 1, kind: 'hook', body: {} }) + '\n', { mode: 0o600 });
  assert.equal(loadAll().length, before);
});
