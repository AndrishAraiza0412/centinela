#!/usr/bin/env node
// centinela-hooks install|uninstall [--yes]
import { readFileSync, writeFileSync, copyFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { isDeepStrictEqual } from 'node:util';
import { merge, unmerge, settingsPath, hasLocalDomain } from '../src/server/install-hooks.js';
import { home, ensureHome, readOrCreateToken } from '../src/server/paths.js';

const [command, ...flags] = process.argv.slice(2);
const yes = flags.includes('--yes');
if (command !== 'install' && command !== 'uninstall') {
  console.error('Uso: centinela-hooks install|uninstall [--yes]');
  process.exit(2);
}

const file = settingsPath();
let text = null;
try {
  text = readFileSync(file, 'utf8');
} catch (err) {
  if (err.code !== 'ENOENT') throw err;
}
let before;
try {
  before = text === null ? {} : JSON.parse(text);
} catch (err) {
  console.error(`${file} no es JSON válido (${err.message}). No se escribió nada.`);
  process.exit(1);
}

ensureHome();
const marker = join(home(), 'sandbox-domain-added');
const after = command === 'install'
  ? merge(before, readOrCreateToken('hook-token'), Number(process.env.CENTINELA_PORT || 4317))
  : unmerge(before, { removeDomain: existsSync(marker) });

if (isDeepStrictEqual(before, after)) {
  console.log(`Sin cambios en ${file}.`);
  process.exit(0);
}

const view = (s) => JSON.stringify({ hooks: s.hooks, sandbox: s.sandbox }, null, 2);
console.log(`Archivo: ${file}\n\n--- antes\n${view(before)}\n\n+++ después\n${view(after)}\n`);

if (!yes) {
  if (!process.stdin.isTTY) {
    console.error('Sin terminal para confirmar: vuelve a ejecutar con --yes. No se escribió nada.');
    process.exit(1);
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question('¿Aplicar estos cambios? (s/N) ');
  rl.close();
  if (!/^s(í|i)?$/i.test(answer.trim())) {
    console.log('Cancelado. No se escribió nada.');
    process.exit(1);
  }
}

if (text !== null) {
  const backup = `${file}.centinela-backup-${Date.now()}`;
  copyFileSync(file, backup);
  console.log(`Copia de respaldo: ${backup}`);
} else {
  mkdirSync(dirname(file), { recursive: true });
}
writeFileSync(file, JSON.stringify(after, null, 2) + '\n');

if (command === 'install' && !hasLocalDomain(before) && hasLocalDomain(after)) writeFileSync(marker, '', { mode: 0o600 });
if (command === 'uninstall') rmSync(marker, { force: true });
console.log(command === 'install' ? 'Hooks de Centinela instalados.' : 'Hooks de Centinela quitados.');
