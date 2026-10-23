#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { home, ensureHome, readOrCreateToken } from '../src/server/paths.js';
import { loadAll } from '../src/server/store.js';
import { createServer } from '../src/server/server.js';
import { reduce, markDisconnected } from '../src/shared/graph.js';

const port = Number(process.env.CENTINELA_PORT || 4317);

ensureHome();
// El ui-token vive solo en memoria (nuevo en cada arranque): en disco, cualquier comando del
// sandbox de Claude Code podía leerlo y manejar el panel. Versiones anteriores lo guardaban.
rmSync(join(home(), 'token'), { force: true });
const pairCode = randomBytes(16).toString('hex');
const { server, state } = createServer({
  port,
  uiToken: randomBytes(32).toString('hex'),
  pairCode,
  hookToken: readOrCreateToken('hook-token'),
  claudeBin: process.env.CENTINELA_CLAUDE_BIN || 'claude',
});

for (const rec of loadAll()) {
  try {
    reduce(state, rec);
  } catch (err) {
    console.warn(`Centinela: evento del historial ignorado (${err.message})`);
  }
}
markDisconnected(state);

server.on('error', (err) => {
  if (err.code !== 'EADDRINUSE') throw err;
  console.error(`Centinela ya está corriendo o el puerto ${port} está ocupado`);
  process.exit(1);
});

server.on('listening', () => {
  // Código de un solo uso: lo canjea la primera página que lo abre.
  const url = `http://127.0.0.1:${port}/#pair=${pairCode}`;
  console.log(`Centinela: ${url}`);
  if (!process.env.CENTINELA_NO_OPEN) spawn('open', [url], { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
});
